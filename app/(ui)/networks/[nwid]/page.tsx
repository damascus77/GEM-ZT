import { NetworkSettings } from '@/components/networks/NetworkSettings';
import { MemberTable } from '@/components/members/MemberTable';

export default function NetworkDetailPage({ params }: { params: { nwid: string } }) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[28px] wght-540 tracking-[-0.63px]">Network</h1>
        <p className="text-sm text-ink-mute font-mono">{params.nwid}</p>
      </div>
      <NetworkSettings nwid={params.nwid} />
      <MemberTable nwid={params.nwid} />
    </div>
  );
}
