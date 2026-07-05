// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '../helpers/render';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: push }),
}));

import { InviteAccept } from '@/app/(auth)/invite/[token]/InviteAccept';

beforeEach(() => {
  push.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const TOKEN = 'sometoken123';

describe('InviteAccept', () => {
  it('shows org + role and a form when the token previews as valid', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        expect(url).toBe(`/api/v1/invitations/${TOKEN}`);
        return new Response(JSON.stringify({ org: { name: 'Acme Co' }, role: 'admin' }), { status: 200 });
      }),
    );
    renderWithQuery(<InviteAccept token={TOKEN} />);
    expect(await screen.findByText(/acme co/i)).toBeInTheDocument();
    expect(screen.getByText(/admin/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
  });

  it('submitting the form POSTs to the accept endpoint and redirects on success', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === `/api/v1/invitations/${TOKEN}`) {
        return new Response(JSON.stringify({ org: { name: 'Acme Co' }, role: 'editor' }), { status: 200 });
      }
      if (url === `/api/v1/invitations/${TOKEN}/accept` && init?.method === 'POST') {
        return new Response(JSON.stringify({ user: { id: 'u1', username: 'newuser' } }), { status: 201 });
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const originalLocation = window.location;
    // @ts-expect-error test override of window.location
    delete window.location;
    // @ts-expect-error test override of window.location
    window.location = { ...originalLocation, href: '' };

    renderWithQuery(<InviteAccept token={TOKEN} />);
    await screen.findByText(/acme co/i);
    await userEvent.type(screen.getByLabelText(/username/i), 'newuser');
    await userEvent.type(screen.getByLabelText(/password/i), 'password12345');
    await userEvent.click(screen.getByRole('button', { name: /accept|join|create account/i }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([u, i]) => u === `/api/v1/invitations/${TOKEN}/accept` && i?.method === 'POST');
      expect(post).toBeDefined();
      expect(JSON.parse(post![1]!.body as string)).toEqual({ username: 'newuser', password: 'password12345' });
    });
    await waitFor(() => expect(window.location.href).toBe('/'));

    // @ts-expect-error restore
    window.location = originalLocation;
  });

  it('surfaces USERNAME_TAKEN error on accept without redirecting', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === `/api/v1/invitations/${TOKEN}`) {
          return new Response(JSON.stringify({ org: { name: 'Acme Co' }, role: 'editor' }), { status: 200 });
        }
        if (url === `/api/v1/invitations/${TOKEN}/accept` && init?.method === 'POST') {
          return new Response(
            JSON.stringify({ error: { code: 'USERNAME_TAKEN', message: 'That username is already in use.' } }),
            { status: 409 },
          );
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );
    renderWithQuery(<InviteAccept token={TOKEN} />);
    await screen.findByText(/acme co/i);
    await userEvent.type(screen.getByLabelText(/username/i), 'taken');
    await userEvent.type(screen.getByLabelText(/password/i), 'password12345');
    await userEvent.click(screen.getByRole('button', { name: /accept|join|create account/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/already in use/i);
  });

  it('shows a not-found message with no form for an unknown token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Invitation not found.' } }), { status: 404 }),
      ),
    );
    renderWithQuery(<InviteAccept token={TOKEN} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/invitation not found/i);
    expect(screen.queryByLabelText(/username/i)).toBeNull();
  });

  it('shows an expired message with no form for an expired token (410)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ error: { code: 'INVITATION_EXPIRED', message: 'This invitation has expired.' } }), {
          status: 410,
        }),
      ),
    );
    renderWithQuery(<InviteAccept token={TOKEN} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/expired/i);
    expect(screen.queryByLabelText(/username/i)).toBeNull();
  });

  it('shows an already-used message with no form for a used token (409)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ error: { code: 'INVITATION_USED', message: 'This invitation has already been used.' } }), {
          status: 409,
        }),
      ),
    );
    renderWithQuery(<InviteAccept token={TOKEN} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/already been used/i);
    expect(screen.queryByLabelText(/username/i)).toBeNull();
  });
});
