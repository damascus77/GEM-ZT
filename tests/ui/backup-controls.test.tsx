// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithQuery } from '../helpers/render';
import { BackupControls } from '@/components/BackupControls';

const createObjectURL = vi.fn(() => 'blob:mock-url');
const revokeObjectURL = vi.fn();

beforeEach(() => {
  vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
});

afterEach(() => {
  vi.unstubAllGlobals();
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
});

describe('BackupControls', () => {
  it('downloads the backup JSON when clicked', async () => {
    const backup = { version: 1, networks: [] };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(backup), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });

    renderWithQuery(<BackupControls />);
    await userEvent.click(screen.getByRole('button', { name: /download backup/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/backup');
      expect(createObjectURL).toHaveBeenCalledTimes(1);
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
    });
  });

  it('shows an error message when the download fails', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);

    renderWithQuery(<BackupControls />);
    await userEvent.click(screen.getByRole('button', { name: /download backup/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/failed/i);
  });

  it('restores a backup from a selected file and shows the summary', async () => {
    const summary = {
      networksCreated: 1,
      networksUpdated: 2,
      membersRestored: 3,
      membersSkipped: 1,
      warnings: ['member deadbeef01 on network abcdef0123456789 not joined yet — config skipped'],
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(summary), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    renderWithQuery(<BackupControls />);

    const backupJson = { version: 1, networks: [] };
    const file = new File([JSON.stringify(backupJson)], 'gemzt-backup.json', {
      type: 'application/json',
    });
    const input = screen.getByLabelText(/restore file/i);
    await userEvent.upload(input, file);
    await userEvent.click(screen.getByRole('button', { name: /^restore$/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/backup/restore',
        expect.objectContaining({ method: 'POST' })
      );
    });

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent(/2 network.*updated/i);
    expect(status).toHaveTextContent(/1 network.*created/i);
    expect(status).toHaveTextContent(/3 member.*restored/i);
    expect(status).toHaveTextContent(/1 member.*skipped/i);
    expect(screen.getByText(/not joined yet/i)).toBeInTheDocument();
  });

  it('shows an error when restore fails', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ error: { message: 'bad' } }), { status: 400 })
    );
    vi.stubGlobal('fetch', fetchMock);

    renderWithQuery(<BackupControls />);

    const file = new File([JSON.stringify({ version: 1, networks: [] })], 'backup.json', {
      type: 'application/json',
    });
    const input = screen.getByLabelText(/restore file/i);
    await userEvent.upload(input, file);
    await userEvent.click(screen.getByRole('button', { name: /^restore$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/failed|bad/i);
  });

  it('disables the restore button until a file is chosen', () => {
    renderWithQuery(<BackupControls />);
    expect(screen.getByRole('button', { name: /^restore$/i })).toBeDisabled();
  });
});
