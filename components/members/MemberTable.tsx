'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Pill } from '@/components/ui/Pill';
import { useControllerStatus } from '@/components/DegradedBanner';

export interface MemberViewClient {
  memberId: string;
  nwid: string;
  name: string;
  notes: string;
  authorized: boolean;
  activeBridge: boolean;
  ipAssignments: string[];
  lastAuthorizedTime: number;
  online: boolean | null;
  latency: number | null;
  physicalAddress: string | null;
  clientVersion: string | null;
}

function PresencePill({ online }: { online: boolean | null }) {
  if (online === true) return <Pill className="border-teal-mid text-teal-deep">Online</Pill>;
  if (online === false) return <Pill>Offline</Pill>;
  return <Pill className="text-ink-faint">Unknown</Pill>;
}

export function MemberRow({
  member,
  nwid,
  degraded,
  onChanged,
}: {
  member: MemberViewClient;
  nwid: string;
  degraded: boolean;
  onChanged: () => void;
}) {
  const serverIps = member.ipAssignments.join(', ');
  const [ips, setIps] = useState(serverIps);
  // Re-seed from the server (e.g. the controller auto-assigns an IP after
  // authorization) UNLESS the operator is mid-edit. Without this, a stale input
  // seeded before auto-assignment would wipe the live IP on the next "Save IPs".
  const [ipsDirty, setIpsDirty] = useState(false);
  useEffect(() => {
    if (!ipsDirty) setIps(serverIps);
  }, [serverIps, ipsDirty]);

  const patch = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch(`/api/v1/networks/${nwid}/members/${member.memberId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const parsed = await res.json().catch(() => null);
        throw new Error(parsed?.error?.message ?? 'Update failed');
      }
      return res.json();
    },
    onSuccess: onChanged,
  });

  const remove = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/v1/networks/${nwid}/members/${member.memberId}`, {
        method: 'DELETE',
      });
      if (!res.ok && res.status !== 204) throw new Error('Delete failed');
    },
    onSuccess: onChanged,
  });

  return (
    <tr className="border-t border-hairline align-top">
      <td className="py-3 pr-4">
        <PresencePill online={member.online} />
      </td>
      <td className="py-3 pr-4">
        <div className="text-ink wght-540">{member.name || '—'}</div>
        <div className="text-xs text-ink-mute font-mono">{member.memberId}</div>
      </td>
      <td className="py-3 pr-4">
        <Button
          variant={member.authorized ? 'outline' : 'primary'}
          className="px-3 py-2 text-sm"
          disabled={degraded || patch.isPending}
          onClick={() => patch.mutate({ authorized: !member.authorized })}
        >
          {member.authorized ? 'Deauthorize' : 'Authorize'}
        </Button>
      </td>
      <td className="py-3 pr-4 min-w-52">
        <div className="flex gap-2">
          <Input
            value={ips}
            onChange={(e) => {
              setIps(e.target.value);
              setIpsDirty(true);
            }}
            className="mt-0"
            aria-label={`IP assignments for ${member.memberId}`}
          />
          <Button
            variant="outline"
            className="px-3 py-2 text-sm shrink-0"
            disabled={degraded || patch.isPending}
            onClick={() =>
              patch.mutate(
                {
                  ipAssignments: ips
                    .split(',')
                    .map((s) => s.trim())
                    .filter((s) => s !== ''),
                },
                // Clear the dirty flag so the input re-syncs to the server's
                // canonical list once the write lands.
                { onSuccess: () => setIpsDirty(false) },
              )
            }
          >
            Save IPs
          </Button>
        </div>
      </td>
      <td className="py-3 pr-4 text-sm text-ink-mute whitespace-nowrap">
        {member.latency !== null ? `${member.latency} ms` : '— ms'}
      </td>
      <td className="py-3 pr-4 text-sm text-ink-mute font-mono">
        {member.physicalAddress ?? 'unknown'}
      </td>
      <td className="py-3 pr-4 text-sm text-ink-mute whitespace-nowrap">
        {member.lastAuthorizedTime > 0
          ? new Date(member.lastAuthorizedTime).toLocaleString()
          : 'never'}
      </td>
      <td className="py-3">
        <Button
          variant="outline"
          className="px-3 py-2 text-sm"
          disabled={degraded || remove.isPending}
          onClick={() => remove.mutate()}
        >
          Remove
        </Button>
      </td>
    </tr>
  );
}

export function MemberTable({ nwid }: { nwid: string }) {
  const queryClient = useQueryClient();
  const controller = useControllerStatus();
  const degraded = controller.data?.degraded ?? false;
  const { data, isLoading } = useQuery<{ members: MemberViewClient[] }>({
    queryKey: ['members', nwid],
    queryFn: async () => {
      const res = await fetch(`/api/v1/networks/${nwid}/members`);
      if (!res.ok) throw new Error('Failed to load members');
      return res.json();
    },
    refetchInterval: 5000,
  });

  const onChanged = () => queryClient.invalidateQueries({ queryKey: ['members', nwid] });

  return (
    <Card className="overflow-x-auto">
      <h2 className="text-[20px] wght-540 tracking-[-0.4px] mb-4">Members</h2>
      {isLoading && <p className="text-ink-mute">Loading…</p>}
      {data && data.members.length === 0 && (
        <p className="text-ink-mute">
          No members yet. Join this network from a device, then authorize it here.
        </p>
      )}
      {data && data.members.length > 0 && (
        <table className="w-full text-left">
          <thead>
            <tr className="text-xs text-ink-faint uppercase">
              <th className="pb-2 pr-4">Status</th>
              <th className="pb-2 pr-4">Member</th>
              <th className="pb-2 pr-4">Auth</th>
              <th className="pb-2 pr-4">Managed IPs</th>
              <th className="pb-2 pr-4">Latency</th>
              <th className="pb-2 pr-4">Physical address</th>
              <th className="pb-2 pr-4">Last authorized</th>
              <th className="pb-2">&nbsp;</th>
            </tr>
          </thead>
          <tbody>
            {data.members.map((m) => (
              <MemberRow
                key={m.memberId}
                member={m}
                nwid={nwid}
                degraded={degraded}
                onChanged={onChanged}
              />
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
