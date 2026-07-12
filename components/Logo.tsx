import { brandColors } from '@/lib/design/tokens';

/** Wireframe diamond "ZT" mark — DESIGN.md's Application Shell logo spec. */
export function Logo({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      aria-hidden="true"
    >
      <polygon
        points="12,2.5 21.5,12 12,21.5 2.5,12"
        fill="none"
        stroke={brandColors['violet-soft']}
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <text
        x="12"
        y="12"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize="7.5"
        fontWeight="700"
        fill={brandColors['violet-soft']}
      >
        ZT
      </text>
    </svg>
  );
}
