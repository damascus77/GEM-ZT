import { DegradedBanner } from '@/components/DegradedBanner';
import { Sidebar } from '@/components/Sidebar';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex flex-1 flex-col bg-canvas-soft">
        <DegradedBanner />
        <main className="mx-auto w-full max-w-[1100px] px-6 py-8">{children}</main>
      </div>
    </div>
  );
}
