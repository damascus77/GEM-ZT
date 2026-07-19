// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '../helpers/render';
import { NetworkList } from '@/components/networks/NetworkList';

afterEach(() => {
  vi.unstubAllGlobals();
});

const networks = [
  {
    nwid: 'abcdef0123456789',
    name: 'home-lan',
    description: 'house',
    tags: ['home'],
    private: true,
    memberCount: 3,
  },
  {
    nwid: 'bbbbbbbb00000002',
    name: 'guest-wifi',
    description: '',
    tags: [],
    private: false,
    memberCount: 12,
  },
];

describe('NetworkList', () => {
  it('uses skeleton cards instead of a bare loading message on first load', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Promise<Response>(() => {}))
    );

    renderWithQuery(<NetworkList />);

    expect(screen.getByRole('heading', { name: 'Networks' })).toBeInTheDocument();
    expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
  });

  it('renders networks from GET /api/v1/networks', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ networks }), { status: 200 }))
    );
    renderWithQuery(<NetworkList />);
    expect(await screen.findByText('home-lan')).toBeInTheDocument();
    expect(screen.getByText('abcdef0123456789')).toBeInTheDocument();
    expect(screen.getByText('Private')).toBeInTheDocument();
    expect(screen.getByText('3 members')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /home-lan/i });
    expect(link).toHaveAttribute('href', '/networks/abcdef0123456789');
  });

  it('filters the list by search text', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ networks }), { status: 200 }))
    );
    renderWithQuery(<NetworkList />);
    await screen.findByText('home-lan');
    expect(screen.getByText('guest-wifi')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/search networks/i), 'guest');
    expect(screen.getByText('guest-wifi')).toBeInTheDocument();
    expect(screen.queryByText('home-lan')).not.toBeInTheDocument();
  });

  it('POSTs the create form to /api/v1/networks', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({ network: networks[0], metaWarning: null }), {
          status: 201,
        });
      }
      return new Response(JSON.stringify({ networks }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithQuery(<NetworkList />);
    await userEvent.type(screen.getByPlaceholderText(/new network name/i), 'office');
    await userEvent.click(screen.getByRole('button', { name: /create network/i }));
    const postCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(postCall[0]).toBe('/api/v1/networks');
    expect(JSON.parse(postCall[1]!.body as string)).toEqual({ name: 'office' });
  });

  it('creates with no name (empty body) when the name field is blank', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({ network: networks[0], metaWarning: null }), {
          status: 201,
        });
      }
      return new Response(JSON.stringify({ networks }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithQuery(<NetworkList />);
    // Do not type a name — the Create button must be enabled and post an empty body.
    const button = screen.getByRole('button', { name: /create network/i });
    expect(button).not.toBeDisabled();
    await userEvent.click(button);
    const postCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(postCall[0]).toBe('/api/v1/networks');
    expect(JSON.parse(postCall[1]!.body as string)).toEqual({});
  });
});
