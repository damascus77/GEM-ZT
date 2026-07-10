'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';

export default function SetupPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    const res = await fetch('/api/v1/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    setBusy(false);
    if (res.ok) {
      router.push('/networks');
      return;
    }
    const body = await res.json().catch(() => null);
    setError(body?.error?.message ?? 'Setup failed.');
  }

  return (
    <Card className="w-full max-w-sm">
      <h1 className="wght-540 mb-2 text-[22px] tracking-[-0.315px]">Welcome to GEM-ZT</h1>
      <p className="mb-6 text-sm text-ink-mute">
        First-run setup: create the administrator account. No default passwords, ever.
      </p>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <label className="text-sm text-ink-mute">
          Username
          <Input value={username} onChange={e => setUsername(e.target.value)} required />
        </label>
        <label className="text-sm text-ink-mute">
          Password
          <Input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            minLength={10}
            required
          />
        </label>
        <label className="text-sm text-ink-mute">
          Confirm password
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
        <Button type="submit" disabled={busy}>
          Create admin account
        </Button>
      </form>
    </Card>
  );
}
