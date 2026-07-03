import Link from 'next/link';
import { JoinInstructions } from '@/components/networks/JoinInstructions';

export default function JoinNetworkPage({ params }: { params: { nwid: string } }) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[28px] wght-540 tracking-[-0.63px]">Join network</h1>
        <p className="text-sm text-ink-mute font-mono mt-1">{params.nwid}</p>
      </div>

      <p className="text-sm text-ink-mute">
        Install ZeroTier on the device you want to join, then run the command for your platform
        below.{' '}
        <a
          href="https://www.zerotier.com/download/"
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline"
        >
          Download ZeroTier
        </a>
      </p>

      <JoinInstructions nwid={params.nwid} />

      <p className="text-sm text-ink-mute">
        After joining, an admin must authorize the device on the{' '}
        <Link href={`/networks/${params.nwid}`} className="text-primary underline">
          network page
        </Link>{' '}
        before it can communicate.
      </p>
    </div>
  );
}
