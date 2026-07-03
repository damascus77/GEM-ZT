import { describe, it, expect } from 'vitest';
import { parsePrometheusMetrics } from '@/lib/util/parseMetrics';

describe('parsePrometheusMetrics', () => {
  it('parses simple name value pairs and skips HELP/TYPE comments', () => {
    const text = [
      '# HELP gemzt_controller_reachable Whether the controller responded.',
      '# TYPE gemzt_controller_reachable gauge',
      'gemzt_controller_reachable 1',
      '# HELP gemzt_networks_total Number of networks.',
      '# TYPE gemzt_networks_total gauge',
      'gemzt_networks_total 4',
      '',
    ].join('\n');
    expect(parsePrometheusMetrics(text)).toEqual({
      gemzt_controller_reachable: 1,
      gemzt_networks_total: 4,
    });
  });

  it('ignores blank lines and malformed rows', () => {
    const text = 'gemzt_members_total 7\n\nnot-a-metric\ngemzt_members_online notanumber\n';
    expect(parsePrometheusMetrics(text)).toEqual({ gemzt_members_total: 7 });
  });
});
