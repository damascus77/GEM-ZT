import { describe, it, expect, beforeEach, vi } from 'vitest';

// The route resolves auth + active org via requireOrgRole; mock it so the test
// focuses on the stream behavior (framing, org filtering) against the real bus.
vi.mock('@/lib/api/authz', () => ({ requireOrgRole: vi.fn() }));

import { requireOrgRole } from '@/lib/api/authz';
import { GET } from '@/app/api/v1/events/route';
import { publish, subscriberCount, type AppEvent } from '@/lib/events/bus';

const authMock = vi.mocked(requireOrgRole);

function asOrg(orgId: string | null) {
  authMock.mockResolvedValue({ user: {} as never, isSuperAdmin: false, orgId, role: 'viewer' });
}

async function readFrame(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  const { value } = await reader.read();
  return new TextDecoder().decode(value);
}

beforeEach(() => {
  authMock.mockReset();
});

describe('GET /api/v1/events (SSE)', () => {
  it('returns the auth Response unchanged when unauthenticated', async () => {
    authMock.mockResolvedValue(new Response('nope', { status: 401 }));
    const res = await GET(new Request('http://x/api/v1/events'));
    expect(res.status).toBe(401);
  });

  it('opens an event-stream, filters other orgs, and delivers matching + instance-wide events', async () => {
    asOrg('org-1');
    const ac = new AbortController();
    const res = await GET(new Request('http://x/api/v1/events', { signal: ac.signal }));

    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(res.headers.get('cache-control')).toContain('no-cache');

    const reader = res.body!.getReader();
    expect(await readFrame(reader)).toContain(': connected');

    // org-2 event is filtered out; org-1 event is delivered.
    publish({ type: 'members.changed', nwid: 'nA', orgId: 'org-2' });
    publish({ type: 'members.changed', nwid: 'nB', orgId: 'org-1' });
    const frame = await readFrame(reader);
    expect(JSON.parse(frame.replace(/^data: /, '').trim())).toEqual({
      type: 'members.changed',
      nwid: 'nB',
      orgId: 'org-1',
    });

    // Instance-wide events (no orgId) reach every subscriber.
    publish({ type: 'controller.degraded' } as AppEvent);
    const wide = await readFrame(reader);
    expect(JSON.parse(wide.replace(/^data: /, '').trim())).toEqual({ type: 'controller.degraded' });

    // Cancelling the reader tears down the subscription (no leak).
    await reader.cancel();
    expect(subscriberCount()).toBe(0);
  });

  it('unsubscribes from the bus when the request aborts', async () => {
    asOrg('org-1');
    const ac = new AbortController();
    const res = await GET(new Request('http://x/api/v1/events', { signal: ac.signal }));
    const reader = res.body!.getReader();
    await readFrame(reader); // consume ': connected'
    expect(subscriberCount()).toBe(1);
    ac.abort();
    expect(subscriberCount()).toBe(0);
    await reader.cancel().catch(() => undefined);
  });
});
