import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';

vi.mock('@/lib/controller', () => ({
  getControllerClient: vi.fn(),
  getControllerCacheTtlMs: () => 0,
}));

import { getControllerClient } from '@/lib/controller';
import { setupTestDb } from '../helpers/db';
import { getDb } from '@/lib/db/client';
import { listNetworks, listUnassignedNetworks, listNetworksForOrg } from '@/lib/services/networks';

// More ids than the concurrency cap (8) so we can observe the ceiling.
const NETWORK_COUNT = 20;
const CONCURRENCY_CAP = 8;

function makeIds(n: number): string[] {
  return Array.from({ length: n }, (_, i) => i.toString(16).padStart(16, '0'));
}

function makeNet(nwid: string) {
  return {
    id: nwid,
    nwid,
    name: `net-${nwid}`,
    private: true,
    enableBroadcast: true,
    mtu: 2800,
    multicastLimit: 32,
    routes: [],
    ipAssignmentPools: [],
    v4AssignMode: { zt: true },
    v6AssignMode: { zt: false, '6plane': false, rfc4193: false },
    dns: { domain: '', servers: [] },
    rules: [],
    capabilities: [],
    tags: [],
    creationTime: 1,
    revision: 1,
  };
}

// Records the peak number of concurrently in-flight getNetwork calls.
function makeInFlightTracker() {
  let inFlight = 0;
  let maxInFlight = 0;
  return {
    get max() {
      return maxInFlight;
    },
    async run<T>(work: () => T): Promise<T> {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      // Yield across a couple of microtasks so overlapping calls actually pile
      // up before any of them resolves — otherwise each would complete before
      // the next started and the peak would read 1.
      await Promise.resolve();
      await Promise.resolve();
      try {
        return work();
      } finally {
        inFlight--;
      }
    },
  };
}

const mockClient = {
  listNetworkIds: vi.fn(),
  getNetwork: vi.fn(),
  listMemberIds: vi.fn(),
};

let orgId: string;
const ids = makeIds(NETWORK_COUNT);

beforeAll(async () => {
  setupTestDb();
  orgId = 'org-fanout-test';
});

beforeEach(async () => {
  vi.clearAllMocks();
  (getControllerClient as ReturnType<typeof vi.fn>).mockResolvedValue(mockClient);
  mockClient.listNetworkIds.mockResolvedValue(ids);
  mockClient.listMemberIds.mockResolvedValue({});
});

afterAll(async () => {
  await getDb().$disconnect();
});

describe('networks list fan-out concurrency cap', () => {
  it('listNetworks preserves input order and never exceeds the cap of getNetwork calls in flight', async () => {
    const tracker = makeInFlightTracker();
    mockClient.getNetwork.mockImplementation((nwid: string) => tracker.run(() => makeNet(nwid)));

    const summaries = await listNetworks();

    expect(summaries.map(s => s.nwid)).toEqual(ids);
    expect(summaries[0]).toEqual({
      nwid: ids[0],
      name: `net-${ids[0]}`,
      description: '',
      tags: [],
      private: true,
      memberCount: 0,
    });
    expect(tracker.max).toBeGreaterThan(1);
    expect(tracker.max).toBeLessThanOrEqual(CONCURRENCY_CAP);
  });

  it('listUnassignedNetworks preserves order and caps concurrency', async () => {
    const tracker = makeInFlightTracker();
    mockClient.getNetwork.mockImplementation((nwid: string) => tracker.run(() => makeNet(nwid)));

    const summaries = await listUnassignedNetworks();

    expect(summaries.map(s => s.nwid)).toEqual(ids);
    expect(tracker.max).toBeGreaterThan(1);
    expect(tracker.max).toBeLessThanOrEqual(CONCURRENCY_CAP);
  });

  it('listNetworksForOrg preserves order and caps concurrency over owned networks', async () => {
    // Assign every network to the org so all pass the ownership filter.
    for (const nwid of ids) {
      await getDb().networkMeta.upsert({
        where: { nwid },
        create: { nwid, name: `net-${nwid}`, description: '', orgId },
        update: { orgId },
      });
    }
    const tracker = makeInFlightTracker();
    mockClient.getNetwork.mockImplementation((nwid: string) => tracker.run(() => makeNet(nwid)));

    const summaries = await listNetworksForOrg(orgId);

    expect(summaries.map(s => s.nwid)).toEqual(ids);
    expect(tracker.max).toBeGreaterThan(1);
    expect(tracker.max).toBeLessThanOrEqual(CONCURRENCY_CAP);

    await getDb().networkMeta.deleteMany({ where: { orgId } });
  });
});
