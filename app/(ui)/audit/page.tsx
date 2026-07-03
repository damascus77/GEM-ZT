'use client';

import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/ui/Card';
import { Pill } from '@/components/ui/Pill';

interface AuditEntryRow {
  id: string;
  userId: string;
  username: string;
  action: string;
  targetType: string;
  targetId: string;
  detail: unknown;
  createdAt: string;
}

export default function AuditPage() {
  const { data, isLoading } = useQuery<{ entries: AuditEntryRow[] }>({
    queryKey: ['audit'],
    queryFn: async () => {
      const res = await fetch('/api/v1/audit?limit=200');
      if (!res.ok) throw new Error('Failed to load audit log');
      return res.json();
    },
    refetchInterval: 10000,
  });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-[28px] wght-540 tracking-[-0.63px]">Audit Log</h1>
      <Card className="overflow-x-auto">
        {isLoading && <p className="text-ink-mute">Loading…</p>}
        {data && data.entries.length === 0 && (
          <p className="text-ink-mute">No audit entries yet.</p>
        )}
        {data && data.entries.length > 0 && (
          <table className="w-full text-left">
            <thead>
              <tr className="text-xs text-ink-faint uppercase">
                <th className="pb-2 pr-4">When</th>
                <th className="pb-2 pr-4">Who</th>
                <th className="pb-2 pr-4">Action</th>
                <th className="pb-2 pr-4">Target</th>
                <th className="pb-2">Detail</th>
              </tr>
            </thead>
            <tbody>
              {data.entries.map((e) => (
                <tr key={e.id} className="border-t border-hairline align-top">
                  <td className="py-3 pr-4 text-sm text-ink-mute whitespace-nowrap">
                    {new Date(e.createdAt).toLocaleString()}
                  </td>
                  <td className="py-3 pr-4 text-sm wght-540">{e.username}</td>
                  <td className="py-3 pr-4">
                    <Pill>{e.action}</Pill>
                  </td>
                  <td className="py-3 pr-4 text-sm font-mono text-ink-mute">{e.targetId}</td>
                  <td className="py-3 text-xs font-mono text-ink-mute break-all">
                    {JSON.stringify(e.detail)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
