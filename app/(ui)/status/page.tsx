import { StatusDashboard } from '@/components/StatusDashboard';

export default function StatusPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="wght-540 text-[28px] tracking-[-0.63px]">Status</h1>
      <StatusDashboard />
    </div>
  );
}
