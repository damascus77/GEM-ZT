// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@testing-library/react';
import { PasswordSettings } from '@/components/PasswordSettings';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PasswordSettings', () => {
  it('refuses to submit when the new passwords do not match (no fetch)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<PasswordSettings />);
    await userEvent.type(screen.getByLabelText(/current password/i), 'password12345');
    await userEvent.type(screen.getByLabelText(/^new password$/i), 'new-password-999');
    await userEvent.type(screen.getByLabelText(/confirm new password/i), 'different');
    await userEvent.click(screen.getByRole('button', { name: /change password/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('New passwords do not match.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('PATCHes /api/v1/auth/password and shows a success message', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<PasswordSettings />);
    await userEvent.type(screen.getByLabelText(/current password/i), 'password12345');
    await userEvent.type(screen.getByLabelText(/^new password$/i), 'new-password-999');
    await userEvent.type(screen.getByLabelText(/confirm new password/i), 'new-password-999');
    await userEvent.click(screen.getByRole('button', { name: /change password/i }));
    expect(await screen.findByRole('status')).toHaveTextContent(/other sessions/i);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/auth/password');
    expect(init!.method).toBe('PATCH');
    expect(JSON.parse(init!.body as string)).toEqual({
      currentPassword: 'password12345',
      newPassword: 'new-password-999',
    });
  });

  it('shows the error envelope message when the current password is wrong', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ error: { code: 'CURRENT_PASSWORD_INVALID', message: 'Current password is incorrect.' } }),
          { status: 400 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<PasswordSettings />);
    await userEvent.type(screen.getByLabelText(/current password/i), 'wrong');
    await userEvent.type(screen.getByLabelText(/^new password$/i), 'new-password-999');
    await userEvent.type(screen.getByLabelText(/confirm new password/i), 'new-password-999');
    await userEvent.click(screen.getByRole('button', { name: /change password/i }));
    await waitFor(async () => {
      expect(await screen.findByRole('alert')).toHaveTextContent('Current password is incorrect.');
    });
  });
});
