# Cross-Org User Creation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let any org admin/owner (or super-admin) create a user, set their role, and assign them to any organization they manage — all from the existing Members page, in one form, without navigating to that org's Members page first.

**Architecture:** Frontend-only change. `GET /api/v1/orgs` already returns every org a super-admin can see (or the caller's own memberships with role, for everyone else), and `POST /api/v1/orgs/{orgId}/members` already creates a user + org membership + role in one call with per-org role-cap enforcement. `components/OrgMembers.tsx`'s existing "Add member" card grows an organization picker that targets whichever org is selected, instead of always the page's own `orgId`.

**Tech Stack:** Next.js App Router, React, TanStack Query, Tailwind, Vitest + Testing Library (jsdom), TypeScript.

## Global Constraints

- No backend/API route changes — see spec §2 (`docs/superpowers/specs/2026-07-12-cross-org-user-creation-design.md`). Only `components/OrgMembers.tsx` and `tests/ui/org-members.test.tsx` change.
- Card heading changes from "Add member" to "Create user"; the submit button text changes to match ("Create user").
- Organization field: a read-only label when the caller manages exactly one org; a real `<select>` when they manage two or more. Defaults to the page's own `orgId`.
- Role `<select>` options are computed from the caller's rank in the **currently selected** org, not the page's own org — owners and super-admins always see all four roles; everyone else sees only roles ranked strictly below their own rank in that org.
- On successful creation: if the selected org is the page's own org, the member table refreshes exactly as it does today (no message). If a different org was selected, the table is left alone and a message names the target org.
- `components/OrgInvitations.tsx` and the invite-link flow are unchanged — out of scope per spec §1.

---

### Task 1: Organization picker + cross-org submission on the Members "Create user" card

**Files:**
- Modify: `components/OrgMembers.tsx` (full rewrite below)
- Modify: `tests/ui/org-members.test.tsx` (full rewrite below)

**Interfaces:**
- Consumes: `GET /api/v1/orgs` (existing route, `app/api/v1/orgs/route.ts`) — returns `{ orgs: { id, name, slug, role: OrgRole | null }[] }`. For a super-admin caller, every org; otherwise only the caller's own memberships with their role in each.
- Consumes: `POST /api/v1/orgs/{orgId}/members` (existing route, `app/api/v1/orgs/[orgId]/members/route.ts`) — unchanged request/response shape `{ username, password, role } -> { member: { userId, username, role } }`, `403 FORBIDDEN` / `409 USERNAME_TAKEN` on error.
- Consumes: `ORG_ROLES: OrgRole[]` and `ROLE_RANK: Record<OrgRole, number>` from `lib/authz/roles.ts` (already used elsewhere, e.g. `components/OrgInvitations.tsx`).
- Produces: no new exports — `OrgMembers` keeps its existing `{ orgId: string }` prop signature, so `app/(ui)/orgs/[orgId]/members/page.tsx` needs no changes.

- [ ] **Step 1: Rewrite the test file first (it will fail against the current component — that's expected)**

Replace the full contents of `tests/ui/org-members.test.tsx` with:

```tsx
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
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run tests/ui/org-members.test.tsx`
Expected: Multiple failures — `getByRole('button', { name: /create user/i })` not found (button still says "Add member"), `getByLabelText(/^organization$/i)` not found, role-option-count assertions failing. This confirms the tests exercise not-yet-built behavior.

- [ ] **Step 3: Rewrite `components/OrgMembers.tsx`**

Replace the full contents of `components/OrgMembers.tsx` with:

```tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Pill } from '@/components/ui/Pill';
import { ORG_ROLES, ROLE_RANK, type OrgRole } from '@/lib/authz/roles';

interface Member {
  userId: string;
  username: string;
  role: OrgRole | 'superadmin';
}

interface MeResponse {
  user: { isSuperAdmin: boolean };
  memberships: { orgId: string; role: string }[];
}

interface OrgOption {
  id: string;
  name: string;
  slug: string;
  role: OrgRole | null;
}

export function OrgMembers({ orgId }: { orgId: string }) {
  const queryClient = useQueryClient();

  const membersQuery = useQuery<{ members: Member[] }>({
    queryKey: ['org-members', orgId],
    queryFn: async () => {
      const res = await fetch(`/api/v1/orgs/${orgId}/members`);
      if (!res.ok) throw new Error('Failed to load members.');
      return res.json();
    },
  });

  const meQuery = useQuery<MeResponse>({
    queryKey: ['me'],
    queryFn: async () => {
      const res = await fetch('/api/v1/me');
      if (!res.ok) throw new Error('Failed to load account.');
      return res.json();
    },
  });

  const me = meQuery.data;
  const myRole = me?.memberships.find(m => m.orgId === orgId)?.role;
  const isSuperAdmin = Boolean(me?.user.isSuperAdmin);
  const canManage = Boolean(isSuperAdmin || myRole === 'owner' || myRole === 'admin');

  const orgsQuery = useQuery<{ orgs: OrgOption[] }>({
    queryKey: ['orgs'],
    queryFn: async () => {
      const res = await fetch('/api/v1/orgs');
      if (!res.ok) throw new Error('Failed to load organizations.');
      return res.json();
    },
    enabled: canManage,
  });

  const manageableOrgs = useMemo(() => {
    const orgs = orgsQuery.data?.orgs ?? [];
    if (isSuperAdmin) return orgs;
    return orgs.filter(o => o.role === 'admin' || o.role === 'owner');
  }, [orgsQuery.data, isSuperAdmin]);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<OrgRole>('viewer');
  const [targetOrgId, setTargetOrgId] = useState(orgId);
  const [createdMessage, setCreatedMessage] = useState<string | null>(null);

  const targetOrgRole = manageableOrgs.find(o => o.id === targetOrgId)?.role ?? null;
  const grantableRoles = useMemo(() => {
    if (isSuperAdmin || !targetOrgRole || targetOrgRole === 'owner') return ORG_ROLES;
    return ORG_ROLES.filter(r => ROLE_RANK[r] < ROLE_RANK[targetOrgRole as OrgRole]);
  }, [isSuperAdmin, targetOrgRole]);

  useEffect(() => {
    if (!grantableRoles.includes(role)) setRole('viewer');
  }, [grantableRoles, role]);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['org-members', orgId] });
  }

  const changeRole = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: OrgRole }) => {
      const res = await fetch(`/api/v1/orgs/${orgId}/members/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      if (!res.ok) {
        const parsed = await res.json().catch(() => null);
        throw new Error(parsed?.error?.message ?? 'Failed to change role.');
      }
      return res.json();
    },
    onSuccess: invalidate,
  });

  const removeMember = useMutation({
    mutationFn: async (userId: string) => {
      const res = await fetch(`/api/v1/orgs/${orgId}/members/${userId}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) {
        const parsed = await res.json().catch(() => null);
        throw new Error(parsed?.error?.message ?? 'Failed to remove member.');
      }
    },
    onSuccess: invalidate,
  });

  const addMember = useMutation({
    mutationFn: async () => {
      setCreatedMessage(null);
      const res = await fetch(`/api/v1/orgs/${targetOrgId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, role }),
      });
      if (!res.ok) {
        const parsed = await res.json().catch(() => null);
        throw new Error(parsed?.error?.message ?? 'Failed to add member.');
      }
      return res.json();
    },
    onSuccess: () => {
      if (targetOrgId === orgId) {
        invalidate();
      } else {
        queryClient.invalidateQueries({ queryKey: ['org-members', targetOrgId] });
        const org = manageableOrgs.find(o => o.id === targetOrgId);
        setCreatedMessage(
          `${username} created and added to ${org?.name ?? 'the selected organization'}.`
        );
      }
      setUsername('');
      setPassword('');
      setRole('viewer');
    },
  });

  function confirmRemove(member: Member) {
    if (window.confirm(`Remove "${member.username}" from this organization?`)) {
      removeMember.mutate(member.userId);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card className="overflow-x-auto">
        <h2 className="wght-540 mb-4 text-[20px] tracking-[-0.4px]">Members</h2>
        {membersQuery.isLoading && <p className="text-ink-mute">Loading…</p>}
        {membersQuery.isError && !membersQuery.data && (
          <p role="alert" className="text-sm text-ink">
            Could not load members. Refresh to retry.
          </p>
        )}
        {changeRole.isError && (
          <p role="alert" className="mb-2 text-sm text-ink">
            {(changeRole.error as Error).message}
          </p>
        )}
        {removeMember.isError && (
          <p role="alert" className="mb-2 text-sm text-ink">
            {(removeMember.error as Error).message}
          </p>
        )}
        {membersQuery.data && (
          <table className="w-full text-left">
            <thead>
              <tr className="text-xs uppercase text-ink-faint">
                <th className="pb-2 pr-4">Username</th>
                <th className="pb-2 pr-4">Role</th>
                <th className="pb-2">&nbsp;</th>
              </tr>
            </thead>
            <tbody>
              {membersQuery.data.members.map(member => {
                const isPhantom = member.role === 'superadmin';
                return (
                  <tr key={member.userId} className="border-t border-hairline">
                    <td className="wght-540 py-3 pr-4">{member.username}</td>
                    <td className="py-3 pr-4">
                      {isPhantom ? (
                        <Pill>Super-admin</Pill>
                      ) : canManage ? (
                        <label className="sr-only" htmlFor={`role-${member.userId}`}>
                          Role for {member.username}
                        </label>
                      ) : null}
                      {!isPhantom && canManage && (
                        <select
                          id={`role-${member.userId}`}
                          value={member.role}
                          disabled={changeRole.isPending}
                          onChange={e =>
                            changeRole.mutate({
                              userId: member.userId,
                              role: e.target.value as OrgRole,
                            })
                          }
                          className="rounded-sm border border-hairline bg-canvas px-2 py-1.5 text-sm text-ink focus:border-hairline-dark focus:outline-none"
                        >
                          {ORG_ROLES.map(r => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </select>
                      )}
                      {!isPhantom && !canManage && (
                        <span className={clsx('text-sm capitalize text-ink-mute')}>
                          {member.role}
                        </span>
                      )}
                    </td>
                    <td className="py-3">
                      {!isPhantom && canManage && (
                        <Button
                          variant="outline"
                          className="px-3 py-2 text-sm"
                          disabled={removeMember.isPending}
                          onClick={() => confirmRemove(member)}
                        >
                          Remove
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      {canManage && (
        <Card>
          <h2 className="wght-540 mb-4 text-[20px] tracking-[-0.4px]">Create user</h2>
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={e => {
              e.preventDefault();
              addMember.mutate();
            }}
          >
            <label className="text-sm text-ink-mute">
              Username
              <Input
                value={username}
                onChange={e => setUsername(e.target.value)}
                required
                className="w-48"
              />
            </label>
            <label className="text-sm text-ink-mute">
              Password
              <Input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                minLength={10}
                className="w-48"
              />
            </label>
            {manageableOrgs.length > 1 ? (
              <label className="text-sm text-ink-mute">
                Organization
                <select
                  value={targetOrgId}
                  onChange={e => setTargetOrgId(e.target.value)}
                  className="mt-1 block rounded-sm border border-hairline bg-canvas px-3 py-2.5 text-base text-ink focus:border-hairline-dark focus:outline-none"
                >
                  {manageableOrgs.map(o => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <div className="text-sm text-ink-mute">
                Organization
                <div className="mt-1 text-ink">
                  {manageableOrgs[0]?.name ?? 'this organization'}
                </div>
              </div>
            )}
            <label className="text-sm text-ink-mute">
              Role
              <select
                value={role}
                onChange={e => setRole(e.target.value as OrgRole)}
                className="mt-1 block rounded-sm border border-hairline bg-canvas px-3 py-2.5 text-base text-ink focus:border-hairline-dark focus:outline-none"
              >
                {grantableRoles.map(r => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <Button
              type="submit"
              disabled={addMember.isPending || username === '' || password === ''}
            >
              Create user
            </Button>
          </form>
          {addMember.isError && (
            <p role="alert" className="mt-2 text-sm text-ink">
              {(addMember.error as Error).message}
            </p>
          )}
          {createdMessage && <p className="mt-2 text-sm text-ink-mute">{createdMessage}</p>}
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `npx vitest run tests/ui/org-members.test.tsx`
Expected: All 18 tests pass (`Test Files 1 passed (1)`, `Tests 18 passed (18)`).

- [ ] **Step 5: Run typecheck and the full test suite to confirm no regressions**

Run: `npm run typecheck`
Expected: No errors.

Run: `npm test`
Expected: Same pass/fail counts as the pre-existing baseline — specifically, only the 6 pre-existing, unrelated failures in `tests/integration/setup-auth-routes.test.ts` (confirmed failing on a clean baseline before this feature; not something this task should fix). No new failures anywhere else.

- [ ] **Step 6: Commit**

```bash
git add components/OrgMembers.tsx tests/ui/org-members.test.tsx
git commit -m "feat(members): let any org admin/owner create a user for any org they manage in one form"
```

---

## Verification

1. Run `npm run dev`, log in as a super-admin (or an admin/owner of at least one org), navigate to a Members page.
2. Confirm the card now reads "Create user" and, if you belong to only one org, the Organization field shows as plain text (not a dropdown).
3. If you manage 2+ orgs (e.g. create a second org as super-admin via the existing Organizations admin page, then visit Members again), confirm the Organization field is now a real dropdown defaulting to the org you're viewing, and that picking a different org narrows/widens the Role dropdown to match your rank there.
4. Create a user assigned to a *different* org than the one you're viewing; confirm the success message names that other org and the currently-displayed member table is unaffected. Then navigate to that other org's Members page and confirm the new user appears there.
