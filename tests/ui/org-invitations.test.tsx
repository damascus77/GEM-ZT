// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '../helpers/render';
import { OrgInvitations } from '@/components/OrgInvitations';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const ORG_ID = 'org-1';

const invitations = [
  { id: 'inv-1', role: 'admin', email: 'alice@example.com', expiresAt: '2026-08-01T00:00:00.000Z', createdAt: '2026-07-01T00:00:00.000Z' },
  { id: 'inv-2', role: 'viewer', email: null, expiresAt: '2026-08-05T00:00:00.000Z', createdAt: '2026-07-02T00:00:00.000Z' },
];

function stubFetch(
  meRole: string,
  opts: { createStatus?: number; createBody?: unknown; deleteStatus?: number } = {},
) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/v1/me') {
      return new Response(
        JSON.stringify({
          user: { isSuperAdmin: meRole === 'superadmin' },
          memberships: [{ orgId: ORG_ID, role: meRole }],
        }),
        { status: 200 },
      );
    }
    if (url === `/api/v1/orgs/${ORG_ID}/invitations` && init?.method === 'POST') {
      const status = opts.createStatus ?? 201;
      const body =
        opts.createBody ??
        {
          invitation: {
            id: 'inv-new',
            role: 'viewer',
            email: null,
            expiresAt: '2026-08-10T00:00:00.000Z',
          },
          token: 'plaintext-token-abc123',
        };
      return new Response(JSON.stringify(body), { status });
    }
    if (typeof url === 'string' && url.startsWith(`/api/v1/orgs/${ORG_ID}/invitations/`) && init?.method === 'DELETE') {
      const status = opts.deleteStatus ?? 204;
      if (status === 204) return new Response(null, { status: 204 });
      return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Invitation not found.' } }), { status });
    }
    if (url === `/api/v1/orgs/${ORG_ID}/invitations`) {
      return new Response(JSON.stringify({ invitations }), { status: 200 });
    }
    throw new Error(`Unexpected fetch: ${url} ${init?.method}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('OrgInvitations', () => {
  it('manager sees the pending invitations list', async () => {
    stubFetch('owner');
    renderWithQuery(<OrgInvitations orgId={ORG_ID} />);
    expect(await screen.findByText('alice@example.com')).toBeInTheDocument();
    const row = screen.getByText('alice@example.com').closest('tr')!;
    expect(row).toHaveTextContent(/admin/i);
  });

  it('manager sees the create-invitation form', async () => {
    stubFetch('admin');
    renderWithQuery(<OrgInvitations orgId={ORG_ID} />);
    await screen.findByText('alice@example.com');
    expect(screen.getByRole('button', { name: /create invit/i })).toBeInTheDocument();
  });

  it('non-manager does not see the invitations panel at all', async () => {
    stubFetch('viewer');
    renderWithQuery(<OrgInvitations orgId={ORG_ID} />);
    await waitFor(() => expect(screen.queryByText(/invitations/i)).toBeNull());
    expect(screen.queryByText('alice@example.com')).toBeNull();
  });

  it('creating an invitation POSTs and shows the invite link once', async () => {
    const fetchMock = stubFetch('owner');
    renderWithQuery(<OrgInvitations orgId={ORG_ID} />);
    await screen.findByText('alice@example.com');

    await userEvent.selectOptions(screen.getByLabelText(/^role$/i), 'viewer');
    await userEvent.click(screen.getByRole('button', { name: /create invit/i }));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        ([url, init]) => url === `/api/v1/orgs/${ORG_ID}/invitations` && init?.method === 'POST',
      );
      expect(post).toBeDefined();
      expect(JSON.parse(post![1]!.body as string)).toEqual({ role: 'viewer' });
    });

    expect(await screen.findByText(/plaintext-token-abc123/)).toBeInTheDocument();
  });

  it('revoking an invitation DELETEs the correct endpoint', async () => {
    const fetchMock = stubFetch('owner');
    renderWithQuery(<OrgInvitations orgId={ORG_ID} />);
    await screen.findByText('alice@example.com');

    const row = screen.getByText('alice@example.com').closest('tr')!;
    await userEvent.click(row.querySelector('button')!);

    await waitFor(() => {
      const del = fetchMock.mock.calls.find(([, init]) => init?.method === 'DELETE');
      expect(del).toBeDefined();
      expect(del![0]).toBe(`/api/v1/orgs/${ORG_ID}/invitations/inv-1`);
    });
  });

  it('surfaces a 403 error when a non-owner tries to grant the owner role', async () => {
    stubFetch('admin', {
      createStatus: 403,
      createBody: { error: { code: 'FORBIDDEN', message: 'Only an owner may grant the owner role.' } },
    });
    renderWithQuery(<OrgInvitations orgId={ORG_ID} />);
    await screen.findByText('alice@example.com');
    await userEvent.click(screen.getByRole('button', { name: /create invit/i }));
    expect(await screen.findByText(/only an owner may grant the owner role/i)).toBeInTheDocument();
  });
});
