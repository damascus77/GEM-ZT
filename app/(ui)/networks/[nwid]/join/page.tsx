import Link from 'next/link';
import { JoinInstructions } from '@/components/networks/JoinInstructions';

export default async function JoinNetworkPage({ params }: { params: Promise<{ nwid: string }> }) {
  const { nwid } = await params;
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="wght-540 text-[28px] tracking-[-0.63px]">Join network</h1>
        <p className="mt-1 font-mono text-sm text-ink-mute">{nwid}</p>
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

      <JoinInstructions nwid={nwid} />

      <p className="text-sm text-ink-mute">
        After joining, an admin must authorize the device on the{' '}
        <Link href={`/networks/${nwid}`} className="text-primary underline">
          network page
        </Link>{' '}
        before it can communicate.
      </p>
    </div>
  );
}
