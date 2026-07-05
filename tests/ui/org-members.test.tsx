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

function stubFetch(meRole: string, opts: { mutationStatus?: number; mutationBody?: unknown } = {}) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/v1/me') {
      return new Response(
        JSON.stringify({
          user: { isSuperAdmin: meRole === 'superadmin' },
          activeOrgId: ORG_ID,
          memberships: [{ orgId: ORG_ID, role: meRole }],
        }),
        { status: 200 },
      );
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
      const body = opts.mutationBody ?? { member: { userId: 'u4', username: 'newbie', role: 'viewer' } };
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
    // No select or remove button should exist in the root-admin row.
    const row = screen.getByText('root-admin').closest('tr')!;
    expect(row.querySelector('select')).toBeNull();
    expect(row.querySelector('button')).toBeNull();
  });

  it('owner caller sees editable role selects, remove buttons, and the add-member form', async () => {
    stubFetch('owner');
    renderWithQuery(<OrgMembers orgId={ORG_ID} />);
    await screen.findByText('alice');
    expect(screen.getAllByRole('combobox').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /remove/i }).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /add member/i })).toBeInTheDocument();
  });

  it('admin caller also sees editable controls and the add-member form', async () => {
    stubFetch('admin');
    renderWithQuery(<OrgMembers orgId={ORG_ID} />);
    await screen.findByText('alice');
    expect(screen.getAllByRole('combobox').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /add member/i })).toBeInTheDocument();
  });

  it('viewer caller sees read-only roles with no controls and no add-member form', async () => {
    stubFetch('viewer');
    renderWithQuery(<OrgMembers orgId={ORG_ID} />);
    await screen.findByText('alice');
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /remove/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /add member/i })).toBeNull();
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
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchMock.mock.calls.find(([, init]) => init?.method === 'DELETE')).toBeUndefined();
  });

  it('adds a member via POST with username/password/role', async () => {
    const fetchMock = stubFetch('owner');
    renderWithQuery(<OrgMembers orgId={ORG_ID} />);
    await screen.findByText('alice');
    await userEvent.type(screen.getByLabelText(/username/i), 'newbie');
    await userEvent.type(screen.getByLabelText(/password/i), 'supersecretpw');
    await userEvent.click(screen.getByRole('button', { name: /add member/i }));
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

  it('surfaces a 403 error from add-member', async () => {
    stubFetch('admin', {
      mutationStatus: 403,
      mutationBody: { error: { code: 'FORBIDDEN', message: 'Only an owner may grant the owner role.' } },
    });
    renderWithQuery(<OrgMembers orgId={ORG_ID} />);
    await screen.findByText('alice');
    await userEvent.type(screen.getByLabelText(/username/i), 'newowner');
    await userEvent.type(screen.getByLabelText(/password/i), 'supersecretpw');
    await userEvent.selectOptions(screen.getByLabelText(/^role$/i), 'owner');
    await userEvent.click(screen.getByRole('button', { name: /add member/i }));
    expect(await screen.findByText(/only an owner may grant the owner role/i)).toBeInTheDocument();
  });

  it('surfaces a 409 username-taken error from add-member', async () => {
    stubFetch('owner', {
      mutationStatus: 409,
      mutationBody: { error: { code: 'USERNAME_TAKEN', message: 'That username is already in use.' } },
    });
    renderWithQuery(<OrgMembers orgId={ORG_ID} />);
    await screen.findByText('alice');
    await userEvent.type(screen.getByLabelText(/username/i), 'alice');
    await userEvent.type(screen.getByLabelText(/password/i), 'supersecretpw');
    await userEvent.click(screen.getByRole('button', { name: /add member/i }));
    expect(await screen.findByText(/already in use/i)).toBeInTheDocument();
  });
});
