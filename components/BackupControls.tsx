'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file.'));
    reader.readAsText(file);
  });
}

interface RestoreSummary {
  networksCreated: number;
  networksUpdated: number;
  membersRestored: number;
  membersSkipped: number;
  warnings: string[];
}

export function BackupControls() {
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [summary, setSummary] = useState<RestoreSummary | null>(null);

  async function handleDownload() {
    setError(null);
    setDownloading(true);
    try {
      const res = await fetch('/api/v1/backup');
      if (!res.ok) throw new Error('Failed to download backup.');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      try {
        const a = document.createElement('a');
        a.href = url;
        a.download = 'gemzt-backup.json';
        a.click();
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDownloading(false);
    }
  }

  async function handleRestore() {
    if (!restoreFile) return;
    setError(null);
    setSummary(null);
    setRestoring(true);
    try {
      const text = await readFileAsText(restoreFile);
      const data = JSON.parse(text);
      const res = await fetch('/api/v1/backup/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message || 'Failed to restore backup.');
      }
      setSummary((await res.json()) as RestoreSummary);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRestoring(false);
    }
  }

  return (
    <Card>
      <h2 className="wght-540 mb-4 text-[20px] tracking-[-0.4px]">Backup</h2>
      <p className="mb-4 text-sm text-ink-mute">
        Download a JSON snapshot of every network, its rules, members, and GEM-ZT metadata.
      </p>
      <Button
        variant="outline"
        className="px-3 py-2 text-sm"
        disabled={downloading}
        onClick={handleDownload}
      >
        Download backup
      </Button>

      <div className="mt-6 border-t border-hairline pt-6">
        <h3 className="mb-2 text-sm font-bold">Restore</h3>
        <p className="mb-4 text-sm text-ink-mute">
          Replay a backup file against the live controller. Existing networks are updated in place;
          missing ones are re-created with a new network id.
        </p>
        <div className="flex items-center gap-3">
          <label className="text-sm" htmlFor="restore-file-input">
            Restore file
          </label>
          <input
            id="restore-file-input"
            aria-label="Restore file"
            type="file"
            accept=".json,application/json"
            onChange={e => setRestoreFile(e.target.files?.[0] ?? null)}
          />
          <Button
            variant="outline"
            className="px-3 py-2 text-sm"
            disabled={!restoreFile || restoring}
            onClick={handleRestore}
          >
            Restore
          </Button>
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-2 text-sm text-ink">
          {error}
        </p>
      )}
      {summary && (
        <div role="status" className="mt-2 text-sm text-ink">
          <p>
            {summary.networksCreated} network(s) created, {summary.networksUpdated} network(s)
            updated, {summary.membersRestored} member(s) restored, {summary.membersSkipped}{' '}
            member(s) skipped.
          </p>
          {summary.warnings.length > 0 && (
            <ul className="mt-1 list-inside list-disc text-ink-mute">
              {summary.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}
