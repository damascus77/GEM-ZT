import { OrgMembers } from '@/components/OrgMembers';
import { OrgInvitations } from '@/components/OrgInvitations';

export default async function OrgMembersPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  return (
    <div className="flex flex-col gap-6">
      <h1 className="wght-540 text-[28px] tracking-[-0.63px]">Members</h1>
      <OrgMembers orgId={orgId} />
      <div id="invitations">
        <OrgInvitations orgId={orgId} />
      </div>
    </div>
  );
}
