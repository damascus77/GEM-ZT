'use client';

import { useState } from 'react';
import QRCode from 'qrcode';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';

export function TotpSettings({ initialEnabled }: { initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [secret, setSecret] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [disablePassword, setDisablePassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function startEnroll() {
    setError(null);
    setBusy(true);
    const res = await fetch('/api/v1/auth/totp/enroll', { method: 'POST' });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? 'Failed to start 2FA enrollment.');
      return;
    }
    const body = await res.json();
    setSecret(body.secret);
    setQrDataUrl(await QRCode.toDataURL(body.otpauthUri));
  }

  async function confirmEnroll(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const res = await fetch('/api/v1/auth/totp/enable', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? 'Invalid or expired code.');
      return;
    }
    setEnabled(true);
    setSecret(null);
    setQrDataUrl(null);
    setCode('');
  }

  async function disable(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const res = await fetch('/api/v1/auth/totp/disable', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: disablePassword }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setError(body?.error?.message ?? 'Failed to disable 2FA.');
      return;
    }
    setEnabled(false);
    setDisablePassword('');
  }

  return (
    <Card>
      <h2 className="text-[20px] wght-540 tracking-[-0.4px] mb-4">Two-Factor Authentication</h2>
      {error && (
        <p role="alert" className="text-sm text-ink mb-4">
          {error}
        </p>
      )}
      {enabled && !secret && (
        <div className="flex flex-col gap-4 max-w-sm">
          <p className="text-sm text-ink-mute">Two-factor authentication is enabled.</p>
          <form onSubmit={disable} className="flex flex-col gap-4">
            <label className="text-sm text-ink-mute">
              Current password
              <Input
                type="password"
                value={disablePassword}
                onChange={(e) => setDisablePassword(e.target.value)}
                required
              />
            </label>
            <Button type="submit" variant="outline" disabled={busy}>
              Disable 2FA
            </Button>
          </form>
        </div>
      )}
      {!enabled && !secret && (
        <div>
          <p className="text-sm text-ink-mute mb-4">Two-factor authentication is not enabled.</p>
          <Button onClick={startEnroll} disabled={busy}>
            Set up 2FA
          </Button>
        </div>
      )}
      {!enabled && secret && (
        <div className="flex flex-col gap-4 max-w-sm">
          <p className="text-sm text-ink-mute">
            Scan this code with your authenticator app, or enter the key manually.
          </p>
          {qrDataUrl && <img src={qrDataUrl} alt="2FA QR code" width={200} height={200} />}
          <code className="font-mono text-sm break-all">{secret}</code>
          <form onSubmit={confirmEnroll} className="flex flex-col gap-4">
            <label className="text-sm text-ink-mute">
              6-digit code
              <Input value={code} onChange={(e) => setCode(e.target.value)} maxLength={6} required />
            </label>
            <Button type="submit" disabled={busy}>
              Confirm and enable
            </Button>
          </form>
        </div>
      )}
    </Card>
  );
}
