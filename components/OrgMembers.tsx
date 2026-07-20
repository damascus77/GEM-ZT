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

interface OrgMembersProps {
  orgId: string;
  orgSelectionMode?: 'picker' | 'fixed';
}

export function OrgMembers({ orgId, orgSelectionMode = 'picker' }: OrgMembersProps) {
  const queryClient = useQueryClient();
  const showOrgPicker = orgSelectionMode === 'picker';

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

  useEffect(() => {
    if (!showOrgPicker) setTargetOrgId(orgId);
  }, [orgId, showOrgPicker]);

  const currentOrgRole =
    ORG_ROLES.includes(myRole as OrgRole) && myRole ? (myRole as OrgRole) : null;
  const targetOrgRole =
    manageableOrgs.find(o => o.id === targetOrgId)?.role ??
    (targetOrgId === orgId ? currentOrgRole : null);
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
    // Optimistically insert the new member so the list updates instantly instead
    // of blanking on a full refetch. Snapshot the previous cache so onError can
    // roll the phantom row back if the create fails.
    onMutate: async () => {
      setCreatedMessage(null);
      const key = ['org-members', targetOrgId] as const;
      // Cancel any in-flight refetch so it can't land after — and clobber — our
      // optimistic write.
      await queryClient.cancelQueries({ queryKey: key });
      const prev = queryClient.getQueryData<{ members: Member[] }>(key);
      // A stable sentinel id keeps React keys unique even across rapid or
      // retried creates; the real id arrives with the onSuccess invalidation.
      const newMember: Member = { userId: `optimistic-${username}`, username, role };
      queryClient.setQueryData<{ members: Member[] }>(key, old =>
        old ? { members: [...old.members, newMember] } : { members: [newMember] }
      );
      return { prev, key };
    },
    onError: (_err, _vars, context) => {
      if (context?.prev) queryClient.setQueryData(context.key, context.prev);
    },
    onSuccess: () => {
      if (targetOrgId !== orgId) {
        const org = manageableOrgs.find(o => o.id === targetOrgId);
        setCreatedMessage(
          `${username} created and added to ${org?.name ?? 'the selected organization'}.`
        );
      }
      setUsername('');
      setPassword('');
      setRole('viewer');
      queryClient.invalidateQueries({ queryKey: ['org-members', targetOrgId] });
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
                          variant="destructive"
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
            {showOrgPicker && manageableOrgs.length > 1 ? (
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
            ) : showOrgPicker ? (
              <div className="text-sm text-ink-mute">
                Organization
                <div className="mt-1 text-ink">
                  {manageableOrgs[0]?.name ?? 'this organization'}
                </div>
              </div>
            ) : null}
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
