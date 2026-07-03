'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

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
      <div className="flex items-center justify-between gap-2 mb-1">
        <span className="text-sm wght-600 text-ink">{label}</span>
        <Button
          variant="outline"
          className="px-3 py-1 text-xs"
          aria-label={`Copy ${copyLabel} join command`}
          onClick={handleCopy}
        >
          {copied ? 'Copied!' : 'Copy'}
        </Button>
      </div>
      <pre className="bg-canvas-soft border border-hairline rounded-md p-3 overflow-x-auto">
        <code className="font-mono text-sm text-ink">{command}</code>
      </pre>
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

  return (
    <Card className="flex flex-col gap-4">
      {commands.map((c) => (
        <CommandBlock key={c.label} {...c} />
      ))}
      <div>
        <span className="text-sm wght-600 text-ink block mb-1">Mobile</span>
        <p className="text-sm text-ink-mute">
          Open the ZeroTier One app → tap + → enter <code className="font-mono text-ink">{nwid}</code>
        </p>
      </div>
    </Card>
  );
}
