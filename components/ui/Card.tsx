import { clsx } from 'clsx';
import type { HTMLAttributes } from 'react';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={clsx('bg-canvas border border-hairline rounded-lg p-8 shadow-lift', className)}
      {...props}
    />
  );
}
