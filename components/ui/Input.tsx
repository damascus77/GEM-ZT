import { clsx } from 'clsx';
import type { InputHTMLAttributes } from 'react';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={clsx(
        'mt-1 w-full bg-canvas text-ink text-base rounded-sm border border-hairline',
        'px-3 py-2.5 focus:outline-none focus:border-hairline-dark',
        className,
      )}
      {...props}
    />
  );
}
