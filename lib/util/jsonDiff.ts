/**
 * Pure, deterministic line-level diff between two JSON-serializable values.
 *
 * Used to preview flow-rules changes before saving: pretty-print the
 * currently-live compiled rules and the rules the operator's edited source
 * would compile to, then diff the two textual representations line-by-line
 * so the operator can see exactly what would change.
 */
export type DiffLine = { type: 'added' | 'removed' | 'unchanged'; text: string };

/**
 * Longest Common Subsequence-based line diff. Small inputs (compiled rules
 * JSON is at most a few hundred lines), so the O(n*m) table is cheap and
 * keeps the output minimal/readable rather than naive "remove all, add all".
 */
export function diffJsonLines(before: unknown, after: unknown): DiffLine[] {
  const a = JSON.stringify(before, null, 2).split('\n');
  const b = JSON.stringify(after, null, 2).split('\n');

  const n = a.length;
  const m = b.length;
  // lcs[i][j] = length of the LCS of a[i:] and b[j:]
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      result.push({ type: 'unchanged', text: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      result.push({ type: 'removed', text: a[i] });
      i++;
    } else {
      result.push({ type: 'added', text: b[j] });
      j++;
    }
  }
  while (i < n) {
    result.push({ type: 'removed', text: a[i] });
    i++;
  }
  while (j < m) {
    result.push({ type: 'added', text: b[j] });
    j++;
  }
  return result;
}

export function hasChanges(before: unknown, after: unknown): boolean {
  return diffJsonLines(before, after).some(l => l.type !== 'unchanged');
}
