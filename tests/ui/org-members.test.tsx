// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '../helpers/render';
import { OrgMembers } from '@/components/OrgMembers';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const ORG_ID = 'org-1';

const members = [
  { userId: 'u1', username: 'alice', role: 'owner' },
  { userId: 'u2', username: 'bob', role: 'editor' },
  { userId: 'u3', username: 'root-admin', role: 'superadmin' },
];

interface StubOrg {
  id: string;
  name: string;
  slug: string;
  role: string | null;
}

function stubFetch(
  meRole: string,
  opts: {
    mutationStatus?: number;
    mutationBody?: unknown;
    orgs?: StubOrg[];
    orgsStatus?: number;
  } = {}
) {
  const orgs = opts.orgs ?? [{ id: ORG_ID, name: 'Acme', slug: 'acme', role: meRole }];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/v1/me') {
      return new Response(
        JSON.stringify({
          user: { isSuperAdmin: meRole === 'superadmin' },
          activeOrgId: ORG_ID,
          memberships: [{ orgId: ORG_ID, role: meRole }],
        }),
        { status: 200 }
      );
    }
    if (url === '/api/v1/orgs') {
      return new Response(JSON.stringify({ orgs }), { status: opts.orgsStatus ?? 200 });
    }
    if (init?.method === 'PATCH') {
      const status = opts.mutationStatus ?? 200;
      const body = opts.mutationBody ?? { member: { userId: 'u2', role: 'admin' } };
      return new Response(JSON.stringify(body), { status });
    }
    if (init?.method === 'DELETE') {
      const status = opts.mutationStatus ?? 204;
      if (status === 204) return new Response(null, { status: 204 });
      return new Response(JSON.stringify(opts.mutationBody ?? {}), { status });
    }
    if (init?.method === 'POST') {
      const status = opts.mutationStatus ?? 201;
      const body = opts.mutationBody ?? {
        member: { userId: 'u4', username: 'newbie', role: 'viewer' },
      };
      return new Response(JSON.stringify(body), { status });
    }
    return new Response(JSON.stringify({ members }), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('OrgMembers', () => {
  it('renders the member list', async () => {
    stubFetch('viewer');
    renderWithQuery(<OrgMembers orgId={ORG_ID} />);
    expect(await screen.findByText('alice')).toBeInTheDocument();
    expect(screen.getByText('bob')).toBeInTheDocument();
    expect(screen.getByText('root-admin')).toBeInTheDocument();
  });

  it('shows a read-only Super-admin badge for phantom members with no controls', async () => {
    stubFetch('owner');
    renderWithQuery(<OrgMembers orgId={ORG_ID} />);
    await screen.findByText('root-admin');
    expect(screen.getByText(/super-admin/i)).toBeInTheDocument();
    const row = screen.getByText('root-admin').closest('tr')!;
    expect(row.querySelector('select')).toBeNull();
    expect(row.querySelector('button')).toBeNull();
  });

  it('owner caller sees editable role selects, remove buttons, and the create-user form', async () => {
    stubFetch('owner');
    renderWithQuery(<OrgMembers orgId={ORG_ID} />);
    await screen.findByText('alice');
    expect(screen.getAllByRole('combobox').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /remove/i }).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /create user/i })).toBeInTheDocument();
  });

  it('admin caller also sees editable controls and the create-user form', async () => {
    stubFetch('admin');
    renderWithQuery(<OrgMembers orgId={ORG_ID} />);
    await screen.findByText('alice');
    expect(screen.getAllByRole('combobox').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /create user/i })).toBeInTheDocument();
  });

  it('viewer caller sees read-only roles with no controls and no create-user form', async () => {
    stubFetch('viewer');
    renderWithQuery(<OrgMembers orgId={ORG_ID} />);
    await screen.findByText('alice');
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /remove/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /create user/i })).toBeNull();
  });

  it('editor caller sees read-only roles with no controls', async () => {
    stubFetch('editor');
    renderWithQuery(<OrgMembers orgId={ORG_ID} />);
    await screen.findByText('alice');
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /remove/i })).toBeNull();
  });

  it('changing a role PATCHes the correct endpoint', async () => {
    const fetchMock = stubFetch('owner');
    renderWithQuery(<OrgMembers orgId={ORG_ID} />);
    await screen.findByText('bob');
    const bobRow = screen.getByText('bob').closest('tr')!;
    const select = bobRow.querySelector('select')!;
    await userEvent.selectOptions(select, 'admin');
    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
      expect(patch).toBeDefined();
      expect(patch![0]).toBe(`/api/v1/orgs/${ORG_ID}/members/u2`);
      expect(JSON.parse(patch![1]!.body as string)).toEqual({ role: 'admin' });
    });
  });

  it('removing a member DELETEs after confirmation', async () => {
    const fetchMock = stubFetch('owner');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderWithQuery(<OrgMembers orgId={ORG_ID} />);
    await screen.findByText('bob');
    const bobRow = screen.getByText('bob').closest('tr')!;
    await userEvent.click(bobRow.querySelector('button')!);
    await waitFor(() => {
      const del = fetchMock.mock.calls.find(([, init]) => init?.method === 'DELETE');
      expect(del).toBeDefined();
      expect(del![0]).toBe(`/api/v1/orgs/${ORG_ID}/members/u2`);
    });
  });

  it('does not remove when confirmation is dismissed', async () => {
    const fetchMock = stubFetch('owner');
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderWithQuery(<OrgMembers orgId={ORG_ID} />);
    await screen.findByText('bob');
    const bobRow = screen.getByText('bob').closest('tr')!;
    await userEvent.click(bobRow.querySelector('button')!);
    await new Promise(r => setTimeout(r, 50));
    expect(fetchMock.mock.calls.find(([, init]) => init?.method === 'DELETE')).toBeUndefined();
  });

  it('creates a user via POST with username/password/role in the current org', async () => {
    const fetchMock = stubFetch('owner');
    renderWithQuery(<OrgMembers orgId={ORG_ID} />);
    await screen.findByText('alice');
    await userEvent.type(screen.getByLabelText(/username/i), 'newbie');
    await userEvent.type(screen.getByLabelText(/password/i), 'supersecretpw');
    await userEvent.click(screen.getByRole('button', { name: /create user/i }));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
      expect(post).toBeDefined();
      expect(post![0]).toBe(`/api/v1/orgs/${ORG_ID}/members`);
      expect(JSON.parse(post![1]!.body as string)).toEqual({
        username: 'newbie',
        password: 'supersecretpw',
        role: 'viewer',
      });
    });
  });

  it('surfaces a 409 error from a role change', async () => {
    const fetchMock = stubFetch('owner', {
      mutationStatus: 409,
      mutationBody: { error: { code: 'LAST_OWNER', message: 'Cannot demote the last owner.' } },
    });
    renderWithQuery(<OrgMembers orgId={ORG_ID} />);
    await screen.findByText('alice');
    const aliceRow = screen.getByText('alice').closest('tr')!;
    const select = aliceRow.querySelector('select')!;
    await userEvent.selectOptions(select, 'admin');
    expect(await screen.findByText(/cannot demote the last owner/i)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalled();
  });

  it('surfaces a server error from create-user', async () => {
    stubFetch('owner', {
      mutationStatus: 409,
      mutationBody: {
        error: { code: 'USERNAME_TAKEN', message: 'That username is already in use.' },
      },
    });
    renderWithQuery(<OrgMembers orgId={ORG_ID} />);
    await screen.findByText('alice');
    await userEvent.type(screen.getByLabelText(/username/i), 'alice');
    await userEvent.type(screen.getByLabelText(/password/i), 'supersecretpw');
    await userEvent.click(screen.getByRole('button', { name: /create user/i }));
    expect(await screen.findByText(/already in use/i)).toBeInTheDocument();
  });

  it("role options exclude ranks at or above an admin caller's own rank", async () => {
    stubFetch('admin');
    renderWithQuery(<OrgMembers orgId={ORG_ID} />);
    await screen.findByText('alice');
    const roleSelect = (await screen.findByLabelText(/^role$/i)) as HTMLSelectElement;
    const optionValues = Array.from(roleSelect.options).map(o => o.value);
    expect(optionValues).toEqual(['editor', 'viewer']);
  });

  it('owner caller sees all four role options', async () => {
    stubFetch('owner');
    renderWithQuery(<OrgMembers orgId={ORG_ID} />);
    await screen.findByText('alice');
    const roleSelect = (await screen.findByLabelText(/^role$/i)) as HTMLSelectElement;
    const optionValues = Array.from(roleSelect.options).map(o => o.value);
    expect(optionValues).toEqual(['owner', 'admin', 'editor', 'viewer']);
  });

  it('a single manageable org renders a read-only label, not a select', async () => {
    stubFetch('owner');
    renderWithQuery(<OrgMembers orgId={ORG_ID} />);
    await screen.findByText('alice');
    expect(screen.queryByLabelText(/^organization$/i)).toBeNull();
    expect(await screen.findByText('Acme')).toBeInTheDocument();
  });

  it('multiple manageable orgs render an organization select defaulting to the current org', async () => {
    stubFetch('owner', {
      orgs: [
        { id: ORG_ID, name: 'Acme', slug: 'acme', role: 'owner' },
        { id: 'org-2', name: 'Globex', slug: 'globex', role: 'owner' },
      ],
    });
    renderWithQuery(<OrgMembers orgId={ORG_ID} />);
    await screen.findByText('alice');
    const orgSelect = (await screen.findByLabelText(/^organization$/i)) as HTMLSelectElement;
    expect(orgSelect.value).toBe(ORG_ID);
    const optionLabels = Array.from(orgSelect.options).map(o => o.textContent);
    expect(optionLabels).toEqual(['Acme', 'Globex']);
  });

  it('creating a user in a different org posts to that org and shows a cross-org success message', async () => {
    const fetchMock = stubFetch('owner', {
      orgs: [
        { id: ORG_ID, name: 'Acme', slug: 'acme', role: 'owner' },
        { id: 'org-2', name: 'Globex', slug: 'globex', role: 'owner' },
      ],
      mutationBody: { member: { userId: 'u5', username: 'crossorg', role: 'viewer' } },
    });
    renderWithQuery(<OrgMembers orgId={ORG_ID} />);
    await screen.findByText('alice');
    const orgSelect = await screen.findByLabelText(/^organization$/i);
    await userEvent.selectOptions(orgSelect, 'org-2');
    await userEvent.type(screen.getByLabelText(/username/i), 'crossorg');
    await userEvent.type(screen.getByLabelText(/password/i), 'supersecretpw');
    await userEvent.click(screen.getByRole('button', { name: /create user/i }));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
      expect(post).toBeDefined();
      expect(post![0]).toBe('/api/v1/orgs/org-2/members');
    });
    expect(await screen.findByText(/globex/i)).toBeInTheDocument();
  });

  it('falls back to the current org when GET /api/v1/orgs fails', async () => {
    const fetchMock = stubFetch('owner', { orgsStatus: 500 });
    renderWithQuery(<OrgMembers orgId={ORG_ID} />);
    await screen.findByText('alice');
    await userEvent.type(screen.getByLabelText(/username/i), 'newbie');
    await userEvent.type(screen.getByLabelText(/password/i), 'supersecretpw');
    await userEvent.click(screen.getByRole('button', { name: /create user/i }));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
      expect(post).toBeDefined();
      expect(post![0]).toBe(`/api/v1/orgs/${ORG_ID}/members`);
    });
  });
});
