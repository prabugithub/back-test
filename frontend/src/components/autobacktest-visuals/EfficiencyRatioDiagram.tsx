interface EfficiencyRatioDiagramProps {
  /** Efficiency ratio 0-1 — same value the threshold slider drives. */
  ratio: number;
}

const POINT_COUNT = 7;

// Straight line (ratio -> 1, "traveled directly") vs. a zigzag path with the same start/end
// (ratio -> 0, "wandered a lot to get nowhere") — this is literally what the Kaufman
// Efficiency Ratio measures: net displacement over total path traveled.
export function EfficiencyRatioDiagram({ ratio }: EfficiencyRatioDiagramProps) {
  const clamped = Math.max(0, Math.min(1, ratio));
  const amplitude = (1 - clamped) * 12;
  const startX = 6;
  const endX = 50;
  const startY = 40;
  const endY = 12;

  const points = Array.from({ length: POINT_COUNT }, (_, i) => {
    const t = i / (POINT_COUNT - 1);
    const x = startX + (endX - startX) * t;
    const baseline = startY + (endY - startY) * t;
    const isEdge = i === 0 || i === POINT_COUNT - 1;
    const sign = i % 2 === 0 ? 1 : -1;
    const y = isEdge ? baseline : baseline + sign * amplitude;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width={56} height={56} viewBox="0 0 56 56" className="shrink-0">
      <line x1={startX} y1={startY} x2={endX} y2={endY} stroke="#d1d5db" strokeWidth={1} strokeDasharray="3 2" />
      <polyline points={points} fill="none" stroke="#6366f1" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={startX} cy={startY} r={2.5} fill="#6366f1" />
      <circle cx={endX} cy={endY} r={2.5} fill="#6366f1" />
    </svg>
  );
}
