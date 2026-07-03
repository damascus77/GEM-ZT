'use client';

import { useRouter } from 'next/navigation';

export function SignOutButton() {
  const router = useRouter();

  async function handleSignOut() {
    await fetch('/api/v1/auth/logout', { method: 'POST' });
    router.push('/login');
  }

  return (
    <button
      type="button"
      onClick={handleSignOut}
      className="text-sm text-on-dark-faint hover:text-on-primary"
    >
      Sign out
    </button>
  );
}
