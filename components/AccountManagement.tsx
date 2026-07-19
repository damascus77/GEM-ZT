'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/ui/Card';
import { OrgInvitations } from '@/components/OrgInvitations';
import { OrgMembers } from '@/components/OrgMembers';
import type { OrgRole } from '@/lib/authz/roles';

interface MeResponse {
  user: { isSuperAdmin: boolean };
  activeOrgId: string | null;
}

interface OrgOption {
  id: string;
  name: string;
  slug: string;
  role: OrgRole | null;
}

export function AccountManagement() {
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null);

  const meQuery = useQuery<MeResponse>({
    queryKey: ['me'],
    queryFn: async () => {
      const res = await fetch('/api/v1/me');
      if (!res.ok) throw new Error('Failed to load account.');
      return res.json();
    },
  });

  const orgsQuery = useQuery<{ orgs: OrgOption[] }>({
    queryKey: ['orgs'],
    queryFn: async () => {
      const res = await fetch('/api/v1/orgs');
      if (!res.ok) throw new Error('Failed to load organizations.');
      return res.json();
    },
  });

  const manageableOrgs = useMemo(() => {
    const orgs = orgsQuery.data?.orgs ?? [];
    if (meQuery.data?.user.isSuperAdmin) return orgs;
    return orgs.filter(o => o.role === 'admin' || o.role === 'owner');
  }, [meQuery.data, orgsQuery.data]);

  const defaultOrgId = useMemo(() => {
    if (manageableOrgs.length === 0) return null;
    const activeOrg = manageableOrgs.find(o => o.id === meQuery.data?.activeOrgId);
    return activeOrg?.id ?? manageableOrgs[0].id;
  }, [manageableOrgs, meQuery.data?.activeOrgId]);

  const effectiveSelectedOrgId =
    selectedOrgId && manageableOrgs.some(o => o.id === selectedOrgId)
      ? selectedOrgId
      : defaultOrgId;

  useEffect(() => {
    if (manageableOrgs.length === 0 && selectedOrgId !== null) setSelectedOrgId(null);
  }, [manageableOrgs.length, selectedOrgId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.location.hash !== '#invitations' || !effectiveSelectedOrgId) return;
    window.requestAnimationFrame(() => {
      document.getElementById('invitations')?.scrollIntoView();
    });
  }, [effectiveSelectedOrgId]);

  if (meQuery.isLoading || orgsQuery.isLoading) {
    return <p className="text-ink-mute">Loading…</p>;
  }

  if (meQuery.isError || orgsQuery.isError) {
    return (
      <Card>
        <p role="alert" className="text-sm text-ink">
          Could not load account management. Refresh to retry.
        </p>
      </Card>
    );
  }

  if (manageableOrgs.length === 0) {
    return (
      <Card>
        <p role="alert" className="text-sm text-ink">
          You need an owner or admin role in an organization to manage accounts.
        </p>
      </Card>
    );
  }

  if (!effectiveSelectedOrgId) {
    return <p className="text-ink-mute">Loading…</p>;
  }

  const selectedOrg = manageableOrgs.find(o => o.id === effectiveSelectedOrgId)!;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="wght-540 text-[20px] tracking-[-0.4px]">Organization</h2>
            <p className="mt-1 text-sm text-ink-mute">Choose where accounts will be managed.</p>
          </div>
          {manageableOrgs.length > 1 ? (
            <label className="text-sm text-ink-mute">
              Organization
              <select
                value={effectiveSelectedOrgId}
                onChange={e => setSelectedOrgId(e.target.value)}
                className="mt-1 block min-w-56 rounded-sm border border-hairline bg-canvas px-3 py-2.5 text-base text-ink focus:border-hairline-dark focus:outline-none"
              >
                {manageableOrgs.map(org => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="text-sm text-ink-mute">
              Organization
              <div className="mt-1 text-ink">{selectedOrg.name}</div>
            </div>
          )}
        </div>
      </Card>

      <OrgMembers
        key={`members-${effectiveSelectedOrgId}`}
        orgId={effectiveSelectedOrgId}
        orgSelectionMode="fixed"
      />
      <div id="invitations">
        <OrgInvitations
          key={`invitations-${effectiveSelectedOrgId}`}
          orgId={effectiveSelectedOrgId}
        />
      </div>
    </div>
  );
}
