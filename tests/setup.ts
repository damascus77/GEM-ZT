import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { clearAllCache } from '@/lib/util/cache';

afterEach(() => {
  cleanup();
  // Reset the controller read cache so cached rosters/peers never leak across
  // tests (listMembers is coalesced with a short TTL).
  clearAllCache();
});
