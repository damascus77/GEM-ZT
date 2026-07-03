// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderWithQuery } from '../helpers/render';
import { NetworkSettings } from '@/components/networks/NetworkSettings';

afterEach(() => {
  vi.unstubAllGlobals();
});

const NWID = 'abcdef0123456789';

const detail = {
  network: {
    nwid: NWID,
    name: 'home-lan',
    description: 'house',
    tags: [],
    config: {
      id: NWID,
      nwid: NWID,
      name: 'home-lan',
      private: true,
      enableBroadcast: true,
      mtu: 2800,
      multicastLimit: 32,
      routes: [],
      ipAssignmentPools: [],
      v4AssignMode: { zt: true },
      v6AssignMode: { zt: false, '6plane': false, rfc4193: false },
      dns: { domain: '', servers: [] },
      rules: [],
      capabilities: [],
      tags: [],
      creationTime: 1,
      revision: 1,
    },
  },
};

function stubFetch(patchResponse?: Response) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') {
      return (
        patchResponse ??
        new Response(JSON.stringify({ ...detail, metaWarning: null }), { status: 200 })
      );
    }
    if (String(url).includes('/controller/status')) {
      return new Response(
        JSON.stringify({ address: 'abcdef0123', online: true, version: '1.14.2' }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify(detail), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('NetworkSettings', () => {
  it('loads current values and PATCHes edited core settings', async () => {
    const fetchMock = stubFetch();
    renderWithQuery(<NetworkSettings nwid={NWID} />);
    const mtu = await screen.findByLabelText(/mtu/i);
    expect(mtu).toHaveValue(2800);
    await userEvent.clear(mtu);
    await userEvent.type(mtu, '1400');
    await userEvent.click(screen.getByRole('button', { name: /save settings/i }));
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
      expect(patch).toBeDefined();
      expect(patch![0]).toBe(`/api/v1/networks/${NWID}`);
      expect(JSON.parse(patch![1]!.body as string)).toMatchObject({ mtu: 1400 });
    });
  });

  it('re-seeds from the server when the value changes and the field is untouched', async () => {
    let current = detail;
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/controller/status')) {
        return new Response(
          JSON.stringify({ address: 'abcdef0123', online: true, version: '1.14.2' }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify(current), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } });
    render(
      <QueryClientProvider client={client}>
        <NetworkSettings nwid={NWID} />
      </QueryClientProvider>,
    );
    const mtu = await screen.findByLabelText(/mtu/i);
    expect(mtu).toHaveValue(2800);
    // Simulate an external change picked up by a background refetch.
    current = { network: { ...detail.network, config: { ...detail.network.config, mtu: 1500 } } };
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['network', NWID] });
    });
    await waitFor(() => expect(screen.getByLabelText(/mtu/i)).toHaveValue(1500));
  });

  it('does not clobber an in-progress edit when the server value changes', async () => {
    let current = detail;
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/controller/status')) {
        return new Response(
          JSON.stringify({ address: 'abcdef0123', online: true, version: '1.14.2' }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify(current), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchInterval: false } } });
    render(
      <QueryClientProvider client={client}>
        <NetworkSettings nwid={NWID} />
      </QueryClientProvider>,
    );
    const mtu = await screen.findByLabelText(/mtu/i);
    await userEvent.clear(mtu);
    await userEvent.type(mtu, '9000');
    current = { network: { ...detail.network, config: { ...detail.network.config, mtu: 1500 } } };
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['network', NWID] });
    });
    // The operator's unsaved edit must win over the background refetch.
    expect(screen.getByLabelText(/mtu/i)).toHaveValue(9000);
  });

  it('surfaces metaWarning as a non-blocking notice', async () => {
    stubFetch(
      new Response(
        JSON.stringify({ ...detail, metaWarning: 'The controller accepted the change, but saving GEM-ZT metadata failed.' }),
        { status: 200 },
      ),
    );
    renderWithQuery(<NetworkSettings nwid={NWID} />);
    await screen.findByLabelText(/mtu/i);
    await userEvent.click(screen.getByRole('button', { name: /save settings/i }));
    expect(await screen.findByText(/metadata failed/i)).toBeInTheDocument();
  });
});
