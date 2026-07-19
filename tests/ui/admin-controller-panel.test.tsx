// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithQuery } from '../helpers/render';
import { AdminControllerPanel } from '@/components/AdminControllerPanel';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AdminControllerPanel', () => {
  it('renders controller status, settings, and inventory counts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              address: 'abcdef0123',
              online: true,
              version: '1.14.2',
              controllerUrl: 'http://controller.test:9993',
              timeoutMs: 8000,
              cacheTtlMs: 1234,
              networkCount: 2,
              peerCount: 3,
              activePeerCount: 1,
              activePathCount: 4,
            }),
            { status: 200 }
          )
      )
    );

    renderWithQuery(<AdminControllerPanel />);

    expect(await screen.findByText('Online')).toBeInTheDocument();
    expect(screen.getByText('abcdef0123')).toBeInTheDocument();
    expect(screen.getByText('http://controller.test:9993')).toBeInTheDocument();
    expect(screen.getByText('1 peers / 4 paths')).toBeInTheDocument();
  });
});
