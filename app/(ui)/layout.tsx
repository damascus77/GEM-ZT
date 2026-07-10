import Link from 'next/link';
import { AdminNavLink, StatusNavLink } from '@/components/AdminNavLink';
import { DegradedBanner } from '@/components/DegradedBanner';
import { OrgSwitcher } from '@/components/OrgSwitcher';
import { SignOutButton } from '@/components/SignOutButton';
import { ThemeToggle } from '@/components/ThemeToggle';

const navBefore = [
  { href: '/networks', label: 'Networks' },
  { href: '/pending', label: 'Pending' },
];

const navAfter = [
  { href: '/apikeys', label: 'API Keys' },
  { href: '/audit', label: 'Audit Log' },
  { href: '/docs', label: 'API Docs' },
  { href: '/account', label: 'Account' },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <aside className="flex w-60 shrink-0 flex-col bg-primary text-on-primary">
        <div className="wght-540 px-6 py-5 text-[20px] tracking-[-0.4px]">GEM-ZT</div>
        <nav className="flex flex-col gap-1 px-3">
          {navBefore.map(item => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-3 py-2 text-on-dark-mute hover:bg-primary-deep hover:text-on-primary"
            >
              {item.label}
            </Link>
          ))}
          <StatusNavLink />
          {navAfter.map(item => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-3 py-2 text-on-dark-mute hover:bg-primary-deep hover:text-on-primary"
            >
              {item.label}
            </Link>
          ))}
          <AdminNavLink />
        </nav>
        <div className="mt-auto flex flex-col items-start gap-3 px-6 py-5">
          <OrgSwitcher className="w-full" />
          <ThemeToggle className="text-sm text-on-dark-faint hover:text-on-primary" />
          <SignOutButton />
        </div>
      </aside>
      <div className="flex flex-1 flex-col bg-canvas-soft">
        <DegradedBanner />
        <main className="mx-auto w-full max-w-[1100px] px-6 py-8">{children}</main>
      </div>
    </div>
  );
}
