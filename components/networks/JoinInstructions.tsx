'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';

interface JoinCommand {
  label: string;
  copyLabel: string;
  command: string;
}

function CommandBlock({ label, copyLabel, command }: JoinCommand) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    if (!navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access denied or unavailable — no-op.
    }
  };

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="wght-600 text-sm text-ink">{label}</span>
        <Button
          variant="outline"
          className="px-3 py-1 text-xs"
          aria-label={`Copy ${copyLabel} join command`}
          onClick={handleCopy}
        >
          {copied ? 'Copied!' : 'Copy'}
        </Button>
      </div>
      <pre className="overflow-x-auto rounded-md border border-hairline bg-canvas-soft p-3">
        <code className="font-mono text-sm text-ink">{command}</code>
      </pre>
    </div>
  );
}

const MEMBER_ID_RE = /^[0-9a-f]{10}$/;

// Rendered only when the join URL carries a self-authorize ?token=. Lets the
// person joining authorize their own device (after running the join command)
// without an admin approving it manually.
function SelfAuthorize({ nwid, token }: { nwid: string; token: string }) {
  const [memberId, setMemberId] = useState('');
  const [status, setStatus] = useState<'idle' | 'pending' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');

  const normalized = memberId.trim().toLowerCase();
  const valid = MEMBER_ID_RE.test(normalized);

  async function submit() {
    setStatus('pending');
    setMessage('');
    try {
      const res = await fetch(`/api/v1/networks/${nwid}/self-authorize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, memberId: normalized }),
      });
      if (!res.ok) {
        const parsed = await res.json().catch(() => null);
        setStatus('error');
        setMessage(parsed?.error?.message ?? 'Could not authorize this device.');
        return;
      }
      setStatus('done');
      setMessage('This device is now authorized on the network.');
    } catch {
      setStatus('error');
      setMessage('Network error — please try again.');
    }
  }

  return (
    <div className="rounded-md border border-teal-mid bg-canvas-soft p-3">
      <span className="wght-600 mb-1 block text-sm text-ink">Authorize this device</span>
      {status === 'done' ? (
        <p role="status" className="text-sm text-ink">
          ✓ {message}
        </p>
      ) : (
        <>
          <p className="mb-2 text-sm text-ink-mute">
            After running the join command, find this device’s 10-character node ID (
            <code className="font-mono text-ink">zerotier-cli info</code>) and enter it to authorize
            it instantly.
          </p>
          <div className="flex gap-2">
            <Input
              value={memberId}
              placeholder="e.g. 1a2b3c4d5e"
              onChange={e => setMemberId(e.target.value)}
              className="mt-0 font-mono"
              aria-label="Device node ID"
            />
            <Button
              className="shrink-0"
              disabled={!valid || status === 'pending'}
              onClick={submit}
            >
              {status === 'pending' ? 'Authorizing…' : 'Authorize'}
            </Button>
          </div>
          {status === 'error' && (
            <p role="alert" className="mt-2 text-sm text-ink">
              {message}
            </p>
          )}
        </>
      )}
    </div>
  );
}

export function JoinInstructions({ nwid }: { nwid: string }) {
  const commands: JoinCommand[] = [
    { label: 'Linux/macOS', copyLabel: 'Linux/macOS', command: `sudo zerotier-cli join ${nwid}` },
    {
      label: 'Windows (PowerShell as admin)',
      copyLabel: 'Windows',
      command: `zerotier-cli join ${nwid}`,
    },
  ];

  // Read the self-authorize token from the URL on the client (avoids the
  // useSearchParams static-render bailout) and prep a QR of the network ID.
  const [token, setToken] = useState<string | null>(null);
  const [nwidQr, setNwidQr] = useState<string | null>(null);
  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get('token'));
    QRCode.toDataURL(nwid)
      .then(setNwidQr)
      .catch(() => setNwidQr(null));
  }, [nwid]);

  return (
    <Card className="flex flex-col gap-4">
      {commands.map(c => (
        <CommandBlock key={c.label} {...c} />
      ))}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div>
          <span className="wght-600 mb-1 block text-sm text-ink">Mobile</span>
          <p className="text-sm text-ink-mute">
            Open the ZeroTier One app → tap + → enter{' '}
            <code className="font-mono text-ink">{nwid}</code>
          </p>
        </div>
        {nwidQr && (
          <img
            src={nwidQr}
            alt="Network ID QR code"
            width={120}
            height={120}
            className="shrink-0 rounded-sm bg-white p-1 sm:ml-auto"
          />
        )}
      </div>
      {token && <SelfAuthorize nwid={nwid} token={token} />}
    </Card>
  );
}
