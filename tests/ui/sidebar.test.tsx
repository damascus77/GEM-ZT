// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { within, screen, waitFor } from '@testing-library/react';
import { renderWithQuery } from '../helpers/render';
import { Sidebar } from '@/components/Sidebar';

vi.mock('next/navigation', () => ({
  usePathname: () => '/networks',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubFetch({
  isSuperAdmin = false,
  activeOrgId = 'org-1',
  memberships = [{ orgId: 'org-1', orgName: 'Acme', orgSlug: 'acme', role: 'owner' }],
}: {
  isSuperAdmin?: boolean;
  activeOrgId?: string | null;
  memberships?: { orgId: string; orgName: string; orgSlug: string; role: string }[];
} = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url === '/api/v1/me') {
        return new Response(
          JSON.stringify({
            user: { isSuperAdmin },
            activeOrgId,
            memberships,
          }),
          { status: 200 }
        );
      }
      if (url === '/api/v1/pending') {
        return new Response(JSON.stringify({ pending: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    })
  );
}

describe('Sidebar', () => {
  it('shows account management for owners/admins even without an active org', async () => {
    stubFetch({ activeOrgId: null });
    renderWithQuery(<Sidebar />);

    expect(await screen.findByText('Account Management')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Accounts' })).toHaveAttribute('href', '/accounts');
    expect(screen.getByRole('link', { name: 'Invitations' })).toHaveAttribute(
      'href',
      '/accounts#invitations'
    );
  });

  it('shows account management for super-admins', async () => {
    stubFetch({ isSuperAdmin: true, activeOrgId: null, memberships: [] });
    renderWithQuery(<Sidebar />);

    expect(await screen.findByText('Account Management')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Accounts' })).toBeInTheDocument();
  });

  it('hides account management for viewers and editors with no manageable org', async () => {
    stubFetch({
      memberships: [{ orgId: 'org-1', orgName: 'Acme', orgSlug: 'acme', role: 'viewer' }],
    });
    renderWithQuery(<Sidebar />);

    await waitFor(() => expect(screen.queryByText('Account Management')).toBeNull());
    expect(screen.queryByRole('link', { name: 'Accounts' })).toBeNull();
  });

  it('moves organization switching to the sidebar controls instead of an Organization nav group', async () => {
    stubFetch({
      memberships: [
        { orgId: 'org-1', orgName: 'Acme', orgSlug: 'acme', role: 'owner' },
        { orgId: 'org-2', orgName: 'Globex', orgSlug: 'globex', role: 'viewer' },
      ],
    });
    renderWithQuery(<Sidebar />);

    const controls = await screen.findByRole('group', { name: /sidebar controls/i });
    expect(await within(controls).findByLabelText(/organization/i)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Members' })).toBeNull();
  });
});
