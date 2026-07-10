// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '../helpers/render';
import { PendingMembers } from '@/components/PendingMembers';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const NWID = 'abcdef0123456789';

const pending = [
  {
    nwid: NWID,
    networkName: 'lan',
    memberId: 'deadbeef01',
    name: 'laptop',
    online: true,
    lastAuthorizedTime: 0,
  },
  {
    nwid: 'ffffffffffffffff',
    networkName: 'guest',
    memberId: 'deadbeef02',
    name: '',
    online: null,
    lastAuthorizedTime: 0,
  },
];

function stubFetch(pendingList: typeof pending = pending) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH' || init?.method === 'DELETE') {
      return new Response(JSON.stringify({}), {
        status: init.method === 'DELETE' ? 204 : 200,
      });
    }
    if (String(url).includes('/api/v1/pending')) {
      return new Response(JSON.stringify({ pending: pendingList }), { status: 200 });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('PendingMembers', () => {
  it('renders pending rows with network name, member, and presence', async () => {
    stubFetch();
    renderWithQuery(<PendingMembers />);
    expect(await screen.findByText('laptop')).toBeInTheDocument();
    expect(screen.getByText('deadbeef01')).toBeInTheDocument();
    expect(screen.getByText('lan')).toBeInTheDocument();
    expect(screen.getByText('guest')).toBeInTheDocument();
    expect(screen.getByText('deadbeef02')).toBeInTheDocument();
  });

  it('shows the empty state when there is nothing pending', async () => {
    stubFetch([]);
    renderWithQuery(<PendingMembers />);
    expect(await screen.findByText(/no devices awaiting authorization/i)).toBeInTheDocument();
  });

  it('PATCHes authorized=true to the right network/member when clicking Authorize', async () => {
    const fetchMock = stubFetch();
    renderWithQuery(<PendingMembers />);
    await screen.findByText('laptop');
    const buttons = screen.getAllByRole('button', { name: /^authorize$/i });
    await userEvent.click(buttons[0]);
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
      expect(patch).toBeDefined();
      expect(patch![0]).toBe(`/api/v1/networks/${NWID}/members/deadbeef01`);
      expect(JSON.parse(patch![1]!.body as string)).toEqual({ authorized: true });
    });
  });

  it('DELETEs the member after confirmation when clicking Deny', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const fetchMock = stubFetch();
    renderWithQuery(<PendingMembers />);
    await screen.findByText('laptop');
    const buttons = screen.getAllByRole('button', { name: /^deny$/i });
    await userEvent.click(buttons[0]);
    await waitFor(() => {
      const del = fetchMock.mock.calls.find(([, init]) => init?.method === 'DELETE');
      expect(del).toBeDefined();
      expect(del![0]).toBe(`/api/v1/networks/${NWID}/members/deadbeef01`);
    });
  });

  it('does not DELETE when the deny confirmation is cancelled', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const fetchMock = stubFetch();
    renderWithQuery(<PendingMembers />);
    await screen.findByText('laptop');
    const buttons = screen.getAllByRole('button', { name: /^deny$/i });
    await userEvent.click(buttons[0]);
    await new Promise(r => setTimeout(r, 20));
    expect(fetchMock.mock.calls.find(([, init]) => init?.method === 'DELETE')).toBeUndefined();
  });

  it('surfaces a controller error when Authorize PATCH fails', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        return new Response(
          JSON.stringify({ error: { code: 'CONTROLLER_UNREACHABLE', message: 'controller down' } }),
          { status: 502 }
        );
      }
      if (String(url).includes('/api/v1/pending')) {
        return new Response(JSON.stringify({ pending }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithQuery(<PendingMembers />);
    await screen.findByText('laptop');
    const buttons = screen.getAllByRole('button', { name: /^authorize$/i });
    await userEvent.click(buttons[0]);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/controller down/i);
  });
});
