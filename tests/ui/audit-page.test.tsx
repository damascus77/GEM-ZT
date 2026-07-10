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
      vi.fn(
        async () =>
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
            { status: 200 }
          )
      )
    );
    renderWithQuery(<AuditPage />);
    expect(await screen.findByText('network.create')).toBeInTheDocument();
    expect(screen.getByText('admin')).toBeInTheDocument();
    expect(screen.getByText('abcdef0123456789')).toBeInTheDocument();
  });

  it('renders a before/after diff for update entries', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              entries: [
                {
                  id: 'a2',
                  userId: 'u1',
                  username: 'admin',
                  action: 'network.update',
                  targetType: 'network',
                  targetId: 'abcdef0123456789',
                  detail: { before: { mtu: 2800 }, after: { mtu: 1400 } },
                  createdAt: '2026-07-02T12:00:00.000Z',
                },
              ],
            }),
            { status: 200 }
          )
      )
    );
    renderWithQuery(<AuditPage />);
    expect(await screen.findByText('network.update')).toBeInTheDocument();
    const diff = screen.getByTestId('audit-diff');
    expect(diff).toBeInTheDocument();
    // Line-level diff: removed "before" line and added "after" line both present.
    expect(diff.textContent).toMatch(/2800/);
    expect(diff.textContent).toMatch(/1400/);
    expect(diff.querySelector('.line-through')).toBeTruthy();
  });

  it('still renders legacy plain-detail entries without a before/after diff', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              entries: [
                {
                  id: 'a3',
                  userId: 'u1',
                  username: 'admin',
                  action: 'member.delete',
                  targetType: 'member',
                  targetId: 'abcdef0123456789/deadbeef01',
                  detail: { name: 'laptop' },
                  createdAt: '2026-07-02T12:00:00.000Z',
                },
              ],
            }),
            { status: 200 }
          )
      )
    );
    renderWithQuery(<AuditPage />);
    expect(await screen.findByText('member.delete')).toBeInTheDocument();
    expect(screen.getByText(/"name"/)).toBeInTheDocument();
    expect(screen.getByText(/laptop/)).toBeInTheDocument();
    expect(screen.queryByTestId('audit-diff')).not.toBeInTheDocument();
  });
});
