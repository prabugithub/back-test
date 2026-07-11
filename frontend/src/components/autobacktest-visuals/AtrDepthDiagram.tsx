interface AtrDepthDiagramProps {
  /** Threshold in ATR units, same value the slider drives. */
  atrMultiple: number;
}

// A candle's vertical distance from the EMA21 line, scaled to the ATR-unit threshold — a
// volatility-normalized "how far from the average, measured in typical bar sizes" ruler.
export function AtrDepthDiagram({ atrMultiple }: AtrDepthDiagramProps) {
  const clamped = Math.max(0.25, Math.min(4, atrMultiple));
  const offset = 4 + (clamped / 4) * 28;
  const lineY = 10;
  const candleTop = lineY + offset;
  const candleBottom = candleTop + 12;

  return (
    <svg width={56} height={56} viewBox="0 0 56 56" className="shrink-0">
      <line x1={2} y1={lineY} x2={54} y2={lineY} stroke="#6366f1" strokeWidth={1} strokeDasharray="3 2" />
      <line x1={44} y1={lineY} x2={44} y2={candleTop} stroke="#f59e0b" strokeWidth={1} />
      <line x1={41} y1={lineY} x2={47} y2={lineY} stroke="#f59e0b" strokeWidth={1} />
      <line x1={41} y1={candleTop} x2={47} y2={candleTop} stroke="#f59e0b" strokeWidth={1} />
      <line x1={20} y1={candleTop - 4} x2={20} y2={candleBottom + 4} stroke="#9ca3af" strokeWidth={1} />
      <rect x={14} y={candleTop} width={12} height={candleBottom - candleTop} fill="#c7d2fe" stroke="#6366f1" strokeWidth={1} />
    </svg>
  );
}
