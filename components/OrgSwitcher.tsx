'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { clsx } from 'clsx';

interface Membership {
  orgId: string;
  orgName: string;
  orgSlug: string;
  role: string;
}

interface MeResponse {
  user: { isSuperAdmin: boolean };
  activeOrgId: string | null;
  memberships: Membership[];
}

export function OrgSwitcher({ className }: { className?: string }) {
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data } = useQuery<MeResponse>({
    queryKey: ['me'],
    queryFn: async () => {
      const res = await fetch('/api/v1/me');
      if (!res.ok) throw new Error('Failed to load account.');
      return res.json();
    },
  });

  if (!data) return null;

  const { memberships, activeOrgId, user } = data;
  if (memberships.length <= 1 && !user.isSuperAdmin) return null;

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const orgId = e.target.value;
    setError(null);
    setSwitching(true);
    try {
      const res = await fetch(`/api/v1/orgs/${orgId}/active`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message ?? 'Failed to switch organization.');
        setSwitching(false);
        return;
      }
      window.location.reload();
    } catch {
      setError('Failed to switch organization.');
      setSwitching(false);
    }
  }

  return (
    <div className={clsx('flex flex-col gap-1', className)}>
      <label htmlFor="org-switcher" className="text-xs text-on-dark-faint">
        Organization
      </label>
      <select
        id="org-switcher"
        value={activeOrgId ?? ''}
        onChange={handleChange}
        disabled={switching}
        className="rounded-md bg-primary-deep text-on-primary text-sm px-2 py-1 border border-hairline-dark disabled:opacity-60"
      >
        {memberships.map((m) => (
          <option key={m.orgId} value={m.orgId}>
            {m.orgName}
          </option>
        ))}
      </select>
      {error && (
        <span role="alert" className="text-xs text-on-dark-faint">
          {error}
        </span>
      )}
    </div>
  );
}
