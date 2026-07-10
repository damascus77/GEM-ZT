import { clsx } from 'clsx';
import type { HTMLAttributes } from 'react';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={clsx('rounded-lg border border-hairline bg-canvas p-8 shadow-lift', className)}
      {...props}
    />
  );
}
