import { clsx } from 'clsx';
import type { HTMLAttributes } from 'react';

export function Pill({ className, children, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={clsx(
        'wght-540 inline-flex items-center rounded-full px-3 py-1 text-xs',
        'border border-hairline bg-canvas text-ink',
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
}
