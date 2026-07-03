import { describe, it, expect, vi } from 'vitest';
import {
  ControllerClient,
  ControllerApiError,
  ControllerUnreachableError,
} from '@/lib/controller/client';

function jsonFetch(status: number, body: unknown) {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  ) as unknown as typeof globalThis.fetch;
}

describe('ControllerClient.getStatus', () => {
  it('GETs /status with the X-ZT1-AUTH header and parses the response', async () => {
    const fetchFn = jsonFetch(200, { address: 'abcdef0123', online: true, version: '1.14.2' });
    const client = new ControllerClient({ baseUrl: 'http://zt:9993', token: 'tok', fetchFn });
    const status = await client.getStatus();
    expect(status).toEqual({ address: 'abcdef0123', online: true, version: '1.14.2' });
    const [url, init] = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('http://zt:9993/status');
    expect(init.method).toBe('GET');
    expect(init.headers['X-ZT1-AUTH']).toBe('tok');
  });

  it('throws ControllerApiError with the status code on non-2xx', async () => {
    const client = new ControllerClient({
      baseUrl: 'http://zt:9993',
      token: 'bad',
      fetchFn: jsonFetch(401, {}),
    });
    const err = await client.getStatus().catch((e) => e);
    expect(err).toBeInstanceOf(ControllerApiError);
    expect((err as ControllerApiError).status).toBe(401);
  });

  it('throws ControllerUnreachableError when fetch rejects', async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof globalThis.fetch;
    const client = new ControllerClient({ baseUrl: 'http://zt:9993', token: 'tok', fetchFn });
    await expect(client.getStatus()).rejects.toBeInstanceOf(ControllerUnreachableError);
  });
});
