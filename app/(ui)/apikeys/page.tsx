'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { dateInputToEndOfDayIso } from '@/lib/util/date';
import { ORG_ROLES, type OrgRole } from '@/lib/authz/roles';

interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  createdAt: string;
  expiresAt: string | null;
}

export default function ApiKeysPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useQuery<{ apiKeys: ApiKeyRow[] }>({
    queryKey: ['apikeys'],
    queryFn: async () => {
      const res = await fetch('/api/v1/apikeys');
      if (!res.ok) throw new Error('Failed to load API keys');
      return res.json();
    },
  });

  const [name, setName] = useState('');
  const [role, setRole] = useState<OrgRole>('viewer');
  const [expiresAt, setExpiresAt] = useState('');
  const [revealed, setRevealed] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = { name, role };
      if (expiresAt !== '') body.expiresAt = dateInputToEndOfDayIso(expiresAt);
      const res = await fetch('/api/v1/apikeys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const parsed = await res.json().catch(() => null);
        throw new Error(parsed?.error?.message ?? 'Create failed');
      }
      return res.json() as Promise<{ fullKey: string }>;
    },
    onSuccess: body => {
      setRevealed(body.fullKey);
      setName('');
      setRole('viewer');
      setExpiresAt('');
      queryClient.invalidateQueries({ queryKey: ['apikeys'] });
    },
  });

  const revoke = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/v1/apikeys/${id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) {
        const parsed = await res.json().catch(() => null);
        throw new Error(parsed?.error?.message ?? 'Revoke failed');
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['apikeys'] }),
  });

  function confirmRevoke(key: ApiKeyRow) {
    if (window.confirm(`Revoke key "${key.name}"? Any client using it will stop working.`)) {
      revoke.mutate(key.id);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="wght-540 text-[28px] tracking-[-0.63px]">API Keys</h1>

      <Card>
        <h2 className="wght-540 mb-4 text-[20px] tracking-[-0.4px]">Create a key</h2>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={e => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <Input
            placeholder="Key name (e.g. homelab-scripts)"
            value={name}
            onChange={e => setName(e.target.value)}
            required
            className="mt-0 w-64"
          />
          <label className="text-sm text-ink-mute">
            Role
            <select
              className="mt-1 block rounded-sm border border-hairline bg-canvas px-2 py-2 text-sm text-ink"
              value={role}
              onChange={e => setRole(e.target.value as OrgRole)}
            >
              {ORG_ROLES.map(r => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-ink-mute">
            Expires (optional)
            <Input
              type="date"
              value={expiresAt}
              onChange={e => setExpiresAt(e.target.value)}
              className="mt-1 w-44"
            />
          </label>
          <Button type="submit" disabled={create.isPending || name === ''}>
            Create key
          </Button>
        </form>
        {create.isError && (
          <p role="alert" className="mt-2 text-sm text-ink">
            {(create.error as Error).message}
          </p>
        )}
        {revealed && (
          <div className="mt-4 rounded-sm border border-hairline bg-canvas-soft p-4">
            <p className="wght-600 mb-1 text-sm">Copy this key now — it will not be shown again.</p>
            <code className="break-all font-mono text-sm">{revealed}</code>
            <p className="mt-2 text-xs text-ink-mute">
              Use it as <code>Authorization: Bearer {'<key>'}</code>.
            </p>
          </div>
        )}
      </Card>

      <Card className="overflow-x-auto">
        <h2 className="wght-540 mb-4 text-[20px] tracking-[-0.4px]">Existing keys</h2>
        {isLoading && <p className="text-ink-mute">Loading…</p>}
        {isError && !data && (
          <p role="alert" className="text-sm text-ink">
            Could not load API keys. Refresh to retry.
          </p>
        )}
        {revoke.isError && (
          <p role="alert" className="mb-2 text-sm text-ink">
            {(revoke.error as Error).message}
          </p>
        )}
        {data && data.apiKeys.length === 0 && <p className="text-ink-mute">No API keys yet.</p>}
        {data && data.apiKeys.length > 0 && (
          <table className="w-full text-left">
            <thead>
              <tr className="text-xs uppercase text-ink-faint">
                <th className="pb-2 pr-4">Name</th>
                <th className="pb-2 pr-4">Key</th>
                <th className="pb-2 pr-4">Created</th>
                <th className="pb-2 pr-4">Last used</th>
                <th className="pb-2 pr-4">Expires</th>
                <th className="pb-2">&nbsp;</th>
              </tr>
            </thead>
            <tbody>
              {data.apiKeys.map(k => (
                <tr key={k.id} className="border-t border-hairline">
                  <td className="wght-540 py-3 pr-4">{k.name}</td>
                  <td className="py-3 pr-4 font-mono text-sm text-ink-mute">{k.prefix}…</td>
                  <td className="py-3 pr-4 text-sm text-ink-mute">
                    {new Date(k.createdAt).toLocaleDateString()}
                  </td>
                  <td className="py-3 pr-4 text-sm text-ink-mute">
                    {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : 'never'}
                  </td>
                  <td className="py-3 pr-4 text-sm text-ink-mute">
                    {k.expiresAt ? new Date(k.expiresAt).toLocaleDateString() : 'never'}
                  </td>
                  <td className="py-3">
                    <Button
                      variant="destructive"
                      className="px-3 py-2 text-sm"
                      disabled={revoke.isPending}
                      onClick={() => confirmRevoke(k)}
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
    </div>
  );
}
