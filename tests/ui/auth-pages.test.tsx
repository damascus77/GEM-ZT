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
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ user: {} }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    renderWithQuery(<LoginPage />);
    await userEvent.type(screen.getByLabelText(/username/i), 'admin');
    await userEvent.type(screen.getByLabelText(/password/i), 'password12345');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/networks'));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/auth/login');
    expect(JSON.parse(init.body)).toEqual({ username: 'admin', password: 'password12345' });
  });

  it('shows the error envelope message on 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Invalid username or password.' } }),
          { status: 401 },
        ),
      ),
    );
    renderWithQuery(<LoginPage />);
    await userEvent.type(screen.getByLabelText(/username/i), 'admin');
    await userEvent.type(screen.getByLabelText(/password/i), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid username or password.');
  });
});

describe('SetupPage', () => {
  // The page fetches /api/v1/setup/status on mount to learn whether a setup token
  // is required; stub it alongside the POST.
  function stubSetupFetch(requiresToken = false) {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/setup/status')) {
        return new Response(
          JSON.stringify({ needsSetup: true, requiresToken }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ user: {} }), { status: 201 });
    });
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
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });

  it('POSTs to /api/v1/setup and redirects to /networks on success', async () => {
    const fetchMock = stubSetupFetch();
    renderWithQuery(<SetupPage />);
    await userEvent.type(screen.getByLabelText(/username/i), 'admin');
    await userEvent.type(screen.getByLabelText(/^password$/i), 'password12345');
    await userEvent.type(screen.getByLabelText(/confirm password/i), 'password12345');
    await userEvent.click(screen.getByRole('button', { name: /create admin account/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/networks'));
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(post?.[0]).toBe('/api/v1/setup');
  });

  it('shows the setup-token field and includes it in the POST when required', async () => {
    const fetchMock = stubSetupFetch(true);
    renderWithQuery(<SetupPage />);
    const tokenField = await screen.findByLabelText(/setup token/i);
    await userEvent.type(screen.getByLabelText(/username/i), 'admin');
    await userEvent.type(screen.getByLabelText(/^password$/i), 'password12345');
    await userEvent.type(screen.getByLabelText(/confirm password/i), 'password12345');
    await userEvent.type(tokenField, 'sekret-token');
    await userEvent.click(screen.getByRole('button', { name: /create admin account/i }));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
      expect(post).toBeDefined();
      expect(JSON.parse(post![1]!.body as string)).toMatchObject({
        username: 'admin',
        setupToken: 'sekret-token',
      });
    });
  });
});
