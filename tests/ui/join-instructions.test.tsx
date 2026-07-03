// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { JoinInstructions } from '@/components/networks/JoinInstructions';

const NWID = 'abcdef0123456789';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('JoinInstructions', () => {
  it('renders the linux/macOS and windows join commands', () => {
    render(<JoinInstructions nwid={NWID} />);
    expect(screen.getByText(`sudo zerotier-cli join ${NWID}`)).toBeInTheDocument();
    expect(screen.getByText(`zerotier-cli join ${NWID}`)).toBeInTheDocument();
  });

  it('copies the linux/macOS command when its Copy button is clicked', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });

    render(<JoinInstructions nwid={NWID} />);
    await userEvent.click(screen.getByRole('button', { name: /copy linux\/macos join command/i }));

    expect(writeText).toHaveBeenCalledWith(`sudo zerotier-cli join ${NWID}`);
  });

  it('copies the windows command when its Copy button is clicked', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });

    render(<JoinInstructions nwid={NWID} />);
    await userEvent.click(screen.getByRole('button', { name: /copy windows join command/i }));

    expect(writeText).toHaveBeenCalledWith(`zerotier-cli join ${NWID}`);
  });

  it('does not throw when navigator.clipboard is unavailable', async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: undefined });

    render(<JoinInstructions nwid={NWID} />);
    await userEvent.click(screen.getByRole('button', { name: /copy linux\/macos join command/i }));
    // No assertion needed beyond not throwing.
  });
});
