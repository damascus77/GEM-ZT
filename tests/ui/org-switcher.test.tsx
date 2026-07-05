// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '../helpers/render';
import { OrgSwitcher } from '@/components/OrgSwitcher';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubFetch(meBody: unknown, postStatus = 204) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST' && String(url).includes('/active')) {
      return new Response(null, { status: postStatus });
    }
    if (String(url).includes('/api/v1/me')) {
      return new Response(JSON.stringify(meBody), { status: 200 });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const twoMemberships = {
  user: { id: 'u1', username: 'admin', role: 'owner', totpEnabled: false, isSuperAdmin: false },
  activeOrgId: 'org-1',
  memberships: [
    { orgId: 'org-1', orgName: 'Acme Co', orgSlug: 'acme', role: 'owner' },
    { orgId: 'org-2', orgName: 'Beta Inc', orgSlug: 'beta', role: 'viewer' },
  ],
};

const singleMembership = {
  user: { id: 'u1', username: 'admin', role: 'owner', totpEnabled: false, isSuperAdmin: false },
  activeOrgId: 'org-1',
  memberships: [{ orgId: 'org-1', orgName: 'Acme Co', orgSlug: 'acme', role: 'owner' }],
};

const superAdminSingle = {
  user: { id: 'u1', username: 'root', role: 'superadmin', totpEnabled: false, isSuperAdmin: true },
  activeOrgId: 'org-1',
  memberships: [{ orgId: 'org-1', orgName: 'Acme Co', orgSlug: 'acme', role: 'owner' }],
};

describe('OrgSwitcher', () => {
  it('renders the current org and lists memberships when there are 2+', async () => {
    stubFetch(twoMemberships);
    renderWithQuery(<OrgSwitcher />);

    const select = await screen.findByLabelText(/organization/i);
    expect(select).toHaveValue('org-1');

    expect(screen.getByRole('option', { name: 'Acme Co' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Beta Inc' })).toBeInTheDocument();
  });

  it('is hidden when the user has a single membership and is not a super-admin', async () => {
    stubFetch(singleMembership);
    renderWithQuery(<OrgSwitcher />);

    await waitFor(() => {
      expect(screen.queryByLabelText(/organization/i)).not.toBeInTheDocument();
    });
  });

  it('is visible for a super-admin even with a single membership', async () => {
    stubFetch(superAdminSingle);
    renderWithQuery(<OrgSwitcher />);

    expect(await screen.findByLabelText(/organization/i)).toBeInTheDocument();
  });

  it('POSTs to /api/v1/orgs/{orgId}/active when the selection changes', async () => {
    const fetchMock = stubFetch(twoMemberships);
    const reloadMock = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload: reloadMock });

    renderWithQuery(<OrgSwitcher />);

    const select = await screen.findByLabelText(/organization/i);
    await userEvent.selectOptions(select, 'org-2');

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
      expect(post).toBeDefined();
      expect(post![0]).toBe('/api/v1/orgs/org-2/active');
    });
  });
});
