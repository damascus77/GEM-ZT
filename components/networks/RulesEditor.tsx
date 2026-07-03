'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useControllerStatus } from '@/components/DegradedBanner';
import { compileRules } from '@/lib/rules/compiler';
import { diffJsonLines, hasChanges, type DiffLine } from '@/lib/util/jsonDiff';

interface RulesResponse {
  source: string;
  rules: unknown[];
  sourceIsDefault?: boolean;
}

export function RulesEditor({ nwid }: { nwid: string }) {
  const queryClient = useQueryClient();
  const controller = useControllerStatus();
  const degraded = controller.data?.degraded ?? false;
  const { data } = useQuery<RulesResponse>({
    queryKey: ['rules', nwid],
    queryFn: async () => {
      const res = await fetch(`/api/v1/networks/${nwid}/rules`);
      if (!res.ok) throw new Error('Failed to load rules');
      return res.json();
    },
    refetchInterval: 5000,
  });

  const [tab, setTab] = useState<'source' | 'json'>('source');
  const [source, setSource] = useState('');
  const [seeded, setSeeded] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLines, setPreviewLines] = useState<DiffLine[] | null>(null);
  const [previewHasChanges, setPreviewHasChanges] = useState(false);

  useEffect(() => {
    if (data && !seeded) {
      setSource(data.source);
      setSeeded(true);
    }
  }, [data, seeded]);

  // Any edit invalidates the last preview so a stale diff is never shown.
  useEffect(() => {
    setPreviewError(null);
    setPreviewLines(null);
    setPreviewHasChanges(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  function previewChanges() {
    const compiled = compileRules(source);
    if (!compiled.ok) {
      setPreviewError(`line ${compiled.error.line}: ${compiled.error.message}`);
      setPreviewLines(null);
      return;
    }
    const liveRules = data?.rules ?? [];
    setPreviewError(null);
    setPreviewLines(diffJsonLines(liveRules, compiled.rules));
    setPreviewHasChanges(hasChanges(liveRules, compiled.rules));
  }

  const save = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/v1/networks/${nwid}/rules`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? 'Save failed');
      }
      return res.json();
    },
    onSuccess: (body: { metaWarning: string | null }) => {
      setWarning(body.metaWarning);
      queryClient.invalidateQueries({ queryKey: ['rules', nwid] });
    },
  });

  if (!seeded) {
    return (
      <Card>
        <h2 className="text-[20px] wght-540 tracking-[-0.4px] mb-4">Flow rules</h2>
        <p className="text-ink-mute">Loading…</p>
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-[20px] wght-540 tracking-[-0.4px]">Flow rules</h2>
        <div className="flex gap-2">
          <Button
            variant={tab === 'source' ? 'primary' : 'outline'}
            className="px-3 py-2 text-sm"
            onClick={() => setTab('source')}
          >
            Source
          </Button>
          <Button
            variant={tab === 'json' ? 'primary' : 'outline'}
            className="px-3 py-2 text-sm"
            onClick={() => setTab('json')}
          >
            Compiled JSON
          </Button>
        </div>
      </div>

      {tab === 'source' && (
        <div className="flex flex-col gap-3">
          {data?.sourceIsDefault && (
            <p role="alert" className="text-sm text-ink bg-canvas-soft border border-hairline rounded-sm p-3">
              <span className="wght-600">No saved rule source for this network.</span> The editor is
              showing the default template, which may not match the rules currently enforced on the
              controller (check the Compiled JSON tab). “Compile &amp; save” will replace the live rules.
            </p>
          )}
          <label className="text-sm text-ink-mute">
            Rules source
            <textarea
              value={source}
              onChange={(e) => setSource(e.target.value)}
              rows={14}
              spellCheck={false}
              className="mt-1 w-full bg-canvas text-ink text-sm rounded-sm border border-hairline px-3 py-2.5 font-mono focus:outline-none focus:border-hairline-dark"
            />
          </label>
          {save.isError && (
            <p role="alert" className="text-sm text-ink">
              {(save.error as Error).message}
            </p>
          )}
          {warning && <p className="text-sm text-ink-mute">{warning}</p>}
          <div className="flex gap-2">
            <Button variant="outline" onClick={previewChanges} disabled={degraded}>
              Preview changes
            </Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending || degraded}>
              Compile & save
            </Button>
          </div>

          {previewError && (
            <p role="alert" className="text-sm text-ink">
              {previewError}
            </p>
          )}

          {previewLines && (
            <div>
              <h3 className="text-sm wght-540 text-ink-mute mb-1">Preview: compiled rules diff</h3>
              {previewHasChanges ? (
                <pre className="bg-canvas-soft border border-hairline rounded-sm p-4 text-xs font-mono overflow-x-auto">
                  {previewLines.map((line, i) => (
                    <div
                      key={i}
                      className={
                        line.type === 'added'
                          ? 'text-teal-deep'
                          : line.type === 'removed'
                            ? 'text-ink-faint line-through'
                            : 'text-ink-mute'
                      }
                    >
                      {line.type === 'added' ? '+ ' : line.type === 'removed' ? '- ' : '  '}
                      {line.text}
                    </div>
                  ))}
                </pre>
              ) : (
                <p className="text-sm text-ink-mute">No changes</p>
              )}
            </div>
          )}
        </div>
      )}

      {tab === 'json' && (
        <pre className="bg-canvas-soft border border-hairline rounded-sm p-4 text-xs font-mono overflow-x-auto">
          {JSON.stringify(data?.rules ?? [], null, 2)}
        </pre>
      )}
    </Card>
  );
}
