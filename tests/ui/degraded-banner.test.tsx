// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithQuery } from '../helpers/render';
import { DegradedBanner } from '@/components/DegradedBanner';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DegradedBanner', () => {
  it('shows a persistent alert when the controller is unreachable (502)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ error: { code: 'CONTROLLER_UNREACHABLE', message: 'down' } }),
            { status: 502 }
          )
      )
    );
    renderWithQuery(<DegradedBanner />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/controller degraded/i);
    expect(alert).toHaveTextContent(/changes are disabled/i);
  });

  it('shows a persistent alert when fetch rejects (offline/network error)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      })
    );
    renderWithQuery(<DegradedBanner />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/controller degraded/i);
  });

  it('renders nothing when the controller is healthy', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ address: 'abcdef0123', online: true, version: '1.14.2' }), {
            status: 200,
          })
      )
    );
    renderWithQuery(<DegradedBanner />);
    await new Promise(r => setTimeout(r, 50));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
