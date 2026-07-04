'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function SignOutButton() {
  const router = useRouter();
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleSignOut() {
    setBusy(true);
    setError(false);
    try {
      const res = await fetch('/api/v1/auth/logout', { method: 'POST' });
      if (!res.ok) {
        // Don't route to /login while the session cookie may still be valid —
        // that would look signed-out while access persists (bad on shared machines).
        setError(true);
        setBusy(false);
        return;
      }
    } catch {
      setError(true);
      setBusy(false);
      return;
    }
    router.push('/login');
  }

  return (
    <div className="flex flex-col items-end">
      <button
        type="button"
        onClick={handleSignOut}
        disabled={busy}
        className="text-sm text-on-dark-faint hover:text-on-primary disabled:opacity-60"
      >
        Sign out
      </button>
      {error && (
        <span role="alert" className="text-xs text-on-dark-faint">
          Sign out failed — try again.
        </span>
      )}
    </div>
  );
}
