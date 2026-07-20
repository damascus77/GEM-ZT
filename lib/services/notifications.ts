import { getDb } from '@/lib/db/client';
import { subscribe, type AppEvent, type EventType } from '@/lib/events/bus';
import { dispatchWebhook, getWebhookConfig } from './webhooks';
import { sendMail } from './email';

// Unified notification fan-out. Producers publish domain events onto the event
// bus (lib/events/bus.ts); this layer resolves per-org delivery config and
// sends each event to the configured channels (webhook + email) at most once,
// using the NotificationDelivery ledger for idempotency (AUD-07: a crash/retry
// can't re-send a delivery that already succeeded).
//
// The outbound webhook URL is read from the existing org webhook config so the
// settings/webhook route stays the single source for it; email recipients and
// per-event toggles live under a separate `notifications:{orgId}` Setting key.

export type Channel = 'webhook' | 'email';

export interface NotificationConfig {
  emailRecipients: string[];
  /** event type -> enabled. Missing = enabled (opt-out, not opt-in). */
  events: Partial<Record<EventType, boolean>>;
}

function configKey(orgId: string): string {
  return `notifications:${orgId}`;
}

export async function getNotificationConfig(orgId: string): Promise<NotificationConfig> {
  const row = await getDb().setting.findUnique({ where: { key: configKey(orgId) } });
  if (!row?.value) return { emailRecipients: [], events: {} };
  try {
    const parsed = JSON.parse(row.value) as Partial<NotificationConfig>;
    return {
      emailRecipients: Array.isArray(parsed.emailRecipients)
        ? parsed.emailRecipients.filter((x): x is string => typeof x === 'string')
        : [],
      events: parsed.events && typeof parsed.events === 'object' ? parsed.events : {},
    };
  } catch {
    return { emailRecipients: [], events: {} };
  }
}

export async function setNotificationConfig(orgId: string, cfg: NotificationConfig): Promise<void> {
  const key = configKey(orgId);
  const value = JSON.stringify(cfg);
  await getDb().setting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

function isEventEnabled(cfg: NotificationConfig, type: EventType): boolean {
  return cfg.events[type] !== false;
}

/**
 * Idempotency key for an event occurrence.
 *
 * `member.unauthorized` keys off network+member only, with no timestamp: it is a
 * "new unauthorized member" alert that the webhook-check job re-publishes every
 * tick, so a permanent key dedups it to once-ever per member.
 *
 * Everything else keys off the supplied `now` so each distinct occurrence is
 * unique. `member.deauthorized` is published once per authorized->deauthorized
 * transition, so a member that is deauthorized, re-authorized, then deauthorized
 * again must alert twice — a permanent network+member key would silently drop
 * the second one. There is no retry driver re-firing these, and both channels in
 * a single deliverEvent call share the same `now`, so crash-idempotency across
 * the webhook+email pair still holds.
 */
export function eventKey(event: AppEvent, now: number): string {
  if (event.type === 'member.unauthorized') {
    return `${event.type}:${event.nwid}:${event.memberId}`;
  }
  return `${event.type}:${now}`;
}

/**
 * Claim (eventKey, channel) in the ledger. Returns true if THIS call claimed it
 * (safe to send), false if it was already claimed (skip). The unique constraint
 * makes the insert the atomic claim.
 */
async function claim(key: string, channel: Channel): Promise<boolean> {
  try {
    await getDb().notificationDelivery.create({ data: { eventKey: key, channel } });
    return true;
  } catch {
    return false;
  }
}

/** Release a claim so a failed send can be retried on a later tick. */
async function release(key: string, channel: Channel): Promise<void> {
  await getDb()
    .notificationDelivery.deleteMany({ where: { eventKey: key, channel } })
    .catch(() => undefined);
}

/** Claim-then-send; release on failure so unsent events retry rather than being lost. */
async function deliverChannel(
  key: string,
  channel: Channel,
  send: () => Promise<boolean>
): Promise<void> {
  if (!(await claim(key, channel))) return;
  const ok = await send();
  if (!ok) await release(key, channel);
}

function summarize(event: AppEvent): { subject: string; text: string } {
  switch (event.type) {
    case 'member.unauthorized':
      return {
        subject: `[gem-zt] New unauthorized member on ${event.nwid}`,
        text: `Member ${event.memberId} (${event.name || 'unnamed'}) is unauthorized on network ${event.nwid}.`,
      };
    case 'member.deauthorized':
      return {
        subject: `[gem-zt] Member deauthorized on ${event.nwid}`,
        text: `Member ${event.memberId} (${event.name || 'unnamed'}) was deauthorized on network ${event.nwid}.`,
      };
    case 'controller.degraded':
      return {
        subject: '[gem-zt] Controller unreachable',
        text: 'The ZeroTier controller became unreachable.',
      };
    case 'controller.recovered':
      return {
        subject: '[gem-zt] Controller recovered',
        text: 'The ZeroTier controller is reachable again.',
      };
    default:
      return { subject: '[gem-zt] Notification', text: JSON.stringify(event) };
  }
}

/** Org ids that should receive an event: its own org, or all configured orgs for instance-wide events. */
async function targetOrgIds(event: AppEvent): Promise<string[]> {
  if (event.orgId) return [event.orgId];
  // Instance-wide (controller.*): every org is a candidate; per-org config
  // decides whether it's actually enabled/has a channel.
  const orgs = await getDb().organization.findMany({ select: { id: true } });
  return orgs.map(o => o.id);
}

/**
 * Deliver one event to all target orgs' configured channels, idempotently.
 * Best-effort: never throws. `now` is injectable for tests.
 */
export async function deliverEvent(event: AppEvent, now: number = Date.now()): Promise<void> {
  try {
    const key = eventKey(event, now);
    for (const orgId of await targetOrgIds(event)) {
      const cfg = await getNotificationConfig(orgId);
      if (!isEventEnabled(cfg, event.type)) continue;

      const { newMemberUrl } = await getWebhookConfig(orgId);
      const perOrgKey = `${key}:${orgId}`;

      if (newMemberUrl) {
        await deliverChannel(perOrgKey, 'webhook', () =>
          dispatchWebhook(newMemberUrl, { ...event })
        );
      }
      if (cfg.emailRecipients.length > 0) {
        const { subject, text } = summarize(event);
        await deliverChannel(perOrgKey, 'email', () =>
          sendMail({ to: cfg.emailRecipients, subject, text })
        );
      }
    }
  } catch (e) {
    console.error('[gem-zt] notification delivery failed:', e);
  }
}

let unsubscribe: (() => void) | null = null;

/** Subscribe the fan-out to the event bus. Idempotent. */
export function startNotificationConsumer(): void {
  if (unsubscribe) return;
  unsubscribe = subscribe(event => {
    // Only act on notifiable events; ignore pure UI-refresh events.
    if (event.type === 'metrics.changed' || event.type === 'members.changed') return;
    void deliverEvent(event);
  });
}

/** Test-only: detach the consumer. */
export function stopNotificationConsumer(): void {
  unsubscribe?.();
  unsubscribe = null;
}
