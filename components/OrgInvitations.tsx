'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { ORG_ROLES, type OrgRole } from '@/lib/authz/roles';

interface Invitation {
  id: string;
  role: OrgRole;
  email: string | null;
  expiresAt: string;
  createdAt: string;
}

interface MeResponse {
  user: { isSuperAdmin: boolean };
  memberships: { orgId: string; role: string }[];
}

export function OrgInvitations({ orgId }: { orgId: string }) {
  const queryClient = useQueryClient();

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
  const isOwner = Boolean(me?.user.isSuperAdmin || myRole === 'owner');
  const canManage = Boolean(me?.user.isSuperAdmin || myRole === 'owner' || myRole === 'admin');

  const invitationsQuery = useQuery<{ invitations: Invitation[] }>({
    queryKey: ['org-invitations', orgId],
    queryFn: async () => {
      const res = await fetch(`/api/v1/orgs/${orgId}/invitations`);
      if (!res.ok) throw new Error('Failed to load invitations.');
      return res.json();
    },
    enabled: canManage,
  });

  const [role, setRole] = useState<OrgRole>('viewer');
  const [email, setEmail] = useState('');
  const [ttlHours, setTtlHours] = useState('');
  const [newInviteLink, setNewInviteLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['org-invitations', orgId] });
  }

  const createInvitation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = { role };
      if (email.trim() !== '') body.email = email.trim();
      if (ttlHours.trim() !== '') body.ttlHours = Number(ttlHours);
      const res = await fetch(`/api/v1/orgs/${orgId}/invitations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const parsed = await res.json().catch(() => null);
        throw new Error(parsed?.error?.message ?? 'Failed to create invitation.');
      }
      return res.json();
    },
    onSuccess: (data: { invitation: Invitation; token: string }) => {
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      setNewInviteLink(`${origin}/invite/${data.token}`);
      setCopied(false);
      setEmail('');
      setTtlHours('');
      setRole('viewer');
      invalidate();
    },
  });

  const revokeInvitation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/v1/orgs/${orgId}/invitations/${id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) {
        const parsed = await res.json().catch(() => null);
        throw new Error(parsed?.error?.message ?? 'Failed to revoke invitation.');
      }
    },
    onSuccess: invalidate,
  });

  async function copyLink() {
    if (!newInviteLink) return;
    try {
      await navigator.clipboard.writeText(newInviteLink);
      setCopied(true);
    } catch {
      // Clipboard API may be unavailable; the link is still shown for manual copy.
    }
  }

  if (!canManage) return null;

  const availableRoles = isOwner ? ORG_ROLES : ORG_ROLES.filter(r => r !== 'owner');

  return (
    <div className="flex flex-col gap-6">
      <Card className="overflow-x-auto">
        <h2 className="wght-540 mb-4 text-[20px] tracking-[-0.4px]">Invitations</h2>
        {invitationsQuery.isLoading && <p className="text-ink-mute">Loading…</p>}
        {invitationsQuery.isError && !invitationsQuery.data && (
          <p role="alert" className="text-sm text-ink">
            Could not load invitations. Refresh to retry.
          </p>
        )}
        {revokeInvitation.isError && (
          <p role="alert" className="mb-2 text-sm text-ink">
            {(revokeInvitation.error as Error).message}
          </p>
        )}
        {invitationsQuery.data && invitationsQuery.data.invitations.length === 0 && (
          <p className="text-sm text-ink-mute">No pending invitations.</p>
        )}
        {invitationsQuery.data && invitationsQuery.data.invitations.length > 0 && (
          <table className="w-full text-left">
            <thead>
              <tr className="text-xs uppercase text-ink-faint">
                <th className="pb-2 pr-4">Email</th>
                <th className="pb-2 pr-4">Role</th>
                <th className="pb-2 pr-4">Expires</th>
                <th className="pb-2">&nbsp;</th>
              </tr>
            </thead>
            <tbody>
              {invitationsQuery.data.invitations.map(inv => (
                <tr key={inv.id} className="border-t border-hairline">
                  <td className="wght-540 py-3 pr-4">
                    {inv.email ?? <span className="text-ink-faint">—</span>}
                  </td>
                  <td className="py-3 pr-4 capitalize">{inv.role}</td>
                  <td className="py-3 pr-4 text-sm text-ink-mute">
                    {new Date(inv.expiresAt).toLocaleString()}
                  </td>
                  <td className="py-3">
                    <Button
                      variant="destructive"
                      className="px-3 py-2 text-sm"
                      disabled={revokeInvitation.isPending}
                      onClick={() => revokeInvitation.mutate(inv.id)}
                    >
                      Revoke
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card>
        <h2 className="wght-540 mb-4 text-[20px] tracking-[-0.4px]">Create invitation</h2>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={e => {
            e.preventDefault();
            createInvitation.mutate();
          }}
        >
          <label className="text-sm text-ink-mute">
            Role
            <select
              value={role}
              onChange={e => setRole(e.target.value as OrgRole)}
              className="mt-1 block rounded-sm border border-hairline bg-canvas px-3 py-2.5 text-base text-ink focus:border-hairline-dark focus:outline-none"
            >
              {availableRoles.map(r => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-ink-mute">
            Email (optional)
            <Input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-56"
            />
          </label>
          <label className="text-sm text-ink-mute">
            TTL hours (optional)
            <Input
              type="number"
              min={1}
              value={ttlHours}
              onChange={e => setTtlHours(e.target.value)}
              className="w-32"
            />
          </label>
          <Button type="submit" disabled={createInvitation.isPending}>
            Create invitation
          </Button>
        </form>
        {createInvitation.isError && (
          <p role="alert" className="mt-2 text-sm text-ink">
            {(createInvitation.error as Error).message}
          </p>
        )}
        {newInviteLink && (
          <div className="mt-4 flex flex-col gap-2 rounded-sm border border-hairline bg-canvas-soft p-4">
            <p className="text-sm text-ink-mute">Invitation link (shown once — copy it now):</p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="break-all text-sm">{newInviteLink}</code>
              <Button
                type="button"
                variant="outline"
                className="px-3 py-1.5 text-sm"
                onClick={copyLink}
              >
                {copied ? 'Copied!' : 'Copy'}
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
