// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '../helpers/render';
import { RoutesEditor } from '@/components/networks/RoutesEditor';
import { DnsEditor } from '@/components/networks/DnsEditor';

afterEach(() => {
  vi.unstubAllGlobals();
});

const NWID = 'abcdef0123456789';

const detail = {
  network: {
    nwid: NWID,
    name: 'home-lan',
    description: '',
    tags: [],
    config: {
      id: NWID,
      nwid: NWID,
      name: 'home-lan',
      private: true,
      enableBroadcast: true,
      mtu: 2800,
      multicastLimit: 32,
      routes: [{ target: '10.147.17.0/24', via: null }],
      ipAssignmentPools: [{ ipRangeStart: '10.147.17.1', ipRangeEnd: '10.147.17.254' }],
      v4AssignMode: { zt: true },
      v6AssignMode: { zt: false, '6plane': false, rfc4193: false },
      dns: { domain: 'lan.example', servers: ['10.147.17.53'] },
      rules: [],
      capabilities: [],
      tags: [],
      creationTime: 1,
      revision: 1,
    },
  },
};

function stubFetch() {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'PATCH') {
      return new Response(JSON.stringify({ ...detail, metaWarning: null }), { status: 200 });
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

describe('RoutesEditor', () => {
  it('renders existing routes and pools', async () => {
    stubFetch();
    renderWithQuery(<RoutesEditor nwid={NWID} />);
    expect(await screen.findByDisplayValue('10.147.17.0/24')).toBeInTheDocument();
    expect(screen.getByDisplayValue('10.147.17.1')).toBeInTheDocument();
    expect(screen.getByDisplayValue('10.147.17.254')).toBeInTheDocument();
  });

  it('adds a pool + route from a CIDR and PATCHes the full config', async () => {
    const fetchMock = stubFetch();
    renderWithQuery(<RoutesEditor nwid={NWID} />);
    await screen.findByDisplayValue('10.147.17.0/24');
    await userEvent.type(screen.getByPlaceholderText(/10\.10\.0\.0\/16/i), '10.10.0.0/16');
    await userEvent.click(screen.getByRole('button', { name: /add pool from cidr/i }));
    await userEvent.click(screen.getByRole('button', { name: /save routes & pools/i }));
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
      expect(patch).toBeDefined();
      const body = JSON.parse(patch![1]!.body as string);
      expect(body.ipAssignmentPools).toContainEqual({
        ipRangeStart: '10.10.0.1',
        ipRangeEnd: '10.10.255.254',
      });
      expect(body.routes).toContainEqual({ target: '10.10.0.0/16', via: null });
      expect(body.v4AssignMode).toEqual({ zt: true });
    });
  });

  it('shows an advisory warning when a pool falls outside every managed route', async () => {
    stubFetch();
    renderWithQuery(<RoutesEditor nwid={NWID} />);
    await screen.findByDisplayValue('10.147.17.0/24');
    // Change the route target so the seeded pool (10.147.17.x) no longer fits.
    const routeInput = screen.getByLabelText(/route target 1/i);
    await userEvent.clear(routeInput);
    await userEvent.type(routeInput, '192.168.5.0/24');
    expect(await screen.findByText(/outside every managed route/i)).toBeInTheDocument();
  });

  it('rejects an invalid CIDR in the helper without PATCHing', async () => {
    const fetchMock = stubFetch();
    renderWithQuery(<RoutesEditor nwid={NWID} />);
    await screen.findByDisplayValue('10.147.17.0/24');
    await userEvent.type(screen.getByPlaceholderText(/10\.10\.0\.0\/16/i), 'banana');
    await userEvent.click(screen.getByRole('button', { name: /add pool from cidr/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/valid ipv4 cidr/i);
    expect(fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH')).toBeUndefined();
  });
});

describe('DnsEditor', () => {
  it('PATCHes domain and servers (one per line)', async () => {
    const fetchMock = stubFetch();
    renderWithQuery(<DnsEditor nwid={NWID} />);
    const domain = await screen.findByLabelText(/search domain/i);
    expect(domain).toHaveValue('lan.example');
    const servers = screen.getByLabelText(/dns servers/i);
    await userEvent.clear(servers);
    await userEvent.type(servers, '10.147.17.53{enter}10.147.17.54');
    await userEvent.click(screen.getByRole('button', { name: /save dns/i }));
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
      expect(patch).toBeDefined();
      expect(JSON.parse(patch![1]!.body as string)).toEqual({
        dns: { domain: 'lan.example', servers: ['10.147.17.53', '10.147.17.54'] },
      });
    });
  });
});
