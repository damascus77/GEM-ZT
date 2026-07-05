'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';

interface OrgRow {
  id: string;
  name: string;
  slug: string;
  role: string | null;
}

interface MeResponse {
  user: { isSuperAdmin: boolean };
}

export function AdminOrgs() {
  const queryClient = useQueryClient();

  const meQuery = useQuery<MeResponse>({
    queryKey: ['me'],
    queryFn: async () => {
      const res = await fetch('/api/v1/me');
      if (!res.ok) throw new Error('Failed to load account.');
      return res.json();
    },
  });

  const isSuperAdmin = Boolean(meQuery.data?.user.isSuperAdmin);

  const orgsQuery = useQuery<{ orgs: OrgRow[] }>({
    queryKey: ['admin-orgs'],
    queryFn: async () => {
      const res = await fetch('/api/v1/orgs');
      if (!res.ok) throw new Error('Failed to load organizations.');
      return res.json();
    },
    enabled: isSuperAdmin,
  });

  const [name, setName] = useState('');

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['admin-orgs'] });
  }

  const create = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/v1/orgs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const parsed = await res.json().catch(() => null);
        throw new Error(parsed?.error?.message ?? 'Failed to create organization.');
      }
      return res.json();
    },
    onSuccess: () => {
      setName('');
      invalidate();
    },
  });

  const remove = useMutation({
    mutationFn: async (orgId: string) => {
      const res = await fetch(`/api/v1/orgs/${orgId}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) {
        const parsed = await res.json().catch(() => null);
        throw new Error(parsed?.error?.message ?? 'Failed to delete organization.');
      }
    },
    onSuccess: invalidate,
  });

  function confirmDelete(org: OrgRow) {
    if (window.confirm(`Delete organization "${org.name}"? This cannot be undone.`)) {
      remove.mutate(org.id);
    }
  }

  if (meQuery.isLoading) {
    return <p className="text-ink-mute">Loading…</p>;
  }

  if (!isSuperAdmin) {
    return (
      <Card>
        <p role="alert" className="text-sm text-ink">
          Super-admin access required.
        </p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <h2 className="text-[20px] wght-540 tracking-[-0.4px] mb-4">Create an organization</h2>
        <form
          className="flex gap-2 flex-wrap items-end"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <label className="text-sm text-ink-mute">
            Name
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-64"
            />
          </label>
          <Button type="submit" disabled={create.isPending || name === ''}>
            Create organization
          </Button>
        </form>
        {create.isError && (
          <p role="alert" className="text-sm text-ink mt-2">
            {(create.error as Error).message}
          </p>
        )}
      </Card>

      <Card className="overflow-x-auto">
        <h2 className="text-[20px] wght-540 tracking-[-0.4px] mb-4">Organizations</h2>
        {orgsQuery.isLoading && <p className="text-ink-mute">Loading…</p>}
        {orgsQuery.isError && !orgsQuery.data && (
          <p role="alert" className="text-sm text-ink">
            Could not load organizations. Refresh to retry.
          </p>
        )}
        {remove.isError && (
          <p role="alert" className="text-sm text-ink mb-2">
            {(remove.error as Error).message}
          </p>
        )}
        {orgsQuery.data && orgsQuery.data.orgs.length === 0 && (
          <p className="text-ink-mute">No organizations yet.</p>
        )}
        {orgsQuery.data && orgsQuery.data.orgs.length > 0 && (
          <table className="w-full text-left">
            <thead>
              <tr className="text-xs text-ink-faint uppercase">
                <th className="pb-2 pr-4">Name</th>
                <th className="pb-2 pr-4">Slug</th>
                <th className="pb-2">&nbsp;</th>
              </tr>
            </thead>
            <tbody>
              {orgsQuery.data.orgs.map((org) => (
                <tr key={org.id} className="border-t border-hairline">
                  <td className="py-3 pr-4 wght-540">{org.name}</td>
                  <td className="py-3 pr-4 text-sm text-ink-mute">{org.slug}</td>
                  <td className="py-3">
                    <Button
                      variant="outline"
                      className="px-3 py-2 text-sm"
                      disabled={remove.isPending}
                      onClick={() => confirmDelete(org)}
                    >
                      Delete
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
