import { clsx } from 'clsx';

export function AcceptedChip({ label, value }: { label: string; value: string }) {
  return (
    <span
      className={clsx(
        'inline-flex max-w-full items-center gap-1 rounded-full border border-teal-mid',
        'bg-canvas-soft px-2 py-0.5 font-mono text-[11px] leading-5 text-teal-deep'
      )}
    >
      {`${label} accepted: ${value}`}
    </span>
  );
}

export function AcceptedChips({ values }: { values: Array<{ label: string; value: string }> }) {
  if (values.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1" aria-label="Accepted field values">
      {values.map(({ label, value }) => (
        <AcceptedChip key={`${label}-${value}`} label={label} value={value} />
      ))}
    </div>
  );
}
