// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '../helpers/render';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: push }),
}));

import LoginPage from '@/app/(auth)/login/page';
import SetupPage from '@/app/(auth)/setup/page';

beforeEach(() => {
  push.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('LoginPage', () => {
  it('POSTs credentials to /api/v1/auth/login and redirects to /networks', async () => {
    const fetchMock = vi.fn(
      async (url: string, init?: RequestInit) =>
        new Response(JSON.stringify({ user: {} }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);
    renderWithQuery(<LoginPage />);
    await userEvent.type(screen.getByLabelText(/username/i), 'admin');
    await userEvent.type(screen.getByLabelText(/password/i), 'password12345');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/networks'));
    // The page also probes /api/v1/setup/status on mount (SSO button gating), so
    // find the login POST specifically rather than assuming it is the first call.
    const loginCall = fetchMock.mock.calls.find(([url]) => url === '/api/v1/auth/login');
    expect(loginCall).toBeDefined();
    expect(JSON.parse(loginCall![1]!.body as string)).toEqual({
      username: 'admin',
      password: 'password12345',
    });
  });

  it('shows the error envelope message on 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: { code: 'UNAUTHORIZED', message: 'Invalid username or password.' },
            }),
            { status: 401 }
          )
      )
    );
    renderWithQuery(<LoginPage />);
    await userEvent.type(screen.getByLabelText(/username/i), 'admin');
    await userEvent.type(screen.getByLabelText(/password/i), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid username or password.');
  });
});

describe('SetupPage', () => {
  function stubSetupFetch() {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify({ user: {} }), { status: 201 })
    );
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('refuses to submit when passwords do not match (no POST)', async () => {
    const fetchMock = stubSetupFetch();
    renderWithQuery(<SetupPage />);
    await userEvent.type(screen.getByLabelText(/username/i), 'admin');
    await userEvent.type(screen.getByLabelText(/^password$/i), 'password12345');
    await userEvent.type(screen.getByLabelText(/confirm password/i), 'different');
    await userEvent.click(screen.getByRole('button', { name: /create admin account/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Passwords do not match.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POSTs username + password to /api/v1/setup and redirects to /networks on success', async () => {
    const fetchMock = stubSetupFetch();
    renderWithQuery(<SetupPage />);
    await userEvent.type(screen.getByLabelText(/username/i), 'admin');
    await userEvent.type(screen.getByLabelText(/^password$/i), 'password12345');
    await userEvent.type(screen.getByLabelText(/confirm password/i), 'password12345');
    await userEvent.click(screen.getByRole('button', { name: /create admin account/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/networks'));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/setup');
    expect(JSON.parse(init!.body as string)).toEqual({
      username: 'admin',
      password: 'password12345',
    });
  });
});
