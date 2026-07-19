// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '../helpers/render';
import { AccountManagement } from '@/components/AccountManagement';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

interface StubOrg {
  id: string;
  name: string;
  slug: string;
  role: string | null;
}

const orgs: StubOrg[] = [
  { id: 'org-1', name: 'Acme', slug: 'acme', role: 'owner' },
  { id: 'org-2', name: 'Globex', slug: 'globex', role: 'admin' },
  { id: 'org-3', name: 'Read Only', slug: 'read-only', role: 'viewer' },
];

const membersByOrg = {
  'org-1': [{ userId: 'u1', username: 'alice', role: 'owner' }],
  'org-2': [{ userId: 'u2', username: 'bob', role: 'admin' }],
};

const invitationsByOrg = {
  'org-1': [
    {
      id: 'inv-1',
      role: 'viewer',
      email: 'invite-acme@example.com',
      expiresAt: '2026-08-01T00:00:00.000Z',
      createdAt: '2026-07-01T00:00:00.000Z',
    },
  ],
  'org-2': [
    {
      id: 'inv-2',
      role: 'viewer',
      email: 'invite-globex@example.com',
      expiresAt: '2026-08-01T00:00:00.000Z',
      createdAt: '2026-07-01T00:00:00.000Z',
    },
  ],
};

function stubFetch({
  isSuperAdmin = false,
  activeOrgId = 'org-1',
  orgList = orgs,
}: {
  isSuperAdmin?: boolean;
  activeOrgId?: string | null;
  orgList?: StubOrg[];
} = {}) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/v1/me') {
      return new Response(
        JSON.stringify({
          user: { isSuperAdmin },
          activeOrgId,
          memberships: orgList.map(org => ({ orgId: org.id, role: org.role })),
        }),
        { status: 200 }
      );
    }
    if (url === '/api/v1/orgs') {
      return new Response(JSON.stringify({ orgs: orgList }), { status: 200 });
    }

    const memberMatch = url.match(/^\/api\/v1\/orgs\/([^/]+)\/members$/);
    if (memberMatch && init?.method === 'POST') {
      return new Response(
        JSON.stringify({ member: { userId: 'u-new', username: 'newbie', role: 'viewer' } }),
        { status: 201 }
      );
    }
    if (memberMatch) {
      const orgId = memberMatch[1] as keyof typeof membersByOrg;
      return new Response(JSON.stringify({ members: membersByOrg[orgId] ?? [] }), {
        status: 200,
      });
    }

    const invitationsMatch = url.match(/^\/api\/v1\/orgs\/([^/]+)\/invitations$/);
    if (invitationsMatch) {
      const orgId = invitationsMatch[1] as keyof typeof invitationsByOrg;
      return new Response(JSON.stringify({ invitations: invitationsByOrg[orgId] ?? [] }), {
        status: 200,
      });
    }

    return new Response(JSON.stringify({}), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('AccountManagement', () => {
  it('owner sees org selector, members, create-user form, and invitations', async () => {
    stubFetch();
    renderWithQuery(<AccountManagement />);

    expect(await screen.findByText('alice')).toBeInTheDocument();
    expect(screen.getByLabelText(/^organization$/i)).toHaveValue('org-1');
    expect(screen.getByRole('button', { name: /create user/i })).toBeInTheDocument();
    expect(screen.getByText('invite-acme@example.com')).toBeInTheDocument();
  });

  it('viewer sees a no-access state', async () => {
    stubFetch({
      orgList: [{ id: 'org-3', name: 'Read Only', slug: 'read-only', role: 'viewer' }],
    });
    renderWithQuery(<AccountManagement />);

    expect(await screen.findByText(/need an owner or admin role/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /create user/i })).toBeNull();
  });

  it('super-admin sees all orgs as manageable', async () => {
    stubFetch({
      isSuperAdmin: true,
      orgList: [
        { id: 'org-1', name: 'Acme', slug: 'acme', role: null },
        { id: 'org-3', name: 'Read Only', slug: 'read-only', role: null },
      ],
    });
    renderWithQuery(<AccountManagement />);

    const select = (await screen.findByLabelText(/^organization$/i)) as HTMLSelectElement;
    expect(Array.from(select.options).map(o => o.textContent)).toEqual(['Acme', 'Read Only']);
  });

  it('defaults to the active org when it is manageable', async () => {
    stubFetch({ activeOrgId: 'org-2' });
    renderWithQuery(<AccountManagement />);

    expect(await screen.findByText('bob')).toBeInTheDocument();
    expect(screen.getByLabelText(/^organization$/i)).toHaveValue('org-2');
  });

  it('falls back to the first manageable org when the active org is not manageable', async () => {
    stubFetch({ activeOrgId: 'org-3' });
    renderWithQuery(<AccountManagement />);

    expect(await screen.findByText('alice')).toBeInTheDocument();
    expect(screen.getByLabelText(/^organization$/i)).toHaveValue('org-1');
  });

  it('creates users in the selected org without visiting an org-specific route', async () => {
    const fetchMock = stubFetch({ activeOrgId: 'org-2' });
    renderWithQuery(<AccountManagement />);

    await screen.findByText('bob');
    await userEvent.type(screen.getByLabelText(/username/i), 'newbie');
    await userEvent.type(screen.getByLabelText(/password/i), 'supersecretpw');
    await userEvent.click(screen.getByRole('button', { name: /create user/i }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
      expect(post).toBeDefined();
      expect(post![0]).toBe('/api/v1/orgs/org-2/members');
    });
  });

  it('scrolls to invitations after async content mounts for hash navigation', async () => {
    window.history.replaceState(null, '', '/accounts#invitations');
    const scrollIntoView = vi.fn();
    Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      callback(0);
      return 0;
    });

    stubFetch();
    renderWithQuery(<AccountManagement />);

    expect(await screen.findByText('invite-acme@example.com')).toBeInTheDocument();
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
  });
});
