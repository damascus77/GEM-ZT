import { clsx } from 'clsx';
import type { HTMLAttributes } from 'react';

export type PillTone = 'default' | 'success';

interface PillProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: PillTone;
}

// Tone drives the fill/text so positive pills stay legible in BOTH themes. The
// `success` variant uses a solid teal fill with white text — the old
// `border-teal-mid text-teal-deep` was ~1.1:1 on the dark canvas (invisible).
const toneClasses: Record<PillTone, string> = {
  default: 'border-hairline bg-canvas text-ink',
  success: 'border-teal-mid bg-teal-mid text-white',
};

export function Pill({ tone = 'default', className, children, ...props }: PillProps) {
  return (
    <span
      className={clsx(
        'wght-540 inline-flex items-center rounded-full border px-3 py-1 text-xs',
        toneClasses[tone],
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
}
