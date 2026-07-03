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
        'text-base font-bold leading-none px-5 py-3 transition-colors',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        variant === 'primary' &&
          'bg-primary text-on-primary rounded-md active:bg-primary-deep hover:bg-primary-deep',
        variant === 'outline' &&
          'bg-canvas text-ink border border-hairline-dark rounded-md hover:bg-canvas-soft',
        variant === 'pill' && 'bg-violet-soft text-primary rounded-full',
        className,
      )}
      {...props}
    />
  );
}
