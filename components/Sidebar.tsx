'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { clsx } from 'clsx';
import { Logo } from '@/components/Logo';
import { AdminNavLink, StatusNavLink } from '@/components/AdminNavLink';
import { OrgSwitcher } from '@/components/OrgSwitcher';
import { SignOutButton } from '@/components/SignOutButton';
import { ThemeToggle } from '@/components/ThemeToggle';

interface MeResponse {
  user: { isSuperAdmin: boolean };
  activeOrgId: string | null;
  memberships: { orgId: string; role: string }[];
}

function useMe() {
  return useQuery<MeResponse>({
    queryKey: ['me'],
    queryFn: async () => {
      const res = await fetch('/api/v1/me');
      if (!res.ok) throw new Error('Failed to load account.');
      return res.json();
    },
  });
}

function usePendingCount() {
  const { data } = useQuery<{ pending: unknown[] }>({
    queryKey: ['pending'],
    queryFn: async () => {
      const res = await fetch('/api/v1/pending');
      if (!res.ok) throw new Error('Failed to load pending members');
      return res.json();
    },
    refetchInterval: 10000,
  });
  return data?.pending.length ?? 0;
}

function NavGroup({
  label,
  divider = true,
  className,
  labelClassName,
  children,
}: {
  label: string;
  divider?: boolean;
  className?: string;
  labelClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={clsx(divider && 'border-t border-[#2a2745] pt-3.5', className)}>
      <div
        className={clsx(
          'px-2.5 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em]',
          labelClassName ?? 'text-on-dark-faint'
        )}
      >
        {label}
      </div>
      <div className="flex flex-col gap-px">{children}</div>
    </div>
  );
}

function NavItem({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const active = pathname === href || pathname?.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      className={clsx(
        'flex items-center justify-between gap-2 rounded-[7px] px-2.5 py-2 text-sm no-underline',
        active
          ? 'wght-600 bg-primary-deep text-on-primary'
          : 'text-on-dark-mute hover:bg-primary-deep/60 hover:text-on-primary'
      )}
    >
      {children}
    </Link>
  );
}

function NavTreeChild({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const active = pathname === href || pathname?.startsWith(`${href}/`);
  return (
    <div className="relative ml-[19px] pl-3">
      <div className="absolute bottom-[9px] left-0 top-0 w-px bg-[#39355a]" />
      <div className="absolute left-0 top-[9px] h-px w-3 bg-[#39355a]" />
      <Link
        href={href}
        className={clsx(
          'flex items-center justify-between gap-2 rounded-[7px] px-2.5 py-[7px] text-[13.5px] no-underline',
          active
            ? 'wght-600 bg-primary-deep text-on-primary'
            : 'text-on-dark-mute hover:bg-primary-deep/60 hover:text-on-primary'
        )}
      >
        {children}
      </Link>
    </div>
  );
}

function NavBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="rounded-full bg-hairline-dark px-1.5 py-px text-[11px] text-on-dark-mute">
      {count}
    </span>
  );
}

/**
 * The full sidebar body (brand, nav, controls). Shared by the persistent
 * desktop rail (`Sidebar`) and the mobile drawer (`MobileNav`). The `me` and
 * `pending` queries are React Query-cached, so rendering this in both places
 * is deduplicated to a single request.
 */
export function SidebarContent() {
  const { data: me } = useMe();
  const pendingCount = usePendingCount();

  const isSuperAdmin = Boolean(me?.user.isSuperAdmin);
  const canManageAccounts = Boolean(
    isSuperAdmin || me?.memberships.some(m => m.role === 'owner' || m.role === 'admin')
  );

  return (
    <>
      <div className="wght-600 flex items-center gap-[9px] px-5 py-[18px] text-[19px] tracking-[-0.3px] text-white">
        <Logo />
        GEM-ZT
      </div>

      <nav className="flex flex-1 flex-col gap-[18px] overflow-y-auto px-3 pb-3 pt-1.5">
        <NavGroup label="Workspace" divider={false}>
          <NavItem href="/networks">Networks</NavItem>
          <NavTreeChild href="/pending">
            <span>Pending</span>
            <NavBadge count={pendingCount} />
          </NavTreeChild>
          <NavItem href="/apikeys">API Keys</NavItem>
          <NavItem href="/audit">Audit Log</NavItem>
          <NavItem href="/docs">API Docs</NavItem>
          <NavItem href="/account">My Account</NavItem>
        </NavGroup>

        {canManageAccounts && (
          <NavGroup label="Account Management">
            <NavItem href="/accounts">Accounts</NavItem>
            <NavTreeChild href="/accounts#invitations">Invitations</NavTreeChild>
          </NavGroup>
        )}

        {isSuperAdmin && (
          <NavGroup
            label="Instance Admin"
            className="-mx-1 rounded-r-[8px] border-l-2 border-l-teal-mid bg-[rgba(14,48,48,0.16)] px-1 pb-1.5"
            labelClassName="text-[#5bd6c4]"
          >
            <StatusNavLink />
            <AdminNavLink />
          </NavGroup>
        )}
      </nav>

      <div
        role="group"
        aria-label="Sidebar controls"
        className="mt-auto flex flex-col gap-3 border-t border-[#2a2745] px-5 py-[18px]"
      >
        <OrgSwitcher />
        <ThemeToggle className="text-left text-sm text-on-dark-mute hover:text-on-primary" />
        <SignOutButton />
      </div>
    </>
  );
}

/** Persistent left rail — visible at md and up; hidden on mobile (see MobileNav). */
export function Sidebar() {
  return (
    <aside className="hidden w-[272px] shrink-0 flex-col bg-primary text-on-primary md:flex">
      <SidebarContent />
    </aside>
  );
}
