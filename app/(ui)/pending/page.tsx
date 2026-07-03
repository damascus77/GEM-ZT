import { PendingMembers } from '@/components/PendingMembers';

export default function PendingPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-[28px] wght-540 tracking-[-0.63px]">Pending</h1>
      <PendingMembers />
    </div>
  );
}
