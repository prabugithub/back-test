interface EmaSlopeDiagramProps {
  /** Threshold value in points/bar (same units as the slider). */
  slope: number;
  min: number;
  max: number;
}

// Angled line standing in for "how steep does the EMA have to be." The mapping to angle is
// illustrative (min..max -> -40deg..+40deg), not literally to scale — raw points/bar has no
// fixed visual meaning across instruments/timeframes (see EMA slope tooltip), so the goal
// here is just "flatter number -> flatter line, steeper number -> steeper line."
export function EmaSlopeDiagram({ slope, min, max }: EmaSlopeDiagramProps) {
  const clamped = Math.max(min, Math.min(max, slope));
  const norm = max > min ? (clamped - min) / (max - min) : 0.5;
  const angleDeg = -40 + norm * 80;
  const rad = (angleDeg * Math.PI) / 180;
  const cx = 28;
  const cy = 30;
  const len = 20;
  const x1 = cx - len * Math.cos(rad);
  const y1 = cy + len * Math.sin(rad);
  const x2 = cx + len * Math.cos(rad);
  const y2 = cy - len * Math.sin(rad);

  return (
    <svg width={56} height={56} viewBox="0 0 56 56" className="shrink-0">
      <line x1={4} y1={44} x2={52} y2={44} stroke="#e5e7eb" strokeWidth={1} />
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#6366f1" strokeWidth={2} strokeLinecap="round" />
      <circle cx={x2} cy={y2} r={2.5} fill="#6366f1" />
    </svg>
  );
}
