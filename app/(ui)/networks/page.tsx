import { BackupControls } from '@/components/BackupControls';
import { NetworkList } from '@/components/networks/NetworkList';
import { NetworkTemplates } from '@/components/networks/NetworkTemplates';

export default function NetworksPage() {
  return (
    <div className="flex flex-col gap-6">
      <NetworkList />
      <NetworkTemplates />
      <BackupControls />
    </div>
  );
}
