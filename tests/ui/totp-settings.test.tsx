// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TotpSettings } from '@/components/TotpSettings';

vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn(async () => 'data:image/png;base64,mock-qr') },
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TotpSettings', () => {
  it('shows a "Set up 2FA" button when not enabled', () => {
    render(<TotpSettings initialEnabled={false} />);
    expect(screen.getByRole('button', { name: /set up 2fa/i })).toBeInTheDocument();
  });

  it('enrolls, shows the QR code and secret, then enables on a correct code', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes('/totp/enroll')) {
        return new Response(
          JSON.stringify({
            secret: 'ABCDEFGHIJKLMNOP',
            otpauthUri: 'otpauth://totp/GEM-ZT:admin?secret=ABCDEFGHIJKLMNOP',
          }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ enabled: true }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<TotpSettings initialEnabled={false} />);
    await userEvent.click(screen.getByRole('button', { name: /set up 2fa/i }));

    expect(await screen.findByText('ABCDEFGHIJKLMNOP')).toBeInTheDocument();
    expect(await screen.findByAltText(/2fa qr code/i)).toHaveAttribute(
      'src',
      'data:image/png;base64,mock-qr'
    );

    await userEvent.type(screen.getByLabelText(/6-digit code/i), '123456');
    await userEvent.click(screen.getByRole('button', { name: /confirm and enable/i }));

    await waitFor(() => {
      const enableCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/totp/enable'));
      expect(enableCall).toBeDefined();
      expect(JSON.parse((enableCall![1] as RequestInit).body as string)).toEqual({
        code: '123456',
      });
    });
    expect(await screen.findByText(/is enabled/i)).toBeInTheDocument();
  });

  it('shows an error when confirming with a wrong code', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/totp/enroll')) {
        return new Response(
          JSON.stringify({
            secret: 'ABCDEFGHIJKLMNOP',
            otpauthUri: 'otpauth://totp/GEM-ZT:admin?secret=ABCDEFGHIJKLMNOP',
          }),
          { status: 200 }
        );
      }
      return new Response(
        JSON.stringify({
          error: { code: 'INVALID_TOTP', message: 'Invalid or expired TOTP code.' },
        }),
        { status: 400 }
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<TotpSettings initialEnabled={false} />);
    await userEvent.click(screen.getByRole('button', { name: /set up 2fa/i }));
    await screen.findByText('ABCDEFGHIJKLMNOP');
    await userEvent.type(screen.getByLabelText(/6-digit code/i), '000000');
    await userEvent.click(screen.getByRole('button', { name: /confirm and enable/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid or expired TOTP code.');
  });

  it('disables 2FA with the current password when enabled', async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify({ enabled: false }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<TotpSettings initialEnabled={true} />);
    expect(screen.getByText(/is enabled/i)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/current password/i), 'password12345');
    await userEvent.click(screen.getByRole('button', { name: /disable 2fa/i }));

    await waitFor(() => {
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('/api/v1/auth/totp/disable');
      expect(JSON.parse((init as RequestInit).body as string)).toEqual({
        currentPassword: 'password12345',
      });
    });
    expect(await screen.findByRole('button', { name: /set up 2fa/i })).toBeInTheDocument();
  });
});
