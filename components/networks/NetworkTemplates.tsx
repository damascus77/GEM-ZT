'use client';

import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

interface TemplateRow {
  id: string;
  name: string;
  createdAt: string;
}

export function NetworkTemplates() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data } = useQuery<{ templates: TemplateRow[] }>({
    queryKey: ['templates'],
    queryFn: async () => {
      const res = await fetch('/api/v1/templates');
      if (!res.ok) throw new Error('Failed to load templates');
      return res.json();
    },
  });

  const apply = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/v1/templates/${id}/apply`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? 'Create from template failed');
      }
      return res.json() as Promise<{ network: { nwid: string } }>;
    },
    onSuccess: body => {
      queryClient.invalidateQueries({ queryKey: ['networks'] });
      router.push(`/networks/${body.network.nwid}`);
    },
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/v1/templates/${id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) throw new Error('Delete failed');
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['templates'] }),
  });

  if (!data || data.templates.length === 0) return null;

  return (
    <Card>
      <h2 className="wght-540 mb-4 text-[20px] tracking-[-0.4px]">Templates</h2>
      <ul className="flex flex-col gap-2">
        {data.templates.map(t => (
          <li key={t.id} className="flex items-center justify-between gap-4">
            <span className="wght-540">{t.name}</span>
            <div className="flex shrink-0 gap-2">
              <Button
                className="px-3 py-2 text-sm"
                disabled={apply.isPending}
                onClick={() => apply.mutate(t.id)}
              >
                Create network
              </Button>
              <Button
                variant="destructive"
                className="px-3 py-2 text-sm"
                disabled={remove.isPending}
                onClick={() => remove.mutate(t.id)}
              >
                Delete
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {apply.isError && (
        <p role="alert" className="mt-2 text-sm text-ink">
          {(apply.error as Error).message}
        </p>
      )}
    </Card>
  );
}
