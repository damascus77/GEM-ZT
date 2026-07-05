import { getDb } from '@/lib/db/client';
import { isSafeWebhookUrl } from '@/lib/util/ssrf';
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

function knownSetKey(nwid: string): string {
  return `webhook.known.${nwid}`;
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
  knownIds: string[],
): string[] {
  const known = new Set(knownIds);
  return members.filter((m) => !m.authorized && !known.has(m.memberId)).map((m) => m.memberId);
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

function parseKnownIds(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'string')) return parsed;
    return [];
  } catch {
    return [];
  }
}

/**
 * Best-effort, never throws (like presence/audit): fire a webhook the first
 * time an unauthorized member is seen on a network, then record every current
 * memberId (authorized or not) as "known" so it isn't re-alerted on later
 * polls even if it leaves and rejoins while still pending, or is later
 * deauthorized.
 *
 * Honest limitation: this only runs while someone is viewing a network's
 * member list (see the throttled call site in the members LIST route) — there
 * is no background scheduler, so a network nobody is viewing never triggers
 * an alert.
 */
export async function notifyNewUnauthorizedMembers(nwid: string): Promise<void> {
  try {
    const meta = await getDb().networkMeta.findUnique({ where: { nwid } });
    if (!meta?.orgId) return;
    const { newMemberUrl: url } = await getWebhookConfig(meta.orgId);
    if (!url) return;

    const members = await listMembers(nwid);
    const key = knownSetKey(nwid);
    const row = await getDb().setting.findUnique({ where: { key } });
    const knownIds = parseKnownIds(row?.value);

    const newUnauthorized = diffNewUnauthorized(members, knownIds);
    const byId = new Map(members.map((m) => [m.memberId, m]));
    for (const memberId of newUnauthorized) {
      const member = byId.get(memberId);
      await dispatchWebhook(url, {
        event: 'member.unauthorized',
        nwid,
        memberId,
        name: member?.name ?? '',
      });
    }

    const updatedKnown = Array.from(
      new Set([...knownIds, ...members.map((m) => m.memberId)]),
    );
    await getDb().setting.upsert({
      where: { key },
      create: { key, value: JSON.stringify(updatedKnown) },
      update: { value: JSON.stringify(updatedKnown) },
    });
  } catch (e) {
    console.error('[gem-zt] new-member webhook notification failed:', e);
  }
}
