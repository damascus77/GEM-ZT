'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ssoEnabled, setSsoEnabled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Surface a "Sign in with SSO" button only when the instance has OIDC
    // configured. Also flag a failed SSO round trip (?error=sso on the callback).
    if (new URLSearchParams(window.location.search).get('error') === 'sso') {
      setError('SSO sign-in failed. Please try again or use your password.');
    }
    fetch('/api/v1/setup/status')
      .then(r => (r.ok ? r.json() : null))
      .then(body => {
        if (!cancelled && body?.sso) setSsoEnabled(true);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch('/api/v1/auth/login', {
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
    setError(body?.error?.message ?? 'Login failed.');
  }

  return (
    <Card className="w-full max-w-sm">
      <h1 className="wght-540 mb-6 text-[22px] tracking-[-0.315px]">Sign in</h1>
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
            required
          />
        </label>
        {error && (
          <p role="alert" className="text-sm text-ink">
            {error}
          </p>
        )}
        <Button type="submit" disabled={busy}>
          Sign in
        </Button>
      </form>
      {ssoEnabled && (
        <>
          <div className="my-4 flex items-center gap-3 text-xs text-ink-mute">
            <span className="h-px flex-1 bg-line" />
            or
            <span className="h-px flex-1 bg-line" />
          </div>
          <a
            href="/api/v1/auth/oidc/login"
            className="block w-full rounded-md border border-line py-2 text-center text-sm text-ink hover:bg-surface-2"
          >
            Sign in with SSO
          </a>
        </>
      )}
    </Card>
  );
}
