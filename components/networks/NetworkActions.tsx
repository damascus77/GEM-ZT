'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';

export function NetworkActions({ nwid }: { nwid: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [confirmText, setConfirmText] = useState('');

  const clone = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/v1/networks/${nwid}/clone`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? 'Clone failed');
      }
      return res.json() as Promise<{ network: { nwid: string } }>;
    },
    onSuccess: body => {
      queryClient.invalidateQueries({ queryKey: ['networks'] });
      router.push(`/networks/${body.network.nwid}`);
    },
  });

  const [templateName, setTemplateName] = useState('');
  const saveTemplate = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/v1/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nwid, name: templateName.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? 'Save template failed');
      }
      return res.json();
    },
    onSuccess: () => {
      setTemplateName('');
      queryClient.invalidateQueries({ queryKey: ['templates'] });
    },
  });

  const remove = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/v1/networks/${nwid}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? 'Delete failed');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['networks'] });
      router.push('/networks');
    },
  });

  return (
    <Card>
      <h2 className="wght-540 mb-4 text-[20px] tracking-[-0.4px]">Actions</h2>

      <Link href={`/networks/${nwid}/join`}>
        <Button variant="outline">Join instructions</Button>
      </Link>

      <Button className="ml-2" onClick={() => clone.mutate()} disabled={clone.isPending}>
        Clone network
      </Button>
      {clone.isError && (
        <p role="alert" className="mt-2 text-sm text-ink">
          {(clone.error as Error).message}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Input
          value={templateName}
          onChange={e => setTemplateName(e.target.value)}
          className="mt-0 w-56"
          placeholder="Template name"
          aria-label="Template name"
        />
        <Button
          variant="outline"
          className="shrink-0"
          disabled={templateName.trim() === '' || saveTemplate.isPending}
          onClick={() => saveTemplate.mutate()}
        >
          Save as template
        </Button>
      </div>
      {saveTemplate.isError && (
        <p role="alert" className="mt-2 text-sm text-ink">
          {(saveTemplate.error as Error).message}
        </p>
      )}
      {saveTemplate.isSuccess && (
        <p role="status" className="mt-2 text-sm text-ink-mute">
          Saved as template.
        </p>
      )}

      <div className="mt-6 border-t border-hairline pt-6">
        <h3 className="wght-600 mb-1 text-sm text-ink">Danger zone</h3>
        <p className="mb-2 text-sm text-ink-mute">
          Deleting a network removes it from the controller and orphans every joined device. This
          cannot be undone. Type the network ID <code className="font-mono text-ink">{nwid}</code>{' '}
          to confirm.
        </p>
        <div className="flex items-center gap-2">
          <Input
            value={confirmText}
            onChange={e => setConfirmText(e.target.value)}
            className="mt-0 w-56 font-mono"
            aria-label="Confirm network id to delete"
            placeholder={nwid}
          />
          <Button
            variant="outline"
            className="shrink-0"
            disabled={confirmText !== nwid || remove.isPending}
            onClick={() => remove.mutate()}
          >
            Delete network
          </Button>
        </div>
        {remove.isError && (
          <p role="alert" className="mt-2 text-sm text-ink">
            {(remove.error as Error).message}
          </p>
        )}
      </div>
    </Card>
  );
}
