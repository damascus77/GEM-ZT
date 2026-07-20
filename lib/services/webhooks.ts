import { getDb } from '@/lib/db/client';
import { isSafeWebhookUrl } from '@/lib/util/ssrf';
import { publish } from '@/lib/events/bus';
import { listMembers } from './members';

const NEW_MEMBER_WEBHOOK_URL_KEY = 'webhook.new_member_url';

export interface WebhookConfig {
  newMemberUrl: string | null;
}

function orgWebhookKey(orgId: string): string {
  return `webhook:${orgId}`;
}

// Cap on a single webhook delivery. Without it a webhook host that accepts the
// connection but never responds would hang the members-list request (which
// awaits dispatch) for up to undici's ~300s default headers timeout.
const WEBHOOK_TIMEOUT_MS = 5000;

/** Org-scoped webhook config, stored under the `webhook:{orgId}` Setting key. */
export async function getWebhookConfig(orgId: string): Promise<WebhookConfig> {
  const row = await getDb().setting.findUnique({ where: { key: orgWebhookKey(orgId) } });
  if (!row?.value) return { newMemberUrl: null };
  try {
    const parsed = JSON.parse(row.value) as Partial<WebhookConfig>;
    return { newMemberUrl: parsed.newMemberUrl ?? null };
  } catch {
    return { newMemberUrl: null };
  }
}

/** Set (or clear) the org-scoped webhook config. */
export async function setWebhookConfig(orgId: string, cfg: WebhookConfig): Promise<void> {
  const key = orgWebhookKey(orgId);
  const value = JSON.stringify(cfg);
  await getDb().setting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}

/** The configured outbound webhook URL for new-unauthorized-member alerts, or null if unset. */
export async function getNewMemberWebhookUrl(): Promise<string | null> {
  const row = await getDb().setting.findUnique({ where: { key: NEW_MEMBER_WEBHOOK_URL_KEY } });
  return row?.value ? row.value : null;
}

/** Set (or clear, via null/empty) the outbound webhook URL for new-unauthorized-member alerts. */
export async function setNewMemberWebhookUrl(url: string | null): Promise<void> {
  const value = url ?? '';
  await getDb().setting.upsert({
    where: { key: NEW_MEMBER_WEBHOOK_URL_KEY },
    create: { key: NEW_MEMBER_WEBHOOK_URL_KEY, value },
    update: { value },
  });
}

/**
 * Pure diff: memberIds that are unauthorized and not already in knownIds.
 * Deterministic, no side effects.
 */
export function diffNewUnauthorized(
  members: Array<{ memberId: string; authorized: boolean }>,
  knownIds: string[]
): string[] {
  const known = new Set(knownIds);
  return members.filter(m => !m.authorized && !known.has(m.memberId)).map(m => m.memberId);
}

/**
 * POST a JSON payload to a webhook URL. Never throws: network errors and
 * non-2xx responses both resolve to false so callers can treat this as
 * best-effort.
 */
export async function dispatchWebhook(url: string, payload: unknown): Promise<boolean> {
  // Defense in depth: the URL is also validated when it's saved, but re-check
  // here so a value that predates this guard (or was written directly to the DB)
  // can't drive a server-side request to an internal address.
  if (!isSafeWebhookUrl(url)) {
    console.error('[gem-zt] refusing to dispatch webhook to unsafe URL:', url);
    return false;
  }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      // Bound the request and refuse redirects (a 30x to an internal address
      // would otherwise bypass the URL check above).
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
      redirect: 'error',
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Detect unauthorized members on a network and publish a `member.unauthorized`
 * event for each onto the event bus. The notification fan-out
 * (lib/services/notifications.ts) delivers to the configured channels (webhook
 * + email) and dedups via the NotificationDelivery ledger — keyed by
 * network+member, so a member is alerted at most once (replacing the old
 * Setting-based "known set", and fixing the at-least-once AUD-07 race).
 *
 * Best-effort, never throws. The background scheduler drives this for every
 * network regardless of viewers; the members LIST route also calls it as a
 * low-latency fallback.
 */
export async function notifyNewUnauthorizedMembers(nwid: string): Promise<void> {
  try {
    const meta = await getDb().networkMeta.findUnique({ where: { nwid } });
    if (!meta?.orgId) return;

    // One ledger query per network: which members have already been delivered a
    // member.unauthorized alert? deliverEvent stores rows under an eventKey of
    // the form `member.unauthorized:${nwid}:${memberId}:${orgId}`, so we match on
    // the `member.unauthorized:${nwid}:` prefix and pull the memberId out of the
    // 3rd colon-segment. Skipping those avoids the steady per-tick DB churn of a
    // config read + an always-failing claim() insert for already-notified members
    // on the single SQLite writer. A send that failed was release()d, so its row
    // is gone and the member correctly re-publishes.
    const prefix = `member.unauthorized:${nwid}:`;
    const delivered = await getDb().notificationDelivery.findMany({
      where: { eventKey: { startsWith: prefix } },
      select: { eventKey: true },
    });
    const alreadyNotified = new Set(
      delivered.map(row => row.eventKey.split(':')[2]).filter((id): id is string => Boolean(id))
    );

    const members = await listMembers(nwid);
    for (const m of members) {
      if (!m.authorized && !alreadyNotified.has(m.memberId)) {
        publish({
          type: 'member.unauthorized',
          nwid,
          memberId: m.memberId,
          name: m.name ?? '',
          orgId: meta.orgId,
        });
      }
    }
  } catch (e) {
    console.error('[gem-zt] new-member notification failed:', e);
  }
}
