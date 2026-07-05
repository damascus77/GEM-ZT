import { AdminOrgs } from '@/components/AdminOrgs';

export default function AdminPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-[28px] wght-540 tracking-[-0.63px]">Admin</h1>
      <AdminOrgs />
    </div>
  );
}
