'use client';

import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/ui/Card';
import { Pill } from '@/components/ui/Pill';

interface Operation {
  tags?: string[];
  summary?: string;
}

interface Spec {
  info: { title: string; version: string; description?: string };
  paths: Record<string, Record<string, Operation>>;
}

const METHOD_ORDER = ['get', 'post', 'put', 'patch', 'delete'] as const;

export default function DocsPage() {
  const { data, isError } = useQuery<Spec>({
    queryKey: ['openapi'],
    queryFn: async () => {
      const res = await fetch('/api/v1/openapi.json');
      if (!res.ok) throw new Error('Failed to load OpenAPI spec');
      return res.json();
    },
  });

  if (isError && !data)
    return (
      <p role="alert" className="text-sm text-ink">
        Could not load API docs. Refresh to retry.
      </p>
    );
  if (!data) return <p className="text-ink-mute">Loading…</p>;

  const groups = new Map<string, Array<{ methods: string[]; path: string; summary: string }>>();
  for (const [path, ops] of Object.entries(data.paths)) {
    const byTag = new Map<string, { methods: string[]; summary: string }>();
    for (const method of METHOD_ORDER) {
      const op = ops[method];
      if (!op) continue;
      const tag = op.tags?.[0] ?? 'other';
      const entry = byTag.get(tag) ?? { methods: [], summary: op.summary ?? '' };
      entry.methods.push(method);
      byTag.set(tag, entry);
    }
    for (const [tag, { methods, summary }] of byTag) {
      if (!groups.has(tag)) groups.set(tag, []);
      groups.get(tag)!.push({ methods, path, summary });
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="wght-540 text-[28px] tracking-[-0.63px]">
          {data.info.title} <span className="text-ink-faint">v{data.info.version}</span>
        </h1>
        {data.info.description && (
          <p className="mt-2 max-w-2xl text-sm text-ink-mute">{data.info.description}</p>
        )}
        <p className="mt-2 text-sm text-ink-mute">
          Raw spec:{' '}
          <a href="/api/v1/openapi.json" className="underline">
            /api/v1/openapi.json
          </a>
        </p>
      </div>
      {[...groups.entries()].map(([tag, ops]) => (
        <Card key={tag}>
          <h2 className="wght-540 mb-4 text-[20px] capitalize tracking-[-0.4px]">{tag}</h2>
          <div className="flex flex-col gap-3">
            {ops.map(op => (
              <div key={op.path} className="flex items-start gap-3">
                <div className="flex w-32 shrink-0 flex-wrap gap-1">
                  {op.methods.map(method => (
                    <Pill key={method} className="wght-600 justify-center">
                      {method.toUpperCase()}
                    </Pill>
                  ))}
                </div>
                <div>
                  <div className="font-mono text-sm">{op.path}</div>
                  <div className="text-sm text-ink-mute">{op.summary}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}
