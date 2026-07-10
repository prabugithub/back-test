interface BarOverlapDiagramProps {
  /** Overlap ratio 0-1 — same value the threshold slider drives. */
  ratio: number;
}

// Two candle silhouettes whose price ranges pull apart as ratio -> 0 (clean, non-overlapping
// bars) and coincide as ratio -> 1 (choppy, fully overlapping bars). Purely illustrative —
// not drawn from real candles — so the concept reads the same regardless of loaded data.
export function BarOverlapDiagram({ ratio }: BarOverlapDiagramProps) {
  const clamped = Math.max(0, Math.min(1, ratio));
  const range = 22;
  const centerY = 28;
  const offset = (1 - clamped) * range;
  const bar1Center = centerY - offset / 2;
  const bar2Center = centerY + offset / 2;
  const bar1Top = bar1Center - range / 2;
  const bar2Top = bar2Center - range / 2;
  const overlapTop = Math.max(bar1Top, bar2Top);
  const overlapBottom = Math.min(bar1Top + range, bar2Top + range);
  const overlapHeight = Math.max(0, overlapBottom - overlapTop);

  return (
    <svg width={56} height={56} viewBox="0 0 56 56" className="shrink-0">
      {overlapHeight > 0 && (
        <rect x={8} y={overlapTop} width={40} height={overlapHeight} fill="#818cf8" opacity={0.3} />
      )}
      {/* bar 1 (previous bar) */}
      <line x1={19} y1={bar1Top - 4} x2={19} y2={bar1Top + range + 4} stroke="#9ca3af" strokeWidth={1} />
      <rect x={14} y={bar1Top} width={10} height={range} fill="#e5e7eb" stroke="#9ca3af" strokeWidth={1} />
      {/* bar 2 (current bar) */}
      <line x1={37} y1={bar2Top - 4} x2={37} y2={bar2Top + range + 4} stroke="#6366f1" strokeWidth={1} />
      <rect x={32} y={bar2Top} width={10} height={range} fill="#c7d2fe" stroke="#6366f1" strokeWidth={1} />
    </svg>
  );
}
