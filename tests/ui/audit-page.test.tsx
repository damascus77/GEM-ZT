// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithQuery } from '../helpers/render';
import AuditPage from '@/app/(ui)/audit/page';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AuditPage', () => {
  it('renders audit entries', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            entries: [
              {
                id: 'a1',
                userId: 'u1',
                username: 'admin',
                action: 'network.create',
                targetType: 'network',
                targetId: 'abcdef0123456789',
                detail: { name: 'lan' },
                createdAt: '2026-07-02T12:00:00.000Z',
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );
    renderWithQuery(<AuditPage />);
    expect(await screen.findByText('network.create')).toBeInTheDocument();
    expect(screen.getByText('admin')).toBeInTheDocument();
    expect(screen.getByText('abcdef0123456789')).toBeInTheDocument();
  });
});
