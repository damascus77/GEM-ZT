'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';

interface MeResponse {
  user: { isSuperAdmin: boolean };
}

function useIsSuperAdmin() {
  const { data } = useQuery<MeResponse>({
    queryKey: ['me'],
    queryFn: async () => {
      const res = await fetch('/api/v1/me');
      if (!res.ok) throw new Error('Failed to load account.');
      return res.json();
    },
  });
  return Boolean(data?.user.isSuperAdmin);
}

export function AdminNavLink() {
  if (!useIsSuperAdmin()) return null;

  return (
    <Link
      href="/admin"
      className="rounded-md px-3 py-2 text-on-dark-mute hover:bg-primary-deep hover:text-on-primary"
    >
      Admin
    </Link>
  );
}

export function StatusNavLink() {
  if (!useIsSuperAdmin()) return null;

  return (
    <Link
      href="/status"
      className="rounded-md px-3 py-2 text-on-dark-mute hover:bg-primary-deep hover:text-on-primary"
    >
      Status
    </Link>
  );
}
