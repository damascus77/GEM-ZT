import { InviteAccept } from './InviteAccept';

export default async function InviteAcceptPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <InviteAccept token={token} />;
}
