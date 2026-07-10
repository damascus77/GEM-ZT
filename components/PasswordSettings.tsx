'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';

export function PasswordSettings() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    if (newPassword !== confirm) {
      setError('New passwords do not match.');
      return;
    }
    setBusy(true);
    const res = await fetch('/api/v1/auth/password', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? 'Failed to change password.');
      return;
    }
    setCurrentPassword('');
    setNewPassword('');
    setConfirm('');
    setSuccess(true);
  }

  return (
    <Card>
      <h2 className="wght-540 mb-4 text-[20px] tracking-[-0.4px]">Password</h2>
      <form onSubmit={onSubmit} className="flex max-w-sm flex-col gap-4">
        <label className="text-sm text-ink-mute">
          Current password
          <Input
            type="password"
            value={currentPassword}
            onChange={e => setCurrentPassword(e.target.value)}
            required
          />
        </label>
        <label className="text-sm text-ink-mute">
          New password
          <Input
            type="password"
            value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            minLength={10}
            required
          />
        </label>
        <label className="text-sm text-ink-mute">
          Confirm new password
          <Input
            type="password"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            required
          />
        </label>
        {error && (
          <p role="alert" className="text-sm text-ink">
            {error}
          </p>
        )}
        {success && (
          <p role="status" className="text-sm text-ink">
            Password changed. Your other sessions have been signed out.
          </p>
        )}
        <Button type="submit" disabled={busy}>
          Change password
        </Button>
      </form>
    </Card>
  );
}
