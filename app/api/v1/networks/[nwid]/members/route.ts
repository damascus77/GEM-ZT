import { NextResponse } from 'next/server';
import { requireOrgRole } from '@/lib/api/authz';
import { apiError, handleRouteError } from '@/lib/api/errors';
import { assertNetworkInOrg } from '@/lib/services/networks';
import { listMembers, type MemberView } from '@/lib/services/members';
import { sampleNetworkPresence } from '@/lib/services/presence';
import { notifyNewUnauthorizedMembers } from '@/lib/services/webhooks';

type Ctx = { params: Promise<{ nwid: string }> };

// Throttle presence sampling per-network to reduce database writes. This is a
// deliberately honest limitation: presence is only ever sampled while someone
// has the members list open — there is no background scheduler, so a network
// nobody is viewing accumulates no history.
const SAMPLE_INTERVAL_MS = 120_000;
const lastSampledAt = new Map<string, number>();

async function maybeSamplePresence(
  nwid: string,
  now: number,
  members: MemberView[]
): Promise<void> {
  const last = lastSampledAt.get(nwid) ?? 0;
  if (now - last < SAMPLE_INTERVAL_MS) return;
  lastSampledAt.set(nwid, now);
  // Reuse the roster already fetched for the response so sampling doesn't
  // trigger a second N+1 controller fan-out. sampleNetworkPresence never throws
  // (best-effort); we still await it so it completes before the response.
  await sampleNetworkPresence(nwid, members);
}

// Same throttling shape as presence sampling above, but for the "new
// unauthorized member" webhook check — kept as a separate map/interval so the
// two features can be tuned independently. Same honest limitation applies:
// this only fires while someone is viewing the network's member list, since
// there is no background scheduler.
const WEBHOOK_CHECK_INTERVAL_MS = 60_000;
const lastWebhookCheckAt = new Map<string, number>();

async function maybeCheckNewMemberWebhook(nwid: string, now: number): Promise<void> {
  const last = lastWebhookCheckAt.get(nwid) ?? 0;
  if (now - last < WEBHOOK_CHECK_INTERVAL_MS) return;
  lastWebhookCheckAt.set(nwid, now);
  // notifyNewUnauthorizedMembers never throws (best-effort, like presence
  // sampling); we still await it so it completes deterministically before the
  // response, without risking the response on failure.
  await notifyNewUnauthorizedMembers(nwid);
}

export async function GET(req: Request, { params }: Ctx) {
  const auth = await requireOrgRole(req, 'member:read');
  if (auth instanceof Response) return auth;
  try {
    const { nwid } = await params;
    if (!(await assertNetworkInOrg(nwid, auth.orgId!))) {
      return apiError('NOT_FOUND', `Network ${nwid} not found.`, 404);
    }
    const members = await listMembers(nwid);
    const now = Date.now();
    await maybeSamplePresence(nwid, now, members);
    await maybeCheckNewMemberWebhook(nwid, now);
    return NextResponse.json({ members });
  } catch (e) {
    return handleRouteError(e);
  }
}
