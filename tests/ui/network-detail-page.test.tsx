// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import NetworkDetailPage from '@/app/(ui)/networks/[nwid]/page';

vi.mock('@/components/networks/NetworkSettings', () => ({
  NetworkSettings: () => <section aria-label="Settings">Settings panel</section>,
}));

vi.mock('@/components/members/MemberTable', () => ({
  MemberTable: () => <section aria-label="Members">Members panel</section>,
}));

vi.mock('@/components/networks/RoutesEditor', () => ({
  RoutesEditor: () => <section aria-label="Routes & IP pools">Routes panel</section>,
}));

vi.mock('@/components/networks/DnsEditor', () => ({
  DnsEditor: () => <section aria-label="DNS">DNS panel</section>,
}));

vi.mock('@/components/networks/RulesEditor', () => ({
  RulesEditor: () => <section aria-label="Flow rules">Flow rules panel</section>,
}));

vi.mock('@/components/networks/JoinLinkPanel', () => ({
  JoinLinkPanel: () => <section aria-label="Join link">Join link panel</section>,
}));

vi.mock('@/components/networks/NetworkActions', () => ({
  NetworkActions: () => <section aria-label="Actions">Actions panel</section>,
}));

describe('NetworkDetailPage', () => {
  it('puts settings and routes in the compact top area, members next, and low-use sections last', async () => {
    const ui = await NetworkDetailPage({ params: Promise.resolve({ nwid: 'abcdef0123456789' }) });
    const { container } = render(ui);

    const topGrid = screen.getByLabelText('Frequent network controls');
    expect(topGrid).toHaveTextContent('Settings panel');
    expect(topGrid).toHaveTextContent('Routes panel');

    const text = container.textContent ?? '';
    expect(text.indexOf('Settings panel')).toBeLessThan(text.indexOf('Members panel'));
    expect(text.indexOf('Routes panel')).toBeLessThan(text.indexOf('Members panel'));
    expect(text.indexOf('Members panel')).toBeLessThan(text.indexOf('DNS panel'));
    expect(text.indexOf('DNS panel')).toBeLessThan(text.indexOf('Flow rules panel'));
    expect(text.indexOf('Flow rules panel')).toBeLessThan(text.indexOf('Join link panel'));
    expect(text.indexOf('Join link panel')).toBeLessThan(text.indexOf('Actions panel'));
  });
});
