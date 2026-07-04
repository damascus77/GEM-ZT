import { NetworkSettings } from '@/components/networks/NetworkSettings';
import { MemberTable } from '@/components/members/MemberTable';
import { RoutesEditor } from '@/components/networks/RoutesEditor';
import { DnsEditor } from '@/components/networks/DnsEditor';
import { RulesEditor } from '@/components/networks/RulesEditor';
import { NetworkActions } from '@/components/networks/NetworkActions';

export default async function NetworkDetailPage({
  params,
}: {
  params: Promise<{ nwid: string }>;
}) {
  const { nwid } = await params;
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[28px] wght-540 tracking-[-0.63px]">Network</h1>
        <p className="text-sm text-ink-mute font-mono">{nwid}</p>
      </div>
      <NetworkSettings nwid={nwid} />
      <MemberTable nwid={nwid} />
      <RoutesEditor nwid={nwid} />
      <DnsEditor nwid={nwid} />
      <RulesEditor nwid={nwid} />
      <NetworkActions nwid={nwid} />
    </div>
  );
}
