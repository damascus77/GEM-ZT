// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '../helpers/render';
import { RulesEditor } from '@/components/networks/RulesEditor';

afterEach(() => {
  vi.unstubAllGlobals();
});

const NWID = 'abcdef0123456789';

function stubFetch(putResponse?: Response) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      return (
        putResponse ??
        new Response(
          JSON.stringify({
            source: 'accept;',
            rules: [{ type: 'ACTION_ACCEPT' }],
            metaWarning: null,
          }),
          { status: 200 },
        )
      );
    }
    if (String(url).includes('/controller/status')) {
      return new Response(
        JSON.stringify({ address: 'abcdef0123', online: true, version: '1.14.2' }),
        { status: 200 },
      );
    }
    return new Response(
      JSON.stringify({ source: 'accept;', rules: [{ type: 'ACTION_ACCEPT' }] }),
      { status: 200 },
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('RulesEditor', () => {
  it('loads the source into the editor and PUTs it on Compile & save', async () => {
    const fetchMock = stubFetch();
    renderWithQuery(<RulesEditor nwid={NWID} />);
    const editor = await screen.findByLabelText(/rules source/i);
    expect(editor).toHaveValue('accept;');
    await userEvent.click(screen.getByRole('button', { name: /compile & save/i }));
    await waitFor(() => {
      const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT');
      expect(put).toBeDefined();
      expect(put![0]).toBe(`/api/v1/networks/${NWID}/rules`);
      expect(JSON.parse(put![1]!.body as string)).toEqual({ source: 'accept;' });
    });
  });

  it('shows the compiled JSON in the raw tab', async () => {
    stubFetch();
    renderWithQuery(<RulesEditor nwid={NWID} />);
    await screen.findByLabelText(/rules source/i);
    await userEvent.click(screen.getByRole('button', { name: /compiled json/i }));
    expect(await screen.findByText(/"ACTION_ACCEPT"/)).toBeInTheDocument();
  });

  it('renders the 422 compile error with line info inline', async () => {
    stubFetch(
      new Response(
        JSON.stringify({
          error: { code: 'RULES_COMPILE_ERROR', message: 'line 1: unrecognized keyword' },
        }),
        { status: 422 },
      ),
    );
    renderWithQuery(<RulesEditor nwid={NWID} />);
    await screen.findByLabelText(/rules source/i);
    await userEvent.click(screen.getByRole('button', { name: /compile & save/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('line 1: unrecognized keyword');
  });
});
