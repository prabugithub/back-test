interface BreakCountDiagramProps {
  /** Threshold count of new-high/new-low bars, same units as the slider (0-20). */
  count: number;
}

const DISPLAY_BARS = 8;
// Fixed pseudo-heights so the strip always reads as "candles", not a bar chart.
const HEIGHTS = [14, 22, 10, 26, 16, 20, 12, 24];

// Row of mini candles with an up-chevron over however many of them the current threshold
// would require to be "new highs" — illustrates "how many bars in the recent window need
// a fresh high" without needing to be pixel-accurate to the real lookback window.
export function BreakCountDiagram({ count }: BreakCountDiagramProps) {
  const highlighted = Math.round(Math.max(0, Math.min(20, count)) / 20 * DISPLAY_BARS);
  const barWidth = 4;
  const gap = 2.5;
  const startX = 4;
  const baseline = 44;

  return (
    <svg width={56} height={56} viewBox="0 0 56 56" className="shrink-0">
      <line x1={2} y1={baseline} x2={54} y2={baseline} stroke="#e5e7eb" strokeWidth={1} />
      {HEIGHTS.map((h, i) => {
        const x = startX + i * (barWidth + gap);
        const isHighlighted = i < highlighted;
        return (
          <g key={i}>
            <rect
              x={x}
              y={baseline - h}
              width={barWidth}
              height={h}
              fill={isHighlighted ? '#c7d2fe' : '#e5e7eb'}
              stroke={isHighlighted ? '#6366f1' : '#9ca3af'}
              strokeWidth={0.75}
            />
            {isHighlighted && (
              <path
                d={`M ${x} ${baseline - h - 3} L ${x + barWidth / 2} ${baseline - h - 7} L ${x + barWidth} ${baseline - h - 3}`}
                fill="none"
                stroke="#6366f1"
                strokeWidth={1.25}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}
