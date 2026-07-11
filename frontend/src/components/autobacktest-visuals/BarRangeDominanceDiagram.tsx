interface BarRangeDominanceDiagramProps {
  /** "Trade-direction bars must be this many times bigger than opposite-direction bars." */
  dominance: number;
}

// Two bars: the trade-direction one (indigo) grows taller than the opposite-direction one
// (gray, fixed reference height) as the dominance multiplier increases.
export function BarRangeDominanceDiagram({ dominance }: BarRangeDominanceDiagramProps) {
  const baseline = 16;
  const clamped = Math.max(1, Math.min(3, dominance));
  const alignedHeight = baseline * clamped;
  const bottom = 46;

  return (
    <svg width={56} height={56} viewBox="0 0 56 56" className="shrink-0">
      <line x1={6} y1={bottom} x2={50} y2={bottom} stroke="#e5e7eb" strokeWidth={1} />
      <rect x={14} y={bottom - baseline} width={10} height={baseline} fill="#e5e7eb" stroke="#9ca3af" strokeWidth={1} />
      <rect x={32} y={bottom - alignedHeight} width={10} height={alignedHeight} fill="#c7d2fe" stroke="#6366f1" strokeWidth={1} />
    </svg>
  );
}
