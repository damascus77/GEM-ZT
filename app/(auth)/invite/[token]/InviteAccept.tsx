'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';

interface PreviewResponse {
  org: { name: string };
  role: string;
}

interface PreviewError {
  status: number;
  message: string;
}

export function InviteAccept({ token }: { token: string }) {
  const previewQuery = useQuery<PreviewResponse, PreviewError>({
    queryKey: ['invitation-preview', token],
    queryFn: async () => {
      const res = await fetch(`/api/v1/invitations/${token}`);
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw { status: res.status, message: body?.error?.message ?? 'Invitation is invalid.' };
      }
      return body;
    },
    retry: false,
  });

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/v1/invitations/${token}/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    setBusy(false);
    if (res.ok) {
      window.location.href = '/';
      return;
    }
    const body = await res.json().catch(() => null);
    setError(body?.error?.message ?? 'Could not accept invitation.');
  }

  if (previewQuery.isLoading) {
    return (
      <Card className="w-full max-w-sm">
        <p className="text-ink-mute">Loading invitation…</p>
      </Card>
    );
  }

  if (previewQuery.isError) {
    const status = previewQuery.error?.status;
    let heading = 'Invitation invalid';
    if (status === 410) heading = 'Invitation expired';
    else if (status === 409) heading = 'Invitation already used';
    else if (status === 404) heading = 'Invitation not found';
    return (
      <Card className="w-full max-w-sm">
        <h1 className="wght-540 mb-2 text-[22px] tracking-[-0.315px]">{heading}</h1>
        <p role="alert" className="text-sm text-ink-mute">
          {previewQuery.error?.message ?? 'This invitation is invalid.'}
        </p>
      </Card>
    );
  }

  const preview = previewQuery.data!;

  return (
    <Card className="w-full max-w-sm">
      <h1 className="wght-540 mb-2 text-[22px] tracking-[-0.315px]">
        You&apos;ve been invited to {preview.org.name}
      </h1>
      <p className="mb-6 text-sm text-ink-mute">
        Role: <span className="capitalize">{preview.role}</span>
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
        {error && (
          <p role="alert" className="text-sm text-ink">
            {error}
          </p>
        )}
        <Button type="submit" disabled={busy}>
          Create account &amp; join
        </Button>
      </form>
    </Card>
  );
}
