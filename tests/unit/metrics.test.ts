import { describe, it, expect, beforeEach, vi } from 'vitest';

const controllerMock = vi.hoisted(() => ({ cacheTtlMs: 1000 }));

vi.mock('@/lib/controller', () => ({
  getControllerClient: vi.fn(),
  getControllerCacheTtlMs: () => controllerMock.cacheTtlMs,
}));

vi.mock('@/lib/services/members', () => ({
  listMembers: vi.fn(),
}));

import { getControllerClient } from '@/lib/controller';
import { ControllerUnreachableError } from '@/lib/controller/client';
import { listMembers } from '@/lib/services/members';
import { clearAllCache } from '@/lib/util/cache';
import { collectMetrics, formatMetrics } from '@/lib/services/metrics';

const mockClient = {
  listNetworkIds: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  clearAllCache();
  controllerMock.cacheTtlMs = 1000;
  (getControllerClient as ReturnType<typeof vi.fn>).mockResolvedValue(mockClient);
  mockClient.listNetworkIds.mockResolvedValue(['net-a', 'net-b']);
  (listMembers as ReturnType<typeof vi.fn>).mockImplementation(async (nwid: string) =>
    nwid === 'net-a'
      ? [
          { authorized: true, online: true },
          { authorized: false, online: null },
        ]
      : [
          { authorized: true, online: false },
          { authorized: true, online: true },
        ]
  );
});

describe('formatMetrics', () => {
  it('renders Prometheus text exposition with HELP/TYPE and values', () => {
    const out = formatMetrics({
      controllerReachable: true,
      networks: 2,
      members: 5,
      authorizedMembers: 3,
      onlineMembers: 4,
    });
    expect(out).toMatch(/# HELP gemzt_controller_reachable/);
    expect(out).toMatch(/# TYPE gemzt_controller_reachable gauge/);
    expect(out).toMatch(/^gemzt_controller_reachable 1$/m);
    expect(out).toMatch(/^gemzt_networks_total 2$/m);
    expect(out).toMatch(/^gemzt_members_total 5$/m);
    expect(out).toMatch(/^gemzt_members_authorized 3$/m);
    expect(out).toMatch(/^gemzt_members_online 4$/m);
    // Every metric line must be preceded by HELP+TYPE and end with a trailing newline.
    expect(out.endsWith('\n')).toBe(true);
  });

  it('reports controller_reachable 0 and zeroed counts when the controller is down', () => {
    const out = formatMetrics({
      controllerReachable: false,
      networks: 0,
      members: 0,
      authorizedMembers: 0,
      onlineMembers: 0,
    });
    expect(out).toMatch(/^gemzt_controller_reachable 0$/m);
    expect(out).toMatch(/^gemzt_networks_total 0$/m);
  });
});

describe('collectMetrics', () => {
  it('counts networks, members, authorized members, and online members from listMembers', async () => {
    await expect(collectMetrics()).resolves.toEqual({
      controllerReachable: true,
      networks: 2,
      members: 4,
      authorizedMembers: 3,
      onlineMembers: 2,
    });
    expect(listMembers).toHaveBeenCalledWith('net-a');
    expect(listMembers).toHaveBeenCalledWith('net-b');
  });

  it('returns a zeroed snapshot when the controller is unreachable', async () => {
    (getControllerClient as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new ControllerUnreachableError('controller down')
    );

    await expect(collectMetrics()).resolves.toEqual({
      controllerReachable: false,
      networks: 0,
      members: 0,
      authorizedMembers: 0,
      onlineMembers: 0,
    });
  });

  it('coalesces repeated snapshots within the controller cache TTL', async () => {
    await collectMetrics();
    await collectMetrics();

    expect(mockClient.listNetworkIds).toHaveBeenCalledTimes(1);
    expect(listMembers).toHaveBeenCalledTimes(2);
  });
});
