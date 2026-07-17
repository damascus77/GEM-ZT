import { clsx } from 'clsx';

export interface AcceptedChipItem {
  label: string;
  value: string;
  // When provided, the chip renders a red "×" that calls this to remove the value.
  onRemove?: () => void;
}

export function AcceptedChip({ label, value, onRemove }: AcceptedChipItem) {
  return (
    <span
      className={clsx(
        'inline-flex max-w-full items-center gap-1 rounded-full border border-teal-deep',
        // Solid teal fill with white text so the chip stays legible in BOTH light
        // and dark themes — the old teal-on-canvas-soft was near-invisible on the
        // dark page background (teal-deep #0e3030 on #100e1c).
        'bg-teal-mid py-0.5 pl-2 pr-1 font-mono text-[11px] leading-5 text-white'
      )}
    >
      <span className="truncate">{`${label} accepted: ${value}`}</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${label} ${value}`}
          title={`Remove ${value}`}
          className={clsx(
            'ml-0.5 shrink-0 rounded-full px-1 font-sans text-sm font-semibold leading-none',
            'text-red-300 hover:bg-red-500/20 hover:text-red-100 focus:outline-none'
          )}
        >
          ×
        </button>
      )}
    </span>
  );
}

export function AcceptedChips({ values }: { values: AcceptedChipItem[] }) {
  if (values.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1" aria-label="Accepted field values">
      {values.map(({ label, value, onRemove }) => (
        <AcceptedChip key={`${label}-${value}`} label={label} value={value} onRemove={onRemove} />
      ))}
    </div>
  );
}
