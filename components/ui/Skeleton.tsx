import { clsx } from 'clsx';
import type { HTMLAttributes } from 'react';

/** A single shimmering placeholder block. Width/height via className. */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={clsx('animate-pulse rounded-sm bg-ink-faint/15', className)}
      aria-hidden="true"
      {...props}
    />
  );
}

/**
 * A block of placeholder table rows for a loading list. Renders inside a
 * <tbody>; `columns` controls how many cells each row spans so the skeleton
 * lines up with the real table header.
 */
export function SkeletonRows({ rows = 5, columns = 1 }: { rows?: number; columns?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r} className="border-t border-hairline" aria-hidden="true">
          {Array.from({ length: columns }, (_, c) => (
            <td key={c} className="py-3 pr-4">
              <Skeleton className="h-5 w-full" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
