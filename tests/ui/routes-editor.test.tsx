// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '../helpers/render';
import { RoutesEditor } from '@/components/networks/RoutesEditor';

afterEach(() => {
  vi.unstubAllGlobals();
});

const NWID = 'abcdef0123456789';

const seededNet = {
  network: {
    nwid: NWID,
    config: {
      routes: [{ target: '10.10.0.0/16', via: null }],
      ipAssignmentPools: [{ ipRangeStart: '10.10.0.1', ipRangeEnd: '10.10.255.254' }],
      v4AssignMode: { zt: true },
      v6AssignMode: { zt: false, '6plane': false, rfc4193: false },
    },
  },
};

function stubFetch(opts: { detailOk?: boolean } = {}) {
  const { detailOk = true } = opts;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') {
      return new Response(
        JSON.stringify({ network: seededNet.network, metaWarning: null }),
        { status: 200 },
      );
    }
    if (String(url).includes('/controller/status')) {
      return new Response(
        JSON.stringify({ address: 'abcdef0123', online: true, version: '1.14.2' }),
        { status: 200 },
      );
    }
    // Network detail (useNetworkDetail).
    if (!detailOk) {
      return new Response(JSON.stringify({ error: { code: 'INTERNAL' } }), { status: 500 });
    }
    return new Response(JSON.stringify(seededNet), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('RoutesEditor', () => {
  it('does not render Save until the detail has seeded (guards against wiping routes/pools)', async () => {
    // Detail query fails, so local state never seeds. The Save button must not
    // be available — otherwise an early click would PATCH the empty initial
    // arrays and erase every managed route and IP pool on the live network.
    stubFetch({ detailOk: false });
    renderWithQuery(<RoutesEditor nwid={NWID} />);
    expect(await screen.findByText(/loading/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save routes/i })).toBeNull();
  });

  it('seeds routes/pools from the server and PATCHes the seeded values on save', async () => {
    const fetchMock = stubFetch();
    renderWithQuery(<RoutesEditor nwid={NWID} />);
    // Save appears only once seeded.
    const save = await screen.findByRole('button', { name: /save routes/i });
    const target = screen.getByLabelText(/route target 1/i) as HTMLInputElement;
    expect(target.value).toBe('10.10.0.0/16');

    await userEvent.click(save);
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
      expect(patch).toBeDefined();
      const sent = JSON.parse(patch![1]!.body as string);
      // The real seeded values are sent, not the empty initial arrays.
      expect(sent.routes).toEqual([{ target: '10.10.0.0/16', via: null }]);
      expect(sent.ipAssignmentPools).toHaveLength(1);
    });
  });
});
