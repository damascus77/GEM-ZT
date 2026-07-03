// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderWithQuery } from '../helpers/render';
import { MemberTable, MemberRow, type MemberViewClient } from '@/components/members/MemberTable';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const NWID = 'abcdef0123456789';

const members = [
  {
    memberId: 'deadbeef01',
    nwid: NWID,
    name: 'laptop',
    notes: '',
    authorized: true,
    activeBridge: false,
    noAutoAssignIps: false,
    ipAssignments: ['10.147.17.10'],
    lastAuthorizedTime: 1719900000000,
    online: true,
    latency: 42,
    physicalAddress: '203.0.113.9/41234',
    clientVersion: '1.14.2',
  },
  {
    memberId: 'deadbeef02',
    nwid: NWID,
    name: '',
    notes: '',
    authorized: false,
    activeBridge: false,
    noAutoAssignIps: false,
    ipAssignments: [],
    lastAuthorizedTime: 0,
    online: null,
    latency: null,
    physicalAddress: null,
    clientVersion: null,
  },
];

function stubFetch() {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH' || init?.method === 'DELETE') {
      return new Response(JSON.stringify({ member: members[1], metaWarning: null }), {
        status: init.method === 'DELETE' ? 204 : 200,
      });
    }
    if (String(url).includes('/controller/status')) {
      return new Response(
        JSON.stringify({ address: 'abcdef0123', online: true, version: '1.14.2' }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({ members }), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('MemberTable', () => {
  it('renders presence, IPs, latency and shows Unknown for missing peer data', async () => {
    stubFetch();
    renderWithQuery(<MemberTable nwid={NWID} />);
    expect(await screen.findByText('laptop')).toBeInTheDocument();
    expect(screen.getByText('deadbeef01')).toBeInTheDocument();
    expect(screen.getByText('Online')).toBeInTheDocument();
    expect(screen.getByText('42 ms')).toBeInTheDocument();
    expect(screen.getByText('203.0.113.9/41234')).toBeInTheDocument();
    expect(screen.getByText('Unknown')).toBeInTheDocument();
    expect(screen.getByDisplayValue('10.147.17.10')).toBeInTheDocument();
  });

  it('PATCHes authorized=true when clicking Authorize on a pending member', async () => {
    const fetchMock = stubFetch();
    renderWithQuery(<MemberTable nwid={NWID} />);
    await screen.findByText('deadbeef02');
    await userEvent.click(screen.getByRole('button', { name: /^authorize$/i }));
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
      expect(patch).toBeDefined();
      expect(patch![0]).toBe(`/api/v1/networks/${NWID}/members/deadbeef02`);
      expect(JSON.parse(patch![1]!.body as string)).toEqual({ authorized: true });
    });
  });

  it('PATCHes ipAssignments when saving the IP editor', async () => {
    const fetchMock = stubFetch();
    renderWithQuery(<MemberTable nwid={NWID} />);
    const ipInput = await screen.findByDisplayValue('10.147.17.10');
    await userEvent.clear(ipInput);
    await userEvent.type(ipInput, '10.147.17.10, 10.147.17.11');
    await userEvent.click(screen.getAllByRole('button', { name: /save ips/i })[0]);
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
      expect(patch).toBeDefined();
      expect(JSON.parse(patch![1]!.body as string)).toEqual({
        ipAssignments: ['10.147.17.10', '10.147.17.11'],
      });
    });
  });

  it('DELETEs a member after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const fetchMock = stubFetch();
    renderWithQuery(<MemberTable nwid={NWID} />);
    await screen.findByText('deadbeef02');
    await userEvent.click(screen.getAllByRole('button', { name: /^remove$/i })[0]);
    await waitFor(() => {
      const del = fetchMock.mock.calls.find(([, init]) => init?.method === 'DELETE');
      expect(del).toBeDefined();
      expect(del![0]).toBe(`/api/v1/networks/${NWID}/members/deadbeef01`);
    });
  });

  it('surfaces a controller error when Authorize PATCH fails', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        return new Response(
          JSON.stringify({ error: { code: 'CONTROLLER_UNREACHABLE', message: 'controller down' } }),
          { status: 502 },
        );
      }
      if (String(url).includes('/controller/status')) {
        return new Response(
          JSON.stringify({ address: 'abcdef0123', online: true, version: '1.14.2' }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ members }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithQuery(<MemberTable nwid={NWID} />);
    await screen.findByText('deadbeef02');
    await userEvent.click(screen.getByRole('button', { name: /^authorize$/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/controller down/i);
  });

  it('surfaces the parsed controller error message when Remove DELETE fails', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') {
        return new Response(
          JSON.stringify({ error: { code: 'CONTROLLER_UNREACHABLE', message: 'controller down' } }),
          { status: 502 },
        );
      }
      if (String(url).includes('/controller/status')) {
        return new Response(
          JSON.stringify({ address: 'abcdef0123', online: true, version: '1.14.2' }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ members }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithQuery(<MemberTable nwid={NWID} />);
    await screen.findByText('deadbeef02');
    await userEvent.click(screen.getAllByRole('button', { name: /^remove$/i })[0]);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/controller down/i);
  });

  it('does not DELETE when the remove confirmation is cancelled', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const fetchMock = stubFetch();
    renderWithQuery(<MemberTable nwid={NWID} />);
    await screen.findByText('deadbeef02');
    await userEvent.click(screen.getAllByRole('button', { name: /^remove$/i })[0]);
    // Give any (unexpected) request a chance to fire.
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMock.mock.calls.find(([, init]) => init?.method === 'DELETE')).toBeUndefined();
  });

  it('filters members by free-text search', async () => {
    stubFetch();
    renderWithQuery(<MemberTable nwid={NWID} />);
    await screen.findByText('laptop');
    await userEvent.type(screen.getByLabelText(/search members/i), 'laptop');
    expect(screen.getByText('laptop')).toBeInTheDocument();
    expect(screen.queryByText('deadbeef02')).not.toBeInTheDocument();
  });

  it('bulk-authorizes selected members', async () => {
    const fetchMock = stubFetch();
    renderWithQuery(<MemberTable nwid={NWID} />);
    await screen.findByText('deadbeef02');
    await userEvent.click(screen.getByLabelText('Select member deadbeef02'));
    await userEvent.click(screen.getByRole('button', { name: /^authorize selected$/i }));
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        ([u, i]) => String(u).endsWith('/members/deadbeef02') && i?.method === 'PATCH',
      );
      expect(patch).toBeDefined();
      expect(JSON.parse(patch![1]!.body as string)).toEqual({ authorized: true });
    });
  });

  it('toggles noAutoAssignIps via the per-member checkbox', async () => {
    const fetchMock = stubFetch();
    renderWithQuery(<MemberTable nwid={NWID} />);
    await screen.findByText('deadbeef02');
    await userEvent.click(screen.getByLabelText('Disable auto-assign IPs for deadbeef02'));
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        ([u, i]) => String(u).endsWith('/members/deadbeef02') && i?.method === 'PATCH',
      );
      expect(patch).toBeDefined();
      expect(JSON.parse(patch![1]!.body as string)).toEqual({ noAutoAssignIps: true });
    });
  });
});

describe('MemberRow IP input re-seed (stale-IP guard)', () => {
  const base: MemberViewClient = {
    memberId: 'deadbeef01',
    nwid: NWID,
    name: '',
    notes: '',
    authorized: true,
    activeBridge: false,
    noAutoAssignIps: false,
    ipAssignments: [],
    lastAuthorizedTime: 0,
    online: null,
    latency: null,
    physicalAddress: null,
    clientVersion: null,
  };

  function wrap(member: MemberViewClient) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return (
      <QueryClientProvider client={client}>
        <table>
          <tbody>
            <MemberRow member={member} nwid={NWID} degraded={false} onChanged={() => {}} />
          </tbody>
        </table>
      </QueryClientProvider>
    );
  }

  it('re-seeds the IP input when the server assignment changes and the field is untouched', () => {
    const { rerender } = render(wrap({ ...base, ipAssignments: [] }));
    const input = screen.getByLabelText('IP assignments for deadbeef01');
    expect(input).toHaveValue('');
    // Controller auto-assigns an IP after authorization → input must reflect it,
    // otherwise a later "Save IPs" would PATCH the stale (empty) list and wipe it.
    rerender(wrap({ ...base, ipAssignments: ['10.147.17.10'] }));
    expect(screen.getByLabelText('IP assignments for deadbeef01')).toHaveValue('10.147.17.10');
  });

  it('does not clobber an in-progress edit when the server value changes', async () => {
    const { rerender } = render(wrap({ ...base, ipAssignments: ['10.147.17.10'] }));
    const input = screen.getByLabelText('IP assignments for deadbeef01');
    await userEvent.clear(input);
    await userEvent.type(input, '10.0.0.9');
    // A background poll brings a different server value; the operator's edit wins.
    rerender(wrap({ ...base, ipAssignments: ['10.147.17.99'] }));
    expect(screen.getByLabelText('IP assignments for deadbeef01')).toHaveValue('10.0.0.9');
  });
});
