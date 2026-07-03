// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '../helpers/render';
import ApiKeysPage from '@/app/(ui)/apikeys/page';

afterEach(() => {
  vi.unstubAllGlobals();
});

const keys = [
  {
    id: 'k1',
    name: 'ci',
    prefix: 'ztk_abcd1234',
    lastUsedAt: null,
    createdAt: '2026-07-02T00:00:00.000Z',
    expiresAt: null,
  },
];

function stubFetch() {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      return new Response(
        JSON.stringify({
          apiKey: { ...keys[0], id: 'k2', name: 'new-key' },
          fullKey: `ztk_${'a'.repeat(48)}`,
        }),
        { status: 201 },
      );
    }
    if (init?.method === 'DELETE') {
      return new Response(null, { status: 204 });
    }
    return new Response(JSON.stringify({ apiKeys: keys }), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('ApiKeysPage', () => {
  it('lists keys with prefix only', async () => {
    stubFetch();
    renderWithQuery(<ApiKeysPage />);
    expect(await screen.findByText('ci')).toBeInTheDocument();
    expect(screen.getByText(/ztk_abcd1234…/)).toBeInTheDocument();
  });

  it('creates a key and reveals the full key exactly once', async () => {
    const fetchMock = stubFetch();
    renderWithQuery(<ApiKeysPage />);
    await screen.findByText('ci');
    await userEvent.type(screen.getByPlaceholderText(/key name/i), 'new-key');
    await userEvent.click(screen.getByRole('button', { name: /create key/i }));
    expect(await screen.findByText(`ztk_${'a'.repeat(48)}`)).toBeInTheDocument();
    expect(screen.getByText(/will not be shown again/i)).toBeInTheDocument();
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(JSON.parse(post[1]!.body as string)).toEqual({ name: 'new-key' });
  });

  it('revokes a key via DELETE', async () => {
    const fetchMock = stubFetch();
    renderWithQuery(<ApiKeysPage />);
    await screen.findByText('ci');
    await userEvent.click(screen.getByRole('button', { name: /revoke/i }));
    await waitFor(() => {
      const del = fetchMock.mock.calls.find(([, init]) => init?.method === 'DELETE');
      expect(del).toBeDefined();
      expect(del![0]).toBe('/api/v1/apikeys/k1');
    });
  });
});
