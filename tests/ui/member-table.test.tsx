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
    connection: 'direct',
    latency: 42,
    physicalAddress: '203.0.113.9/41234',
    clientVersion: '1.14.2',
    capabilities: [2000],
    tags: [[1000, 5]] as [number, number][],
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
    connection: null,
    latency: null,
    physicalAddress: null,
    clientVersion: null,
    capabilities: [] as number[],
    tags: [] as [number, number][],
  },
];

const rulesMaps = {
  source: '',
  rules: [],
  sourceIsDefault: true,
  capabilities: { superuser: 2000 },
  tags: { department: 1000 },
};

function stubFetch({
  withRules = false,
  presence,
}: { withRules?: boolean; presence?: Record<string, unknown> } = {}) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH' || init?.method === 'DELETE') {
      return new Response(JSON.stringify({ member: members[1], metaWarning: null }), {
        status: init.method === 'DELETE' ? 204 : 200,
      });
    }
    if (String(url).includes('/controller/status')) {
      return new Response(
        JSON.stringify({ address: 'abcdef0123', online: true, version: '1.14.2' }),
        { status: 200 }
      );
    }
    if (String(url).includes('/rules')) {
      if (!withRules) return new Response(JSON.stringify({}), { status: 200 });
      return new Response(JSON.stringify(rulesMaps), { status: 200 });
    }
    if (String(url).includes('/presence')) {
      return new Response(JSON.stringify({ presence: presence ?? {} }), { status: 200 });
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
    expect(await screen.findByDisplayValue('laptop')).toBeInTheDocument();
    expect(screen.getByText('deadbeef01')).toBeInTheDocument();
    expect(screen.getByText('Online')).toBeInTheDocument();
    expect(screen.getByText('42 ms')).toBeInTheDocument();
    expect(screen.getByText('203.0.113.9/41234')).toBeInTheDocument();
    expect(screen.getByText('Unknown')).toBeInTheDocument();
    // Committed managed IPs now render as removable chips, not an input value.
    expect(screen.getByText('IP accepted: 10.147.17.10')).toBeInTheDocument();
  });

  it('renders last-seen text and a presence sparkline when presence data is stubbed', async () => {
    const recent = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    stubFetch({
      presence: {
        deadbeef01: { lastSeen: recent, samples: [true, false, true] },
      },
    });
    renderWithQuery(<MemberTable nwid={NWID} />);
    await screen.findByDisplayValue('laptop');
    expect(await screen.findByText(/last seen: 5m ago/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Presence history for deadbeef01')).toBeInTheDocument();
  });

  it('renders a Connection column with a Direct pill and a — for unknown peers', async () => {
    stubFetch();
    renderWithQuery(<MemberTable nwid={NWID} />);
    await screen.findByDisplayValue('laptop');
    // Column header present.
    expect(screen.getByRole('columnheader', { name: /connection/i })).toBeInTheDocument();
    // deadbeef01 has connection 'direct'; deadbeef02 has none (—).
    expect(screen.getByText('Direct')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('exposes MemberRow as a memoized component', () => {
    expect((MemberRow as unknown as { $$typeof: symbol }).$$typeof).toBe(Symbol.for('react.memo'));
  });

  it('renders no presence UI when the presence query is not stubbed (degrades gracefully)', async () => {
    stubFetch();
    renderWithQuery(<MemberTable nwid={NWID} />);
    await screen.findByDisplayValue('laptop');
    expect(screen.queryByText(/last seen:/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Presence history for/i)).not.toBeInTheDocument();
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

  it('appends an IP and clears the input when adding a managed IP', async () => {
    const fetchMock = stubFetch();
    renderWithQuery(<MemberTable nwid={NWID} />);
    const ipInput = (await screen.findByLabelText(
      'Add IP assignment for deadbeef01'
    )) as HTMLInputElement;
    await userEvent.type(ipInput, '10.147.17.11');
    await userEvent.click(screen.getAllByRole('button', { name: /add ip/i })[0]);
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
      expect(patch).toBeDefined();
      // The committed IP (10.147.17.10) is preserved and the new one appended.
      expect(JSON.parse(patch![1]!.body as string)).toEqual({
        ipAssignments: ['10.147.17.10', '10.147.17.11'],
      });
    });
    // Input clears once the append lands, ready for the next IP.
    await waitFor(() => expect(ipInput.value).toBe(''));
  });

  it('removes a committed managed IP via its red × chip button', async () => {
    const fetchMock = stubFetch();
    renderWithQuery(<MemberTable nwid={NWID} />);
    await screen.findByText('IP accepted: 10.147.17.10');
    await userEvent.click(screen.getByRole('button', { name: 'Remove IP 10.147.17.10' }));
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        ([u, i]) => String(u).endsWith('/members/deadbeef01') && i?.method === 'PATCH'
      );
      expect(patch).toBeDefined();
      expect(JSON.parse(patch![1]!.body as string)).toEqual({ ipAssignments: [] });
    });
  });

  it('accepts an IPv6 managed IP (M8) and PATCHes it appended to the committed list', async () => {
    const fetchMock = stubFetch();
    renderWithQuery(<MemberTable nwid={NWID} />);
    const ipInput = await screen.findByLabelText('Add IP assignment for deadbeef01');
    await userEvent.type(ipInput, 'fd00::1');
    await userEvent.click(screen.getAllByRole('button', { name: /add ip/i })[0]);
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
      expect(patch).toBeDefined();
      expect(JSON.parse(patch![1]!.body as string)).toEqual({
        ipAssignments: ['10.147.17.10', 'fd00::1'],
      });
    });
  });

  it('rejects a malformed managed IP with an inline error and no PATCH', async () => {
    const fetchMock = stubFetch();
    renderWithQuery(<MemberTable nwid={NWID} />);
    const ipInput = await screen.findByLabelText('Add IP assignment for deadbeef01');
    await userEvent.type(ipInput, 'not-an-ip');
    await userEvent.click(screen.getAllByRole('button', { name: /add ip/i })[0]);
    expect(await screen.findByText(/valid IPv4 or IPv6 address/i)).toBeInTheDocument();
    expect(fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')).toBeUndefined();
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
          { status: 502 }
        );
      }
      if (String(url).includes('/controller/status')) {
        return new Response(
          JSON.stringify({ address: 'abcdef0123', online: true, version: '1.14.2' }),
          { status: 200 }
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
          { status: 502 }
        );
      }
      if (String(url).includes('/controller/status')) {
        return new Response(
          JSON.stringify({ address: 'abcdef0123', online: true, version: '1.14.2' }),
          { status: 200 }
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
    await new Promise(r => setTimeout(r, 20));
    expect(fetchMock.mock.calls.find(([, init]) => init?.method === 'DELETE')).toBeUndefined();
  });

  it('filters members by free-text search', async () => {
    stubFetch();
    renderWithQuery(<MemberTable nwid={NWID} />);
    await screen.findByDisplayValue('laptop');
    await userEvent.type(screen.getByLabelText(/search members/i), 'laptop');
    expect(screen.getByLabelText('Nickname for deadbeef01')).toHaveValue('laptop');
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
        ([u, i]) => String(u).endsWith('/members/deadbeef02') && i?.method === 'PATCH'
      );
      expect(patch).toBeDefined();
      expect(JSON.parse(patch![1]!.body as string)).toEqual({ authorized: true });
    });
  });

  it('"Select offline" selects only currently-offline members for bulk cleanup', async () => {
    const withOffline = [
      { ...members[0] }, // laptop, online: true
      { ...members[1], memberId: 'deadbeef03', online: false }, // offline
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('/controller/status')) {
          return new Response(
            JSON.stringify({ address: 'abcdef0123', online: true, version: '1.14.2' }),
            { status: 200 }
          );
        }
        return new Response(JSON.stringify({ members: withOffline }), { status: 200 });
      })
    );
    renderWithQuery(<MemberTable nwid={NWID} />);
    await screen.findByText('deadbeef03');
    await userEvent.click(screen.getByRole('button', { name: /select offline/i }));
    expect(screen.getByLabelText('Select member deadbeef03')).toBeChecked();
    expect(screen.getByLabelText('Select member deadbeef01')).not.toBeChecked();
    expect(screen.getByText(/1 selected/)).toBeInTheDocument();
  });

  it('toggles noAutoAssignIps via the per-member checkbox', async () => {
    const fetchMock = stubFetch();
    renderWithQuery(<MemberTable nwid={NWID} />);
    await screen.findByText('deadbeef02');
    await userEvent.click(screen.getByLabelText('Disable auto-assign IPs for deadbeef02'));
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        ([u, i]) => String(u).endsWith('/members/deadbeef02') && i?.method === 'PATCH'
      );
      expect(patch).toBeDefined();
      expect(JSON.parse(patch![1]!.body as string)).toEqual({ noAutoAssignIps: true });
    });
  });

  it('renders no capability/tag controls when the rules maps are missing (not stubbed)', async () => {
    stubFetch({ withRules: false });
    renderWithQuery(<MemberTable nwid={NWID} />);
    await screen.findByDisplayValue('laptop');
    expect(screen.queryByLabelText(/^capability /i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^tag /i)).not.toBeInTheDocument();
  });

  it('renders a capability checkbox reflecting current state and PATCHes the toggled set', async () => {
    const fetchMock = stubFetch({ withRules: true });
    renderWithQuery(<MemberTable nwid={NWID} />);
    await screen.findByText('deadbeef02');

    // deadbeef01 already has capability 2000 -> checked.
    const checkedBox = screen.getByLabelText('Capability superuser for deadbeef01');
    expect(checkedBox).toBeChecked();

    // deadbeef02 has no capabilities -> unchecked; toggling it on PATCHes [2000].
    const uncheckedBox = screen.getByLabelText('Capability superuser for deadbeef02');
    expect(uncheckedBox).not.toBeChecked();
    await userEvent.click(uncheckedBox);
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        ([u, i]) => String(u).endsWith('/members/deadbeef02') && i?.method === 'PATCH'
      );
      expect(patch).toBeDefined();
      expect(JSON.parse(patch![1]!.body as string)).toEqual({ capabilities: [2000] });
    });
  });

  it('renders an editable nickname field seeded with the member name and PATCHes it on blur', async () => {
    const fetchMock = stubFetch();
    renderWithQuery(<MemberTable nwid={NWID} />);
    await screen.findByText('deadbeef02');

    const nicknameInput = screen.getByLabelText('Nickname for deadbeef01') as HTMLInputElement;
    expect(nicknameInput.value).toBe('laptop');

    const emptyNicknameInput = screen.getByLabelText('Nickname for deadbeef02') as HTMLInputElement;
    expect(emptyNicknameInput.value).toBe('');
    await userEvent.type(emptyNicknameInput, 'garage-pi');
    await userEvent.tab();
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        ([u, i]) => String(u).endsWith('/members/deadbeef02') && i?.method === 'PATCH'
      );
      expect(patch).toBeDefined();
      expect(JSON.parse(patch![1]!.body as string)).toEqual({ name: 'garage-pi' });
    });
  });

  it('renders a tag input reflecting current value and PATCHes the upserted tag set', async () => {
    const fetchMock = stubFetch({ withRules: true });
    renderWithQuery(<MemberTable nwid={NWID} />);
    await screen.findByText('deadbeef02');

    // deadbeef01 has tag [1000, 5] -> input shows 5.
    const tagInput1 = screen.getByLabelText('Tag department for deadbeef01') as HTMLInputElement;
    expect(tagInput1.value).toBe('5');

    // deadbeef02 has no tags -> empty input; setting it PATCHes [[1000, 7]].
    const tagInput2 = screen.getByLabelText('Tag department for deadbeef02') as HTMLInputElement;
    expect(tagInput2.value).toBe('');
    await userEvent.type(tagInput2, '7');
    await userEvent.tab();
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        ([u, i]) => String(u).endsWith('/members/deadbeef02') && i?.method === 'PATCH'
      );
      expect(patch).toBeDefined();
      expect(JSON.parse(patch![1]!.body as string)).toEqual({ tags: [[1000, 7]] });
    });
  });
});

describe('MemberRow managed IP add/remove', () => {
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
    connection: null,
    latency: null,
    physicalAddress: null,
    clientVersion: null,
    capabilities: [],
    tags: [],
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

  it('renders committed IPs as chips and starts with an empty add-IP input', () => {
    render(wrap({ ...base, ipAssignments: ['10.147.17.10', '10.147.17.11'] }));
    expect(screen.getByLabelText('Add IP assignment for deadbeef01')).toHaveValue('');
    expect(screen.getByText('IP accepted: 10.147.17.10')).toBeInTheDocument();
    expect(screen.getByText('IP accepted: 10.147.17.11')).toBeInTheDocument();
    // Each committed chip exposes a remove control.
    expect(screen.getByRole('button', { name: 'Remove IP 10.147.17.10' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove IP 10.147.17.11' })).toBeInTheDocument();
  });

  it('reflects a server-side IP change (e.g. controller auto-assign) as a new chip', () => {
    const { rerender } = render(wrap({ ...base, ipAssignments: [] }));
    expect(screen.queryByText(/IP accepted:/)).not.toBeInTheDocument();
    // Controller auto-assigns an IP after authorization → chip appears, and the
    // add-input is unaffected (it only ever holds the next IP being added).
    rerender(wrap({ ...base, ipAssignments: ['10.147.17.10'] }));
    expect(screen.getByText('IP accepted: 10.147.17.10')).toBeInTheDocument();
    expect(screen.getByLabelText('Add IP assignment for deadbeef01')).toHaveValue('');
  });
});
