interface PivotSeqDiagramProps {
  pattern: 'HH-HL' | 'LH-HL' | 'HH-LL' | 'LH-LL';
}

// A 2-leg zigzag (swing high, swing low) whose peak/trough heights encode the pattern: HH
// peaks higher than LH, HL troughs higher (shallower) than LL — so the four combinations
// read as visibly different swing shapes rather than four-letter codes.
export function PivotSeqDiagram({ pattern }: PivotSeqDiagramProps) {
  const [highLabel, lowLabel] = pattern.split('-') as ['HH' | 'LH', 'HL' | 'LL'];
  const isBullish = highLabel === 'HH' && lowLabel === 'HL';
  const isBearish = highLabel === 'LH' && lowLabel === 'LL';
  const color = isBullish ? '#16a34a' : isBearish ? '#dc2626' : '#d97706';

  const p0 = { x: 4, y: 34 };
  const p1 = { x: 27, y: highLabel === 'HH' ? 8 : 17 };
  const p2 = { x: 50, y: lowLabel === 'HL' ? 20 : 40 };

  return (
    <svg width={56} height={56} viewBox="0 0 56 56" className="shrink-0">
      <polyline points={`${p0.x},${p0.y} ${p1.x},${p1.y} ${p2.x},${p2.y}`} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={p1.x} cy={p1.y} r={2.5} fill={color} />
      <circle cx={p2.x} cy={p2.y} r={2.5} fill={color} />
      <text x={p1.x} y={p1.y - 6} fontSize={8} fill={color} textAnchor="middle" fontWeight={600}>{highLabel}</text>
      <text x={p2.x} y={p2.y + 12} fontSize={8} fill={color} textAnchor="middle" fontWeight={600}>{lowLabel}</text>
    </svg>
  );
}
