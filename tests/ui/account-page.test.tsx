// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import AccountPage from '@/app/(ui)/account/page';

vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn(async () => 'data:image/png;base64,mock-qr') },
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AccountPage', () => {
  it('loads the profile and renders username, password, and 2FA sections', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ user: { id: 'u1', username: 'admin', role: 'admin', totpEnabled: false } }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<AccountPage />);

    expect((await screen.findAllByText('admin')).length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: /password/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /two-factor authentication/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /set up 2fa/i })).toBeInTheDocument();
  });

  it('renders the 2FA section as enabled when the profile reports totpEnabled=true', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ user: { id: 'u1', username: 'admin', role: 'admin', totpEnabled: true } }),
          { status: 200 },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(<AccountPage />);

    expect(await screen.findByText(/is enabled/i)).toBeInTheDocument();
  });
});
