import { describe, it, expect, vi } from 'vitest';
import { ControllerClient, InvalidControllerIdError } from '@/lib/controller/client';

function jsonFetch(body: unknown) {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  ) as unknown as typeof globalThis.fetch;
}

function lastCall(fetchFn: typeof globalThis.fetch): [string, RequestInit] {
  const calls = (fetchFn as ReturnType<typeof vi.fn>).mock.calls;
  return calls[calls.length - 1] as [string, RequestInit];
}

const NWID = 'abcdef0123456789';
const memberBody = { id: 'deadbeef01', nwid: NWID, authorized: true, ipAssignments: [] };

describe('ControllerClient member/peer methods', () => {
  it('listMemberIds GETs /controller/network/{nwid}/member', async () => {
    const fetchFn = jsonFetch({ deadbeef01: 3 });
    const client = new ControllerClient({ baseUrl: 'http://zt:9993', token: 't', fetchFn });
    await expect(client.listMemberIds(NWID)).resolves.toEqual({ deadbeef01: 3 });
    expect(lastCall(fetchFn)[0]).toBe(`http://zt:9993/controller/network/${NWID}/member`);
  });

  it('getMember GETs /controller/network/{nwid}/member/{memberId}', async () => {
    const fetchFn = jsonFetch(memberBody);
    const client = new ControllerClient({ baseUrl: 'http://zt:9993', token: 't', fetchFn });
    const m = await client.getMember(NWID, 'deadbeef01');
    expect(m.id).toBe('deadbeef01');
    expect(lastCall(fetchFn)[0]).toBe(
      `http://zt:9993/controller/network/${NWID}/member/deadbeef01`,
    );
  });

  it('updateMember POSTs the config body', async () => {
    const fetchFn = jsonFetch(memberBody);
    const client = new ControllerClient({ baseUrl: 'http://zt:9993', token: 't', fetchFn });
    await client.updateMember(NWID, 'deadbeef01', {
      authorized: true,
      ipAssignments: ['10.147.17.10'],
    });
    const [url, init] = lastCall(fetchFn);
    expect(url).toBe(`http://zt:9993/controller/network/${NWID}/member/deadbeef01`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      authorized: true,
      ipAssignments: ['10.147.17.10'],
    });
  });

  it('deleteMember DELETEs the member', async () => {
    const fetchFn = jsonFetch({});
    const client = new ControllerClient({ baseUrl: 'http://zt:9993', token: 't', fetchFn });
    await client.deleteMember(NWID, 'deadbeef01');
    const [url, init] = lastCall(fetchFn);
    expect(url).toBe(`http://zt:9993/controller/network/${NWID}/member/deadbeef01`);
    expect(init.method).toBe('DELETE');
  });

  it('rejects a malformed memberId before issuing a request', async () => {
    const fetchFn = jsonFetch(memberBody);
    const client = new ControllerClient({ baseUrl: 'http://zt:9993', token: 't', fetchFn });
    await expect(client.getMember(NWID, '../../status')).rejects.toBeInstanceOf(
      InvalidControllerIdError,
    );
    await expect(client.updateMember(NWID, 'NOTHEX', {})).rejects.toBeInstanceOf(
      InvalidControllerIdError,
    );
    expect((fetchFn as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });

  it('rejects a malformed nwid before issuing a request', async () => {
    const fetchFn = jsonFetch(memberBody);
    const client = new ControllerClient({ baseUrl: 'http://zt:9993', token: 't', fetchFn });
    await expect(client.listMemberIds('short')).rejects.toBeInstanceOf(InvalidControllerIdError);
    expect((fetchFn as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });

  it('listPeers GETs /peer', async () => {
    const fetchFn = jsonFetch([{ address: 'deadbeef01', latency: 12, paths: [] }]);
    const client = new ControllerClient({ baseUrl: 'http://zt:9993', token: 't', fetchFn });
    const peers = await client.listPeers();
    expect(peers[0].address).toBe('deadbeef01');
    expect(lastCall(fetchFn)[0]).toBe('http://zt:9993/peer');
  });
});
