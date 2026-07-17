'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

interface JoinTokenView {
  id: string;
  nwid: string;
  maxUses: number;
  usedCount: number;
  expiresAt: string;
  createdAt: string;
}

interface GeneratedToken {
  url: string;
  qrDataUrl: string;
  view: JoinTokenView;
}

const TTL_OPTIONS = [
  { label: '1 hour', hours: 1 },
  { label: '24 hours', hours: 24 },
  { label: '7 days', hours: 168 },
];

const selectClass =
  'mt-0 bg-canvas text-ink text-sm rounded-sm border border-hairline px-2 py-2 focus:outline-none';

export function JoinLinkPanel({ nwid }: { nwid: string }) {
  const queryClient = useQueryClient();
  const [ttlHours, setTtlHours] = useState(24);
  const [maxUses, setMaxUses] = useState(0);
  const [generated, setGenerated] = useState<GeneratedToken | null>(null);
  const [copied, setCopied] = useState(false);

  const tokensQuery = useQuery<{ tokens: JoinTokenView[] }>({
    queryKey: ['join-tokens', nwid],
    queryFn: async () => {
      const res = await fetch(`/api/v1/networks/${nwid}/join-tokens`);
      if (!res.ok) throw new Error('Failed to load join links');
      return res.json();
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/v1/networks/${nwid}/join-tokens`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttlHours, maxUses }),
      });
      if (!res.ok) {
        const parsed = await res.json().catch(() => null);
        throw new Error(parsed?.error?.message ?? 'Failed to create join link');
      }
      return res.json() as Promise<{ token: string; tokenView: JoinTokenView }>;
    },
    onSuccess: async ({ token, tokenView }) => {
      const url = `${window.location.origin}/networks/${nwid}/join?token=${token}`;
      const qrDataUrl = await QRCode.toDataURL(url);
      setGenerated({ url, qrDataUrl, view: tokenView });
      setCopied(false);
      queryClient.invalidateQueries({ queryKey: ['join-tokens', nwid] });
    },
  });

  const revoke = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/v1/networks/${nwid}/join-tokens/${id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) {
        const parsed = await res.json().catch(() => null);
        throw new Error(parsed?.error?.message ?? 'Failed to revoke');
      }
    },
    onSuccess: (_data, id) => {
      // Drop the just-generated card if it was the one revoked.
      setGenerated(g => (g && g.view.id === id ? null : g));
      queryClient.invalidateQueries({ queryKey: ['join-tokens', nwid] });
    },
  });

  async function copyUrl() {
    if (!generated || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(generated.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable — no-op.
    }
  }

  const tokens = tokensQuery.data?.tokens ?? [];

  return (
    <Card className="!p-5">
      <h2 className="wght-540 mb-1 text-[20px] tracking-[-0.4px]">Self-authorize join link</h2>
      <p className="mb-3 text-sm text-ink-mute">
        Share a time-limited link (or QR) so a device can authorize itself right after joining — no
        need to approve it here manually.
      </p>

      <div className="mb-3 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-ink-mute">
          Expires in
          <select
            className={selectClass}
            value={ttlHours}
            onChange={e => setTtlHours(Number(e.target.value))}
            aria-label="Join link expiry"
          >
            {TTL_OPTIONS.map(o => (
              <option key={o.hours} value={o.hours}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-mute">
          Max uses (0 = unlimited)
          <input
            type="number"
            min={0}
            max={1000}
            value={maxUses}
            onChange={e => setMaxUses(Math.max(0, Number(e.target.value) || 0))}
            className="w-36 rounded-sm border border-hairline bg-canvas px-2 py-2 text-sm text-ink"
            aria-label="Join link max uses"
          />
        </label>
        <Button disabled={create.isPending} onClick={() => create.mutate()}>
          Generate link
        </Button>
      </div>
      {create.isError && (
        <p role="alert" className="mb-2 text-sm text-ink">
          {(create.error as Error).message}
        </p>
      )}

      {generated && (
        <div className="mb-4 flex flex-col gap-3 rounded-md border border-hairline bg-canvas-soft p-3 sm:flex-row sm:items-center">
          <img
            src={generated.qrDataUrl}
            alt="Join link QR code"
            width={140}
            height={140}
            className="shrink-0 self-start rounded-sm bg-white p-1"
          />
          <div className="min-w-0 flex-1">
            <p className="mb-1 text-xs text-ink-mute">
              Share this link or QR — it’s shown once, so copy it now.
            </p>
            <pre className="overflow-x-auto rounded-sm border border-hairline bg-canvas p-2">
              <code className="font-mono text-xs text-ink">{generated.url}</code>
            </pre>
            <div className="mt-2 flex gap-2">
              <Button variant="outline" className="px-3 py-1 text-xs" onClick={copyUrl}>
                {copied ? 'Copied!' : 'Copy link'}
              </Button>
              <Button
                variant="outline"
                className="px-3 py-1 text-xs"
                disabled={revoke.isPending}
                onClick={() => revoke.mutate(generated.view.id)}
              >
                Revoke
              </Button>
            </div>
          </div>
        </div>
      )}

      <h3 className="wght-600 mb-2 text-sm text-ink-mute">Active links</h3>
      {tokens.length === 0 ? (
        <p className="text-sm text-ink-mute">No active join links.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {tokens.map(t => (
            <li
              key={t.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-hairline p-2 text-sm"
            >
              <span className="text-ink-mute">
                {t.maxUses === 0
                  ? `${t.usedCount} use(s), unlimited`
                  : `${t.usedCount}/${t.maxUses} used`}{' '}
                · expires {new Date(t.expiresAt).toLocaleString()}
              </span>
              <Button
                variant="outline"
                className="px-3 py-1 text-xs"
                disabled={revoke.isPending}
                onClick={() => revoke.mutate(t.id)}
              >
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
