import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api/auth';
import { handleRouteError } from '@/lib/api/errors';
import { listMembers } from '@/lib/services/members';
import { sampleNetworkPresence } from '@/lib/services/presence';
import { notifyNewUnauthorizedMembers } from '@/lib/services/webhooks';

type Ctx = { params: { nwid: string } };

// Throttle presence sampling per-network so a busy members list (polled every
// 10s per open tab) doesn't write a presence row on every request. This is a
// deliberately honest limitation: presence is only ever sampled while someone
// has the members list open — there is no background scheduler, so a network
// nobody is viewing accumulates no history.
const SAMPLE_INTERVAL_MS = 60_000;
const lastSampledAt = new Map<string, number>();

async function maybeSamplePresence(nwid: string, now: number): Promise<void> {
  const last = lastSampledAt.get(nwid) ?? 0;
  if (now - last < SAMPLE_INTERVAL_MS) return;
  lastSampledAt.set(nwid, now);
  // sampleNetworkPresence never throws (best-effort, like audit/retention); we
  // still await it so it completes deterministically before the response.
  await sampleNetworkPresence(nwid);
}

// Same throttling shape as presence sampling above, but for the "new
// unauthorized member" webhook check — kept as a separate map/interval so the
// two features can be tuned independently. Same honest limitation applies:
// this only fires while someone is viewing the network's member list, since
// there is no background scheduler.
const WEBHOOK_CHECK_INTERVAL_MS = 30_000;
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
  const auth = await requireAuth(req);
  if (auth instanceof Response) return auth;
  try {
    const members = await listMembers(params.nwid);
    const now = Date.now();
    await maybeSamplePresence(params.nwid, now);
    await maybeCheckNewMemberWebhook(params.nwid, now);
    return NextResponse.json({ members });
  } catch (e) {
    return handleRouteError(e);
  }
}
