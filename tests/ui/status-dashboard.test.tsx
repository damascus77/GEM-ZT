// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithQuery } from '../helpers/render';
import { StatusDashboard } from '@/components/StatusDashboard';

afterEach(() => {
  vi.unstubAllGlobals();
});

const metricsText = [
  '# HELP gemzt_controller_reachable x',
  '# TYPE gemzt_controller_reachable gauge',
  'gemzt_controller_reachable 1',
  'gemzt_networks_total 4',
  'gemzt_members_total 9',
  'gemzt_members_authorized 6',
  'gemzt_members_online 5',
  '',
].join('\n');

describe('StatusDashboard', () => {
  it('renders inventory counts parsed from /api/v1/metrics', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(metricsText, { status: 200 })),
    );
    renderWithQuery(<StatusDashboard />);
    expect(await screen.findByText('Reachable')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('9')).toBeInTheDocument();
    expect(screen.getByText('6')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('shows the controller as Unreachable when the gauge is 0', async () => {
    const down = metricsText.replace('gemzt_controller_reachable 1', 'gemzt_controller_reachable 0');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(down, { status: 200 })),
    );
    renderWithQuery(<StatusDashboard />);
    expect(await screen.findByText('Unreachable')).toBeInTheDocument();
  });
});
