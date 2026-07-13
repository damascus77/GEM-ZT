'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Pill } from '@/components/ui/Pill';
import { useControllerStatus } from '@/components/DegradedBanner';
import {
  filterAndSortMembers,
  type AuthorizedFilter,
  type OnlineFilter,
  type MemberSort,
} from '@/lib/util/memberFilter';
import { timeAgo } from '@/lib/util/timeAgo';

export interface MemberViewClient {
  memberId: string;
  nwid: string;
  name: string;
  notes: string;
  authorized: boolean;
  activeBridge: boolean;
  noAutoAssignIps: boolean;
  ipAssignments: string[];
  lastAuthorizedTime: number;
  online: boolean | null;
  latency: number | null;
  physicalAddress: string | null;
  clientVersion: string | null;
  capabilities: number[];
  tags: [number, number][];
}

export type MembersData = { members: MemberViewClient[] };

export interface RulesMaps {
  capabilities: Record<string, number>;
  tags: Record<string, number>;
}

export interface PresenceEntry {
  lastSeen: string | null;
  samples: boolean[];
}

function TagInput({
  label,
  value,
  disabled,
  onCommit,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onCommit: (value: string) => void;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <input
      type="number"
      className="w-16 rounded-sm border border-hairline bg-canvas px-1 py-0.5 text-xs text-ink"
      value={text}
      disabled={disabled}
      onChange={e => setText(e.target.value)}
      onBlur={() => onCommit(text)}
      aria-label={label}
    />
  );
}

function PresencePill({ online }: { online: boolean | null }) {
  if (online === true) return <Pill className="border-teal-mid text-teal-deep">Online</Pill>;
  if (online === false) return <Pill>Offline</Pill>;
  return <Pill className="text-ink-faint">Unknown</Pill>;
}

function PresenceSparkline({ memberId, samples }: { memberId: string; samples: boolean[] }) {
  return (
    <div className="flex items-end gap-px" aria-label={`Presence history for ${memberId}`}>
      {samples.map((online, i) => (
        <div
          key={i}
          className={`h-3 w-1 rounded-[1px] ${online ? 'bg-teal-mid' : 'bg-ink-faint/30'}`}
        />
      ))}
    </div>
  );
}

function MemberPresenceInfo({
  memberId,
  presence,
}: {
  memberId: string;
  presence?: PresenceEntry;
}) {
  if (!presence) return null;
  return (
    <div className="mt-1 flex flex-col gap-1">
      <span className="whitespace-nowrap text-xs text-ink-faint">
        Last seen: {timeAgo(presence.lastSeen)}
      </span>
      {presence.samples.length > 0 && (
        <PresenceSparkline memberId={memberId} samples={presence.samples} />
      )}
    </div>
  );
}

export function MemberRow({
  member,
  nwid,
  degraded,
  onChanged,
  selected,
  onToggleSelect,
  rulesMaps,
  presence,
}: {
  member: MemberViewClient;
  nwid: string;
  degraded: boolean;
  onChanged: () => void;
  selected?: boolean;
  onToggleSelect?: (memberId: string) => void;
  rulesMaps?: RulesMaps;
  presence?: PresenceEntry;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(member.name);
  useEffect(() => setName(member.name), [member.name]);
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
    // Optimistically merge the change into the cached member so a rapid second
    // edit (e.g. toggling capability B right after A) derives from the updated
    // state rather than stale props and doesn't clobber the first change.
    onMutate: (body: Record<string, unknown>) => {
      const prev = queryClient.getQueryData<MembersData>(['members', nwid]);
      queryClient.setQueryData<MembersData>(['members', nwid], old =>
        old
          ? {
              ...old,
              members: old.members.map(m =>
                m.memberId === member.memberId
                  ? { ...m, ...(body as Partial<MemberViewClient>) }
                  : m
              ),
            }
          : old
      );
      return { prev };
    },
    onError: (_err, _body, context) => {
      if (context?.prev) queryClient.setQueryData(['members', nwid], context.prev);
    },
    onSuccess: onChanged,
  });

  // The freshest member state (optimistic cache write above lands before the
  // next click), so successive capability/tag edits don't compute from a stale
  // render's props.
  function currentMember(): MemberViewClient {
    return (
      queryClient
        .getQueryData<MembersData>(['members', nwid])
        ?.members.find(m => m.memberId === member.memberId) ?? member
    );
  }

  const remove = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/v1/networks/${nwid}/members/${member.memberId}`, {
        method: 'DELETE',
      });
      if (!res.ok && res.status !== 204) {
        // Surface the controller's actual reason instead of a fixed string.
        const parsed = await res.json().catch(() => null);
        throw new Error(parsed?.error?.message ?? 'Delete failed');
      }
    },
    onSuccess: onChanged,
  });

  function confirmRemove() {
    const label = member.name || member.memberId;
    if (window.confirm(`Remove member ${label}? This cannot be undone.`)) {
      remove.mutate();
    }
  }

  const capabilitiesMap = rulesMaps?.capabilities ?? {};
  const tagsMap = rulesMaps?.tags ?? {};
  const hasCapabilities = Object.keys(capabilitiesMap).length > 0;
  const hasTags = Object.keys(tagsMap).length > 0;

  function toggleCapability(id: number, checked: boolean) {
    const caps = currentMember().capabilities;
    const next = checked ? [...caps, id] : caps.filter(c => c !== id);
    patch.mutate({ capabilities: next });
  }

  function setTag(id: number, value: string) {
    const withoutId = currentMember().tags.filter(([tagId]) => tagId !== id);
    const trimmed = value.trim();
    const next: [number, number][] =
      trimmed === '' ? withoutId : [...withoutId, [id, Number(trimmed)]];
    patch.mutate({ tags: next });
  }

  return (
    <>
      <tr className="border-t border-hairline align-top">
        <td className="py-3 pr-2">
          {onToggleSelect && (
            <input
              type="checkbox"
              checked={selected ?? false}
              onChange={() => onToggleSelect(member.memberId)}
              aria-label={`Select member ${member.memberId}`}
            />
          )}
        </td>
        <td className="py-3 pr-4">
          <PresencePill online={member.online} />
          <MemberPresenceInfo memberId={member.memberId} presence={presence} />
        </td>
        <td className="py-3 pr-4">
          <Input
            value={name}
            placeholder="Nickname"
            disabled={degraded || patch.isPending}
            onChange={e => setName(e.target.value)}
            onBlur={() => {
              if (name !== member.name) patch.mutate({ name });
            }}
            className="mt-0 wght-540 text-ink"
            aria-label={`Nickname for ${member.memberId}`}
          />
          <div className="mt-1 font-mono text-xs text-ink-mute">{member.memberId}</div>
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
          <div className="mt-2 flex flex-col gap-1 text-xs text-ink-mute">
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={member.activeBridge}
                disabled={degraded || patch.isPending}
                onChange={e => patch.mutate({ activeBridge: e.target.checked })}
                aria-label={`Active bridge for ${member.memberId}`}
              />
              Bridge
            </label>
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={member.noAutoAssignIps}
                disabled={degraded || patch.isPending}
                onChange={e => patch.mutate({ noAutoAssignIps: e.target.checked })}
                aria-label={`Disable auto-assign IPs for ${member.memberId}`}
              />
              No auto IP
            </label>
          </div>
          {hasCapabilities && (
            <div className="mt-2 flex flex-col gap-1 text-xs text-ink-mute">
              {Object.entries(capabilitiesMap).map(([name, id]) => (
                <label key={id} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={member.capabilities.includes(id)}
                    disabled={degraded || patch.isPending}
                    onChange={e => toggleCapability(id, e.target.checked)}
                    aria-label={`Capability ${name} for ${member.memberId}`}
                  />
                  {name}
                </label>
              ))}
            </div>
          )}
          {hasTags && (
            <div className="mt-2 flex flex-col gap-1 text-xs text-ink-mute">
              {Object.entries(tagsMap).map(([name, id]) => {
                const pair = member.tags.find(([tagId]) => tagId === id);
                return (
                  <label key={id} className="flex items-center gap-1">
                    <TagInput
                      label={`Tag ${name} for ${member.memberId}`}
                      value={pair ? String(pair[1]) : ''}
                      disabled={degraded || patch.isPending}
                      onCommit={value => setTag(id, value)}
                    />
                    {name}
                  </label>
                );
              })}
            </div>
          )}
        </td>
        <td className="min-w-52 py-3 pr-4">
          <div className="flex gap-2">
            <Input
              value={ips}
              onChange={e => {
                setIps(e.target.value);
                setIpsDirty(true);
              }}
              className="mt-0"
              aria-label={`IP assignments for ${member.memberId}`}
            />
            <Button
              variant="outline"
              className="shrink-0 px-3 py-2 text-sm"
              disabled={degraded || patch.isPending}
              onClick={() =>
                patch.mutate(
                  {
                    ipAssignments: ips
                      .split(',')
                      .map(s => s.trim())
                      .filter(s => s !== ''),
                  },
                  // Clear the dirty flag so the input re-syncs to the server's
                  // canonical list once the write lands.
                  { onSuccess: () => setIpsDirty(false) }
                )
              }
            >
              Save IPs
            </Button>
          </div>
        </td>
        <td className="whitespace-nowrap py-3 pr-4 text-sm text-ink-mute">
          {member.latency !== null ? `${member.latency} ms` : '— ms'}
        </td>
        <td className="py-3 pr-4 font-mono text-sm text-ink-mute">
          {member.physicalAddress ?? 'unknown'}
        </td>
        <td className="whitespace-nowrap py-3 pr-4 text-sm text-ink-mute">
          {member.lastAuthorizedTime > 0
            ? new Date(member.lastAuthorizedTime).toLocaleString()
            : 'never'}
        </td>
        <td className="py-3">
          <Button
            variant="outline"
            className="px-3 py-2 text-sm"
            disabled={degraded || remove.isPending}
            onClick={confirmRemove}
          >
            Remove
          </Button>
        </td>
      </tr>
      {(patch.isError || remove.isError) && (
        <tr>
          <td colSpan={9} className="pb-3">
            <p role="alert" className="text-sm text-ink">
              {patch.isError && (patch.error as Error).message}
              {patch.isError && remove.isError && ' '}
              {remove.isError && (remove.error as Error).message}
            </p>
          </td>
        </tr>
      )}
    </>
  );
}

const selectClass =
  'mt-0 bg-canvas text-ink text-sm rounded-sm border border-hairline px-2 py-2 focus:outline-none';

export function MemberTable({ nwid }: { nwid: string }) {
  const queryClient = useQueryClient();
  const controller = useControllerStatus();
  const degraded = controller.data?.degraded ?? false;
  const { data, isLoading, isError } = useQuery<MembersData>({
    queryKey: ['members', nwid],
    queryFn: async () => {
      const res = await fetch(`/api/v1/networks/${nwid}/members`);
      if (!res.ok) throw new Error('Failed to load members');
      return res.json();
    },
    refetchInterval: 10000,
  });

  const { data: rulesData } = useQuery<RulesMaps>({
    queryKey: ['rules', nwid],
    queryFn: async () => {
      const res = await fetch(`/api/v1/networks/${nwid}/rules`);
      if (!res.ok) throw new Error('Failed to load rules');
      return res.json();
    },
  });
  const rulesMaps: RulesMaps = {
    capabilities: rulesData?.capabilities ?? {},
    tags: rulesData?.tags ?? {},
  };

  const { data: presenceData } = useQuery<{ presence: Record<string, PresenceEntry> }>({
    queryKey: ['presence', nwid],
    queryFn: async () => {
      const res = await fetch(`/api/v1/networks/${nwid}/presence`);
      if (!res.ok) throw new Error('Failed to load presence');
      return res.json();
    },
  });
  const presenceMap: Record<string, PresenceEntry> = presenceData?.presence ?? {};

  const [search, setSearch] = useState('');
  const [authFilter, setAuthFilter] = useState<AuthorizedFilter>('all');
  const [onlineFilter, setOnlineFilter] = useState<OnlineFilter>('all');
  // 'default' preserves the controller's ordering; anything else applies a sort.
  const [sort, setSort] = useState<MemberSort | 'default'>('default');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const onChanged = () => queryClient.invalidateQueries({ queryKey: ['members', nwid] });

  const visible = useMemo(
    () =>
      filterAndSortMembers(data?.members ?? [], {
        search,
        authorized: authFilter,
        online: onlineFilter,
        sort: sort === 'default' ? undefined : sort,
        dir: 'asc',
      }),
    [data, search, authFilter, onlineFilter, sort]
  );

  function toggleSelect(memberId: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(memberId)) next.delete(memberId);
      else next.add(memberId);
      return next;
    });
  }

  const bulk = useMutation({
    mutationFn: async (action: 'authorize' | 'deauthorize' | 'delete') => {
      const ids = [...selected];
      for (const id of ids) {
        if (action === 'delete') {
          const res = await fetch(`/api/v1/networks/${nwid}/members/${id}`, { method: 'DELETE' });
          if (!res.ok && res.status !== 204) {
            const parsed = await res.json().catch(() => null);
            throw new Error(parsed?.error?.message ?? `Delete failed for ${id}`);
          }
        } else {
          const res = await fetch(`/api/v1/networks/${nwid}/members/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ authorized: action === 'authorize' }),
          });
          if (!res.ok) {
            const parsed = await res.json().catch(() => null);
            throw new Error(parsed?.error?.message ?? `Update failed for ${id}`);
          }
        }
      }
    },
    onSuccess: () => {
      setSelected(new Set());
      onChanged();
    },
  });

  function runBulk(action: 'authorize' | 'deauthorize' | 'delete') {
    if (action === 'delete' && !window.confirm(`Remove ${selected.size} selected member(s)?`)) {
      return;
    }
    bulk.mutate(action);
  }

  const allVisibleSelected = visible.length > 0 && visible.every(m => selected.has(m.memberId));

  return (
    <Card className="overflow-x-auto">
      <h2 className="wght-540 mb-4 text-[20px] tracking-[-0.4px]">Members</h2>

      {data && data.members.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Input
            placeholder="Search name, ID, or IP"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="mt-0 w-56"
            aria-label="Search members"
          />
          <select
            className={selectClass}
            value={authFilter}
            onChange={e => setAuthFilter(e.target.value as AuthorizedFilter)}
            aria-label="Filter by authorization"
          >
            <option value="all">All</option>
            <option value="authorized">Authorized</option>
            <option value="pending">Pending</option>
          </select>
          <select
            className={selectClass}
            value={onlineFilter}
            onChange={e => setOnlineFilter(e.target.value as OnlineFilter)}
            aria-label="Filter by presence"
          >
            <option value="all">Any status</option>
            <option value="online">Online only</option>
            <option value="offline">Offline only</option>
          </select>
          <select
            className={selectClass}
            value={sort}
            onChange={e => setSort(e.target.value as MemberSort | 'default')}
            aria-label="Sort members"
          >
            <option value="default">Sort: Default</option>
            <option value="name">Sort: Name</option>
            <option value="id">Sort: ID</option>
            <option value="status">Sort: Auth</option>
            <option value="lastAuthorized">Sort: Last authorized</option>
          </select>
          <Button
            variant="outline"
            className="px-3 py-2 text-sm"
            onClick={() =>
              setSelected(new Set(visible.filter(m => m.online === false).map(m => m.memberId)))
            }
          >
            Select offline
          </Button>
        </div>
      )}

      {selected.size > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-sm border border-hairline bg-canvas-soft p-3">
          <span className="text-sm text-ink-mute">{selected.size} selected</span>
          <Button
            className="px-3 py-2 text-sm"
            disabled={degraded || bulk.isPending}
            onClick={() => runBulk('authorize')}
          >
            Authorize selected
          </Button>
          <Button
            variant="outline"
            className="px-3 py-2 text-sm"
            disabled={degraded || bulk.isPending}
            onClick={() => runBulk('deauthorize')}
          >
            Deauthorize selected
          </Button>
          <Button
            variant="outline"
            className="px-3 py-2 text-sm"
            disabled={degraded || bulk.isPending}
            onClick={() => runBulk('delete')}
          >
            Delete selected
          </Button>
          <Button
            variant="outline"
            className="px-3 py-2 text-sm"
            onClick={() => setSelected(new Set())}
          >
            Clear
          </Button>
        </div>
      )}
      {bulk.isError && (
        <p role="alert" className="mb-2 text-sm text-ink">
          {(bulk.error as Error).message}
        </p>
      )}

      {isLoading && <p className="text-ink-mute">Loading…</p>}
      {isError && !data && (
        <p role="alert" className="text-sm text-ink">
          Could not load members. Retrying…
        </p>
      )}
      {data && data.members.length === 0 && (
        <p className="text-ink-mute">
          No members yet. Join this network from a device, then authorize it here.
        </p>
      )}
      {data && data.members.length > 0 && visible.length === 0 && (
        <p className="text-ink-mute">No members match the current filters.</p>
      )}
      {visible.length > 0 && (
        <table className="w-full text-left">
          <thead>
            <tr className="text-xs uppercase text-ink-faint">
              <th className="pb-2 pr-2">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={e =>
                    setSelected(
                      e.target.checked ? new Set(visible.map(m => m.memberId)) : new Set()
                    )
                  }
                  aria-label="Select all members"
                />
              </th>
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
            {visible.map(m => (
              <MemberRow
                key={m.memberId}
                member={m}
                nwid={nwid}
                degraded={degraded}
                onChanged={onChanged}
                selected={selected.has(m.memberId)}
                onToggleSelect={toggleSelect}
                rulesMaps={rulesMaps}
                presence={presenceMap[m.memberId]}
              />
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
