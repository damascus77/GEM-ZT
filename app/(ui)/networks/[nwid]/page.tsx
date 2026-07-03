import { NetworkSettings } from '@/components/networks/NetworkSettings';
import { MemberTable } from '@/components/members/MemberTable';
import { RoutesEditor } from '@/components/networks/RoutesEditor';
import { DnsEditor } from '@/components/networks/DnsEditor';
import { RulesEditor } from '@/components/networks/RulesEditor';

export default function NetworkDetailPage({ params }: { params: { nwid: string } }) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[28px] wght-540 tracking-[-0.63px]">Network</h1>
        <p className="text-sm text-ink-mute font-mono">{params.nwid}</p>
      </div>
      <NetworkSettings nwid={params.nwid} />
      <MemberTable nwid={params.nwid} />
      <RoutesEditor nwid={params.nwid} />
      <DnsEditor nwid={params.nwid} />
      <RulesEditor nwid={params.nwid} />
    </div>
  );
}
