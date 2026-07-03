import { describe, it, expect } from 'vitest';
import { formatMetrics } from '@/lib/services/metrics';

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
