// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '../helpers/render';
import { MemberTable } from '@/components/members/MemberTable';

afterEach(() => {
  vi.unstubAllGlobals();
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

  it('DELETEs a member', async () => {
    const fetchMock = stubFetch();
    renderWithQuery(<MemberTable nwid={NWID} />);
    await screen.findByText('deadbeef02');
    await userEvent.click(screen.getAllByRole('button', { name: /remove/i })[0]);
    await waitFor(() => {
      const del = fetchMock.mock.calls.find(([, init]) => init?.method === 'DELETE');
      expect(del).toBeDefined();
      expect(del![0]).toBe(`/api/v1/networks/${NWID}/members/deadbeef01`);
    });
  });
});
