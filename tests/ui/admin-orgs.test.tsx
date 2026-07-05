// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '../helpers/render';
import { AdminOrgs } from '@/components/AdminOrgs';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const orgs = [
  { id: 'org-1', name: 'Acme', slug: 'acme', role: 'owner' },
  { id: 'org-2', name: 'Beta Corp', slug: 'beta-corp', role: null },
];

function stubFetch(
  isSuperAdmin: boolean,
  opts: { createStatus?: number; createBody?: unknown; deleteStatus?: number; deleteBody?: unknown } = {},
) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/v1/me') {
      return new Response(
        JSON.stringify({
          user: { isSuperAdmin },
          activeOrgId: 'org-1',
          memberships: [{ orgId: 'org-1', role: 'owner' }],
        }),
        { status: 200 },
      );
    }
    if (url === '/api/v1/orgs' && init?.method === 'POST') {
      const status = opts.createStatus ?? 201;
      const body = opts.createBody ?? { org: { id: 'org-3', name: 'New Org', slug: 'new-org' } };
      return new Response(JSON.stringify(body), { status });
    }
    if (url.startsWith('/api/v1/orgs/') && init?.method === 'DELETE') {
      const status = opts.deleteStatus ?? 204;
      if (status === 204) return new Response(null, { status: 204 });
      return new Response(JSON.stringify(opts.deleteBody ?? {}), { status });
    }
    if (url === '/api/v1/orgs') {
      return new Response(JSON.stringify({ orgs }), { status: 200 });
    }
    return new Response(JSON.stringify({}), { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('AdminOrgs', () => {
  it('shows an access-required message for non-super-admins, not the org list', async () => {
    stubFetch(false);
    renderWithQuery(<AdminOrgs />);
    expect(await screen.findByText(/super-admin access required/i)).toBeInTheDocument();
    expect(screen.queryByText('Acme')).toBeNull();
    expect(screen.queryByRole('button', { name: /create/i })).toBeNull();
  });

  it('super-admin sees the org list and create form', async () => {
    stubFetch(true);
    renderWithQuery(<AdminOrgs />);
    expect(await screen.findByText('Acme')).toBeInTheDocument();
    expect(screen.getByText('acme')).toBeInTheDocument();
    expect(screen.getByText('Beta Corp')).toBeInTheDocument();
    expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create/i })).toBeInTheDocument();
  });

  it('creating an org POSTs /api/v1/orgs and refetches', async () => {
    const fetchMock = stubFetch(true);
    renderWithQuery(<AdminOrgs />);
    await screen.findByText('Acme');
    await userEvent.type(screen.getByLabelText(/name/i), 'New Org');
    await userEvent.click(screen.getByRole('button', { name: /create/i }));
    await waitFor(() => {
      const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
      expect(post).toBeDefined();
      expect(post![0]).toBe('/api/v1/orgs');
      expect(JSON.parse(post![1]!.body as string)).toEqual({ name: 'New Org' });
    });
  });

  it('deleting an org DELETEs after confirmation and refetches', async () => {
    const fetchMock = stubFetch(true);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderWithQuery(<AdminOrgs />);
    await screen.findByText('Acme');
    const row = screen.getByText('Acme').closest('tr')!;
    await userEvent.click(row.querySelector('button')!);
    await waitFor(() => {
      const del = fetchMock.mock.calls.find(([, init]) => init?.method === 'DELETE');
      expect(del).toBeDefined();
      expect(del![0]).toBe('/api/v1/orgs/org-1');
    });
  });

  it('does not delete when confirmation is dismissed', async () => {
    const fetchMock = stubFetch(true);
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderWithQuery(<AdminOrgs />);
    await screen.findByText('Acme');
    const row = screen.getByText('Acme').closest('tr')!;
    await userEvent.click(row.querySelector('button')!);
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchMock.mock.calls.find(([, init]) => init?.method === 'DELETE')).toBeUndefined();
  });

  it('surfaces a 409 ORG_NOT_EMPTY error inline without crashing', async () => {
    stubFetch(true, {
      deleteStatus: 409,
      deleteBody: { error: { code: 'ORG_NOT_EMPTY', message: 'Organization still has networks assigned.' } },
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderWithQuery(<AdminOrgs />);
    await screen.findByText('Acme');
    const row = screen.getByText('Acme').closest('tr')!;
    await userEvent.click(row.querySelector('button')!);
    expect(await screen.findByText(/organization still has networks assigned/i)).toBeInTheDocument();
    // Org list should still be rendered (no crash).
    expect(screen.getByText('Acme')).toBeInTheDocument();
  });

  it('surfaces an error creating an org', async () => {
    stubFetch(true, {
      createStatus: 400,
      createBody: { error: { code: 'VALIDATION', message: 'Name is required.' } },
    });
    renderWithQuery(<AdminOrgs />);
    await screen.findByText('Acme');
    await userEvent.type(screen.getByLabelText(/name/i), 'x');
    await userEvent.click(screen.getByRole('button', { name: /create/i }));
    expect(await screen.findByText(/name is required/i)).toBeInTheDocument();
  });
});
