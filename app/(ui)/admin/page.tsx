import { AdminOrgs } from '@/components/AdminOrgs';

export default function AdminPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="wght-540 text-[28px] tracking-[-0.63px]">Admin</h1>
      <AdminOrgs />
    </div>
  );
}
