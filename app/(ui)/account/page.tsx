'use client';

import { useEffect, useState } from 'react';
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
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    fetch('/api/v1/me')
      .then((r) => r.json())
      .then((d) => setMe(d.user))
      .catch(() => {});
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-[28px] wght-540 tracking-[-0.63px]">Account</h1>

      <Card>
        <h2 className="text-[20px] wght-540 tracking-[-0.4px] mb-4">Profile</h2>
        {me ? (
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
