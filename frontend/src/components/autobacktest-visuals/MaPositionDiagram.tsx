interface MaPositionDiagramProps {
  variant: 'above_ema21' | 'on_or_above_ema21' | 'above_ema60';
  isShort: boolean;
}

// A candle's position relative to a single moving-average line: clearly on one side (above/
// below) for the "above" variants, or straddling the line for the "touch" variant. EMA60 gets
// a thicker line to read as the slower/longer average, distinguishing it from EMA21's thin line.
export function MaPositionDiagram({ variant, isShort }: MaPositionDiagramProps) {
  const lineY = 28;
  const lineWidth = variant === 'above_ema60' ? 2 : 1;
  const favorable = !isShort; // candle drawn above the line for longs, below for shorts

  let top: number, bottom: number;
  if (variant === 'on_or_above_ema21') {
    top = 20;
    bottom = 36;
  } else if (favorable) {
    top = 10;
    bottom = 22;
  } else {
    top = 34;
    bottom = 46;
  }

  return (
    <svg width={56} height={56} viewBox="0 0 56 56" className="shrink-0">
      <line x1={2} y1={lineY} x2={54} y2={lineY} stroke="#6366f1" strokeWidth={lineWidth} strokeDasharray={variant === 'above_ema60' ? undefined : '3 2'} />
      <line x1={28} y1={top - 4} x2={28} y2={bottom + 4} stroke="#9ca3af" strokeWidth={1} />
      <rect x={22} y={top} width={12} height={bottom - top} fill="#c7d2fe" stroke="#6366f1" strokeWidth={1} />
    </svg>
  );
}
