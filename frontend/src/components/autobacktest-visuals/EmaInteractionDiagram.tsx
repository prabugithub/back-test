interface EmaInteractionDiagramProps {
  /** Fraction 0-1, same value the threshold slider drives. */
  ratio: number;
  /** gapBar: candles clear of the EMA line vs. still touching it. bias: closes above vs. below it. */
  mode: 'gapBar' | 'bias';
}

const CANDLE_COUNT = 6;
const LINE_Y = 28;

// A dashed EMA line with a row of mini candles whose relationship to it changes with the
// threshold: in gapBar mode, more candles pull clear of the line (Brooks "gap bar" — strong
// trend); in bias mode, more candles simply close on one side of it ("always-in" bias).
export function EmaInteractionDiagram({ ratio, mode }: EmaInteractionDiagramProps) {
  const highlighted = Math.round(Math.max(0, Math.min(1, ratio)) * CANDLE_COUNT);
  const barWidth = 5;
  const gap = 3;
  const startX = 5;

  return (
    <svg width={56} height={56} viewBox="0 0 56 56" className="shrink-0">
      <line x1={2} y1={LINE_Y} x2={54} y2={LINE_Y} stroke="#9ca3af" strokeWidth={1} strokeDasharray="3 2" />
      {Array.from({ length: CANDLE_COUNT }, (_, i) => {
        const x = startX + i * (barWidth + gap);
        const isHighlighted = i < highlighted;
        let top: number, bottom: number, fill: string, stroke: string;

        if (mode === 'gapBar') {
          if (isHighlighted) {
            const above = i % 2 === 0;
            top = above ? 12 : 32;
            bottom = above ? 22 : 42;
          } else {
            top = 20;
            bottom = 36;
          }
          fill = isHighlighted ? '#c7d2fe' : '#e5e7eb';
          stroke = isHighlighted ? '#6366f1' : '#9ca3af';
        } else {
          top = isHighlighted ? 12 : 30;
          bottom = isHighlighted ? 26 : 44;
          fill = isHighlighted ? '#c7d2fe' : '#fecaca';
          stroke = isHighlighted ? '#6366f1' : '#ef4444';
        }

        return <rect key={i} x={x} y={top} width={barWidth} height={bottom - top} fill={fill} stroke={stroke} strokeWidth={0.75} />;
      })}
    </svg>
  );
}
