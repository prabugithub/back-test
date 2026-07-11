interface PivotSequenceStaircaseProps {
  /** Dash-joined 4-label pattern, e.g. "HH-HH-LH-HH" or "HL-LL-LL-HL". */
  pattern: string;
  width?: number;
  height?: number;
}

// A 4-step staircase: every "H"-prefixed label (HH or HL — the higher/continuation variant)
// steps up, every "L"-prefixed label (LH or LL — the lower/pullback variant) steps down. The
// same rule works for both the high-sequence and low-sequence pattern sets, so a run of H's
// reads as a rising staircase and a run of L's as a falling one, regardless of which side.
export function PivotSequenceStaircase({ pattern, width = 40, height = 22 }: PivotSequenceStaircaseProps) {
  const labels = pattern.split('-');
  const stepX = width / (labels.length + 1);
  const stepY = (height - 6) / labels.length;

  let y = height / 2;
  const points: { x: number; y: number }[] = [{ x: stepX * 0.5, y }];
  labels.forEach((label, i) => {
    y += label.startsWith('H') ? -stepY : stepY;
    y = Math.max(3, Math.min(height - 3, y));
    points.push({ x: stepX * (i + 1.5), y });
  });

  const isAllUp = labels.every(l => l.startsWith('H'));
  const isAllDown = labels.every(l => l.startsWith('L'));
  const color = isAllUp ? '#16a34a' : isAllDown ? '#dc2626' : '#d97706';
  const pointsStr = points.map(p => `${p.x},${p.y}`).join(' ');

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="shrink-0">
      <polyline points={pointsStr} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      {points.slice(1).map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={1.5} fill={color} />
      ))}
    </svg>
  );
}
