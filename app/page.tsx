'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function RootRedirect() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const setup = await fetch('/api/v1/setup/status');
        const { needsSetup } = await setup.json();
        if (cancelled) return;
        if (needsSetup) {
          router.replace('/setup');
          return;
        }
        const me = await fetch('/api/v1/me');
        if (cancelled) return;
        router.replace(me.ok ? '/networks' : '/login');
      } catch {
        if (cancelled) return;
        router.replace('/login');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return <p className="p-8 text-ink-mute">Loading…</p>;
}
