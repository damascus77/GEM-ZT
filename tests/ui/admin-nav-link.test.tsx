// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithQuery } from '../helpers/render';
import { AdminNavLink } from '@/components/AdminNavLink';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubFetch(isSuperAdmin: boolean) {
  const fetchMock = vi.fn(async (url: string) => {
    if (url === '/api/v1/me') {
      return new Response(
        JSON.stringify({ user: { isSuperAdmin }, activeOrgId: null, memberships: [] }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({}), { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('AdminNavLink', () => {
  it('renders the Admin link for super-admins', async () => {
    stubFetch(true);
    renderWithQuery(<AdminNavLink />);
    expect(await screen.findByRole('link', { name: /admin/i })).toHaveAttribute('href', '/admin');
  });

  it('renders nothing for non-super-admins', async () => {
    stubFetch(false);
    renderWithQuery(<AdminNavLink />);
    await waitFor(() => expect(screen.queryByText(/loading/i)).toBeNull());
    expect(screen.queryByRole('link', { name: /admin/i })).toBeNull();
  });
});
