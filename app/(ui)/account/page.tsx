'use client';

import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/ui/Card';
import { PasswordSettings } from '@/components/PasswordSettings';
import { TotpSettings } from '@/components/TotpSettings';

interface Me {
  id: string;
  username: string;
  role: string;
  totpEnabled: boolean;
}

export default function AccountPage() {
  const { data: me, isError } = useQuery<Me>({
    queryKey: ['me'],
    queryFn: async () => {
      const res = await fetch('/api/v1/me');
      if (!res.ok) throw new Error('Failed to load account');
      const d = await res.json();
      return d.user;
    },
  });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="wght-540 text-[28px] tracking-[-0.63px]">Account</h1>

      <Card>
        <h2 className="wght-540 mb-4 text-[20px] tracking-[-0.4px]">Profile</h2>
        {isError && !me ? (
          <p role="alert" className="text-sm text-ink">
            Could not load account. Refresh to retry.
          </p>
        ) : me ? (
          <dl className="text-sm">
            <div className="flex gap-2">
              <dt className="text-ink-mute">Username</dt>
              <dd>{me.username}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-ink-mute">Role</dt>
              <dd>{me.role}</dd>
            </div>
          </dl>
        ) : (
          <p className="text-ink-mute">Loading…</p>
        )}
      </Card>

      <PasswordSettings />

      {me && <TotpSettings initialEnabled={me.totpEnabled} />}
    </div>
  );
}
