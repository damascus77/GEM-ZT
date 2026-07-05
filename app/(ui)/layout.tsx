import Link from 'next/link';
import { DegradedBanner } from '@/components/DegradedBanner';
import { OrgSwitcher } from '@/components/OrgSwitcher';
import { SignOutButton } from '@/components/SignOutButton';
import { ThemeToggle } from '@/components/ThemeToggle';

const nav = [
  { href: '/networks', label: 'Networks' },
  { href: '/pending', label: 'Pending' },
  { href: '/status', label: 'Status' },
  { href: '/apikeys', label: 'API Keys' },
  { href: '/audit', label: 'Audit Log' },
  { href: '/docs', label: 'API Docs' },
  { href: '/account', label: 'Account' },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex">
      <aside className="w-60 shrink-0 bg-primary text-on-primary flex flex-col">
        <div className="px-6 py-5 text-[20px] wght-540 tracking-[-0.4px]">GEM-ZT</div>
        <nav className="flex flex-col gap-1 px-3">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-3 py-2 text-on-dark-mute hover:text-on-primary hover:bg-primary-deep"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto px-6 py-5 flex flex-col gap-3 items-start">
          <OrgSwitcher className="w-full" />
          <ThemeToggle className="text-sm text-on-dark-faint hover:text-on-primary" />
          <SignOutButton />
        </div>
      </aside>
      <div className="flex-1 flex flex-col bg-canvas-soft">
        <DegradedBanner />
        <main className="max-w-[1100px] w-full mx-auto px-6 py-8">{children}</main>
      </div>
    </div>
  );
}
