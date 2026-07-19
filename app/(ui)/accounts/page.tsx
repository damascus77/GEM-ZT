import { AccountManagement } from '@/components/AccountManagement';

export default function AccountsPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="wght-540 text-[28px] tracking-[-0.63px]">Accounts</h1>
      <AccountManagement />
    </div>
  );
}
