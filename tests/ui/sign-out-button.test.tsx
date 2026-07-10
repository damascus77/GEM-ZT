// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: push }),
}));

import { SignOutButton } from '@/components/SignOutButton';

beforeEach(() => {
  push.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SignOutButton', () => {
  it('POSTs to /api/v1/auth/logout then navigates to /login', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    render(<SignOutButton />);
    await userEvent.click(screen.getByRole('button', { name: /sign out/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/auth/logout', { method: 'POST' })
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith('/login'));
  });

  it('does not navigate and shows an error when logout fails', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);

    render(<SignOutButton />);
    await userEvent.click(screen.getByRole('button', { name: /sign out/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(await screen.findByRole('alert')).toHaveTextContent(/sign out failed/i);
    expect(push).not.toHaveBeenCalled();
  });
});
