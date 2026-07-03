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
      <h2 className="text-[20px] wght-540 tracking-[-0.4px] mb-4">Backup</h2>
      <p className="text-sm text-ink-mute mb-4">
        Download a JSON snapshot of every network, its rules, members, and GEM-ZT metadata.
      </p>
      <Button variant="outline" className="px-3 py-2 text-sm" disabled={downloading} onClick={handleDownload}>
        Download backup
      </Button>

      <div className="mt-6 pt-6 border-t border-hairline">
        <h3 className="text-sm font-bold mb-2">Restore</h3>
        <p className="text-sm text-ink-mute mb-4">
          Replay a backup file against the live controller. Existing networks are updated in
          place; missing ones are re-created with a new network id.
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
            onChange={(e) => setRestoreFile(e.target.files?.[0] ?? null)}
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
        <p role="alert" className="text-sm text-ink mt-2">
          {error}
        </p>
      )}
      {summary && (
        <div role="status" className="text-sm text-ink mt-2">
          <p>
            {summary.networksCreated} network(s) created, {summary.networksUpdated} network(s)
            updated, {summary.membersRestored} member(s) restored, {summary.membersSkipped}{' '}
            member(s) skipped.
          </p>
          {summary.warnings.length > 0 && (
            <ul className="list-disc list-inside text-ink-mute mt-1">
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
