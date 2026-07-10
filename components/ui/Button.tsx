import { clsx } from 'clsx';
import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'outline' | 'pill';

export function Button({
  variant = 'primary',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={clsx(
        'px-5 py-3 text-base font-bold leading-none transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50',
        variant === 'primary' &&
          'rounded-md bg-primary text-on-primary hover:bg-primary-deep active:bg-primary-deep',
        variant === 'outline' &&
          'rounded-md border border-hairline-dark bg-canvas text-ink hover:bg-canvas-soft',
        variant === 'pill' && 'rounded-full bg-violet-soft text-primary',
        className
      )}
      {...props}
    />
  );
}
