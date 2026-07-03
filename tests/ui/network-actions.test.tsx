// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

import { renderWithQuery } from '../helpers/render';
import { NetworkActions } from '@/components/networks/NetworkActions';

const NWID = 'abcdef0123456789';

afterEach(() => {
  vi.unstubAllGlobals();
  push.mockClear();
});

describe('NetworkActions', () => {
  it('clones the network and navigates to the new one', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify({ network: { nwid: 'abcdef0199999999' } }), { status: 201 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderWithQuery(<NetworkActions nwid={NWID} />);
    await userEvent.click(screen.getByRole('button', { name: /clone network/i }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([u, i]) => String(u).endsWith('/clone') && i?.method === 'POST');
      expect(call).toBeDefined();
      expect(push).toHaveBeenCalledWith('/networks/abcdef0199999999');
    });
  });

  it('requires typing the network id before delete is enabled, then DELETEs and navigates home', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    renderWithQuery(<NetworkActions nwid={NWID} />);

    const del = screen.getByRole('button', { name: /delete network/i });
    expect(del).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/confirm network id/i), NWID);
    expect(del).toBeEnabled();
    await userEvent.click(del);

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([u, i]) => i?.method === 'DELETE');
      expect(call).toBeDefined();
      expect(call![0]).toBe(`/api/v1/networks/${NWID}`);
      expect(push).toHaveBeenCalledWith('/networks');
    });
  });
});
