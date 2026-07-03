/**
 * Human-readable "time since" for presence/last-seen displays.
 *
 * Accepts an injectable `now` (epoch ms) so tests are deterministic instead of
 * racing the real clock.
 */
export function timeAgo(date: Date | string | null, now: number = Date.now()): string {
  if (date === null) return 'never';

  const then = typeof date === 'string' ? new Date(date).getTime() : date.getTime();
  const diffMs = Math.max(0, now - then);
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 60) return 'just now';

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;

  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;

  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return `${diffDay}d ago`;

  const diffWeek = Math.floor(diffDay / 7);
  return `${diffWeek}w ago`;
}
