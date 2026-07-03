import { clsx } from 'clsx';
import type { HTMLAttributes } from 'react';

export function Pill({ className, children, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full px-3 py-1 text-xs wght-540',
        'border border-hairline bg-canvas text-ink',
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
