interface PivotGapDiagramProps {
  /** Threshold in bars, same value the slider drives. */
  gapBars: number;
}

// Three pivot markers on a timeline, spaced apart proportionally to the bar-gap threshold —
// "how many bars typically pass between one swing point and the next."
export function PivotGapDiagram({ gapBars }: PivotGapDiagramProps) {
  const clamped = Math.max(1, Math.min(20, gapBars));
  const spacing = 8 + (clamped / 20) * 14;
  const y = 28;
  const xs = [28 - spacing, 28, 28 + spacing];

  return (
    <svg width={56} height={56} viewBox="0 0 56 56" className="shrink-0">
      <line x1={2} y1={y} x2={54} y2={y} stroke="#e5e7eb" strokeWidth={1} />
      <line x1={xs[0]} y1={y - 10} x2={xs[1]} y2={y - 10} stroke="#f59e0b" strokeWidth={1} />
      <line x1={xs[1]} y1={y - 10} x2={xs[2]} y2={y - 10} stroke="#f59e0b" strokeWidth={1} />
      {xs.map((x, i) => (
        <circle key={i} cx={x} cy={y} r={3} fill="#c7d2fe" stroke="#6366f1" strokeWidth={1.5} />
      ))}
    </svg>
  );
}
