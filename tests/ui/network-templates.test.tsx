// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

import { renderWithQuery } from '../helpers/render';
import { NetworkTemplates } from '@/components/networks/NetworkTemplates';

afterEach(() => {
  vi.unstubAllGlobals();
  push.mockClear();
});

const templates = [{ id: 't1', name: 'office', createdAt: '2026-07-04T00:00:00.000Z' }];

describe('NetworkTemplates', () => {
  it('lists templates and creates a network from one', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({ network: { nwid: 'abcdef0199999999' } }), {
          status: 201,
        });
      }
      return new Response(JSON.stringify({ templates }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithQuery(<NetworkTemplates />);
    expect(await screen.findByText('office')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /create network/i }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([u, i]) => String(u) === '/api/v1/templates/t1/apply' && i?.method === 'POST'
      );
      expect(call).toBeDefined();
      expect(push).toHaveBeenCalledWith('/networks/abcdef0199999999');
    });
  });
});
