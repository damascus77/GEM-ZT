import { describe, it, expect, vi } from 'vitest';
import { ControllerClient } from '@/lib/controller/client';

function jsonFetch(body: unknown) {
  return vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
  ) as unknown as typeof globalThis.fetch;
}

function lastCall(fetchFn: typeof globalThis.fetch): [string, RequestInit] {
  const calls = (fetchFn as ReturnType<typeof vi.fn>).mock.calls;
  return calls[calls.length - 1] as [string, RequestInit];
}

const netBody = { id: 'abcdef0123456789', nwid: 'abcdef0123456789', name: 'lan' };

describe('ControllerClient network methods', () => {
  it('listNetworkIds GETs /controller/network', async () => {
    const fetchFn = jsonFetch(['abcdef0123456789']);
    const client = new ControllerClient({ baseUrl: 'http://zt:9993', token: 't', fetchFn });
    await expect(client.listNetworkIds()).resolves.toEqual(['abcdef0123456789']);
    expect(lastCall(fetchFn)[0]).toBe('http://zt:9993/controller/network');
  });

  it('getNetwork GETs /controller/network/{nwid}', async () => {
    const fetchFn = jsonFetch(netBody);
    const client = new ControllerClient({ baseUrl: 'http://zt:9993', token: 't', fetchFn });
    const net = await client.getNetwork('abcdef0123456789');
    expect(net.id).toBe('abcdef0123456789');
    expect(lastCall(fetchFn)[0]).toBe('http://zt:9993/controller/network/abcdef0123456789');
  });

  it('createNetwork POSTs /controller/network/{nodeId}______ with the config body', async () => {
    const fetchFn = jsonFetch(netBody);
    const client = new ControllerClient({ baseUrl: 'http://zt:9993', token: 't', fetchFn });
    await client.createNetwork('abcdef0123', { name: 'lan', private: true });
    const [url, init] = lastCall(fetchFn);
    expect(url).toBe('http://zt:9993/controller/network/abcdef0123______');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ name: 'lan', private: true });
  });

  it('updateNetwork POSTs /controller/network/{nwid}', async () => {
    const fetchFn = jsonFetch(netBody);
    const client = new ControllerClient({ baseUrl: 'http://zt:9993', token: 't', fetchFn });
    await client.updateNetwork('abcdef0123456789', { mtu: 2800 });
    const [url, init] = lastCall(fetchFn);
    expect(url).toBe('http://zt:9993/controller/network/abcdef0123456789');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ mtu: 2800 });
  });

  it('deleteNetwork DELETEs /controller/network/{nwid}', async () => {
    const fetchFn = jsonFetch({});
    const client = new ControllerClient({ baseUrl: 'http://zt:9993', token: 't', fetchFn });
    await client.deleteNetwork('abcdef0123456789');
    const [url, init] = lastCall(fetchFn);
    expect(url).toBe('http://zt:9993/controller/network/abcdef0123456789');
    expect(init.method).toBe('DELETE');
  });
});
