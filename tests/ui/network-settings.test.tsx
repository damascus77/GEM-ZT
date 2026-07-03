// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
