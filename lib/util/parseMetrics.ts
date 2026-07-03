/**
 * Minimal parser for the subset of Prometheus text-exposition format this app
 * emits: bare `metric_name value` gauge lines (no labels). Comment lines
 * (`# HELP`/`# TYPE`), blank lines, and non-numeric values are ignored.
 */
export function parsePrometheusMetrics(text: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s+(-?\d+(?:\.\d+)?)$/);
    if (match) out[match[1]] = Number(match[2]);
  }
  return out;
}
