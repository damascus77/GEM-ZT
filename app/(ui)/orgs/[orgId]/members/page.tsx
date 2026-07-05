import { OrgMembers } from '@/components/OrgMembers';
import { OrgInvitations } from '@/components/OrgInvitations';

export default async function OrgMembersPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-[28px] wght-540 tracking-[-0.63px]">Members</h1>
      <OrgMembers orgId={orgId} />
      <OrgInvitations orgId={orgId} />
    </div>
  );
}
