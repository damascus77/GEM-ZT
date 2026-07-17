import { NetworkSettings } from '@/components/networks/NetworkSettings';
import { MemberTable } from '@/components/members/MemberTable';
import { RoutesEditor } from '@/components/networks/RoutesEditor';
import { DnsEditor } from '@/components/networks/DnsEditor';
import { RulesEditor } from '@/components/networks/RulesEditor';
import { JoinLinkPanel } from '@/components/networks/JoinLinkPanel';
import { NetworkActions } from '@/components/networks/NetworkActions';

export default async function NetworkDetailPage({ params }: { params: Promise<{ nwid: string }> }) {
  const { nwid } = await params;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="wght-540 text-[28px] tracking-[-0.63px]">Network</h1>
        <p className="font-mono text-sm text-ink-mute">{nwid}</p>
      </div>
      <section
        aria-label="Frequent network controls"
        className="grid items-start gap-5 xl:grid-cols-[minmax(340px,0.9fr)_minmax(520px,1.1fr)]"
      >
        <NetworkSettings nwid={nwid} />
        <RoutesEditor nwid={nwid} />
      </section>
      <MemberTable nwid={nwid} />
      <DnsEditor nwid={nwid} />
      <RulesEditor nwid={nwid} />
      <JoinLinkPanel nwid={nwid} />
      <NetworkActions nwid={nwid} />
    </div>
  );
}
