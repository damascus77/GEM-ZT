import { PendingMembers } from '@/components/PendingMembers';

export default function PendingPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="wght-540 text-[28px] tracking-[-0.63px]">Pending</h1>
      <PendingMembers />
    </div>
  );
}
