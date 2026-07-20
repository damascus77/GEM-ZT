import { DegradedBanner } from '@/components/DegradedBanner';
import { EventStream } from '@/components/EventStream';
import { MobileNav } from '@/components/MobileNav';
import { Sidebar } from '@/components/Sidebar';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <EventStream />
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col bg-canvas-soft">
        <MobileNav />
        <DegradedBanner />
        <main className="mx-auto w-full max-w-[1600px] px-4 py-6 md:px-6 md:py-8">{children}</main>
      </div>
    </div>
  );
}
