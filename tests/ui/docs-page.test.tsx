// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithQuery } from '../helpers/render';
import DocsPage from '@/app/(ui)/docs/page';
import { openApiSpec } from '@/lib/api/openapi';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DocsPage', () => {
  it('renders endpoint groups from the fetched spec', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(openApiSpec), { status: 200 }))
    );
    renderWithQuery(<DocsPage />);
    expect(await screen.findByText('/networks/{nwid}/members/{memberId}')).toBeInTheDocument();
    expect(screen.getAllByText('GET').length).toBeGreaterThan(0);
    expect(screen.getAllByText('PATCH').length).toBeGreaterThan(0);
    expect(screen.getByText(/GEM-ZT API/)).toBeInTheDocument();
  });
});
