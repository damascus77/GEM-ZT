// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '../helpers/render';
import { RateLimitSettings } from '@/components/RateLimitSettings';

afterEach(() => {
  vi.unstubAllGlobals();
});

const body = {
  defaults: {
    loginMaxAttempts: 5,
    loginIpMaxAttempts: 20,
    loginWindowMs: 900000,
    selfAuthorizeMaxAttempts: 10,
    selfAuthorizeWindowMs: 900000,
  },
  effective: {
    loginMaxAttempts: 5,
    loginIpMaxAttempts: 20,
    loginWindowMs: 900000,
    selfAuthorizeMaxAttempts: 10,
    selfAuthorizeWindowMs: 900000,
  },
  overrides: {},
};

describe('RateLimitSettings', () => {
  it('loads settings and saves edited values', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        return new Response(
          JSON.stringify({ ...body, effective: JSON.parse(init.body as string) }),
          {
            status: 200,
          }
        );
      }
      return new Response(JSON.stringify(body), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithQuery(<RateLimitSettings />);

    const usernameLimit = await screen.findByLabelText(/login attempts per username/i);
    await userEvent.clear(usernameLimit);
    await userEvent.type(usernameLimit, '2');
    await userEvent.click(screen.getByRole('button', { name: /save rate limits/i }));

    await waitFor(() => {
      const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT');
      expect(put).toBeDefined();
      expect(JSON.parse(put![1]!.body as string)).toMatchObject({ loginMaxAttempts: 2 });
    });
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
  });
});
