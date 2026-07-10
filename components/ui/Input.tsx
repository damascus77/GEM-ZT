import { clsx } from 'clsx';
import type { InputHTMLAttributes } from 'react';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={clsx(
        'mt-1 w-full rounded-sm border border-hairline bg-canvas text-base text-ink',
        'px-3 py-2.5 focus:border-hairline-dark focus:outline-none',
        className
      )}
      {...props}
    />
  );
}
