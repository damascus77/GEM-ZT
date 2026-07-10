import { NetworkSettings } from '@/components/networks/NetworkSettings';
import { MemberTable } from '@/components/members/MemberTable';
import { RoutesEditor } from '@/components/networks/RoutesEditor';
import { DnsEditor } from '@/components/networks/DnsEditor';
import { RulesEditor } from '@/components/networks/RulesEditor';
import { NetworkActions } from '@/components/networks/NetworkActions';

export default async function NetworkDetailPage({ params }: { params: Promise<{ nwid: string }> }) {
  const { nwid } = await params;
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="wght-540 text-[28px] tracking-[-0.63px]">Network</h1>
        <p className="font-mono text-sm text-ink-mute">{nwid}</p>
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
