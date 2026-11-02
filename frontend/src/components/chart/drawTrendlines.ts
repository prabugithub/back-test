// Chart layer — major pivot trendlines (utils/marketStructure/trendlines) as of the current
// bar: red = resistance, green = support. The best line per side is solid, the rest dashed;
// dots mark the touches and the label at the right end reads side · touches.
//
// Read-only: draws onto the custom-render canvas, never writes store state or markers.
// Rendered only while the 'trendlines' indicator is toggled on.

import type { IChartApi, ISeriesApi, SeriesType } from 'lightweight-charts';
import type { Candle } from '../../types';
import { trendlinePriceAt, type Trendline, type TrendlineState } from '../../utils/marketStructure';

const COLORS = { resistance: '#dc2626', support: '#16a34a' } as const;

export function drawTrendlines(
  ctx: CanvasRenderingContext2D,
  chart: IChartApi,
  series: ISeriesApi<SeriesType>,
  candles: Candle[],
  state: TrendlineState,
): void {
  const timeScale = chart.timeScale();
  const xOf = (bar: number) => {
    const c = candles[bar];
    return c ? timeScale.timeToCoordinate(c.timestamp as never) : null;
  };
  const end = state.barIndex;
  const xEnd = xOf(end);
  if (xEnd === null) return;

  const draw = (line: Trendline, rank: number) => {
    const x1 = xOf(line.firstBar);
    if (x1 === null) return;
    const y1 = series.priceToCoordinate(trendlinePriceAt(line, line.firstBar));
    const y2 = series.priceToCoordinate(line.priceNow);
    if (y1 === null || y2 === null) return;
    const color = COLORS[line.side];

    ctx.strokeStyle = color;
    ctx.globalAlpha = rank === 0 ? 0.9 : 0.6;
    ctx.lineWidth = rank === 0 ? 2 : 1;
    ctx.setLineDash(rank === 0 ? [] : [6, 4]);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(xEnd, y2);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = color;
    for (const t of line.touchPoints) {
      const x = xOf(t.bar);
      const y = series.priceToCoordinate(t.price);
      if (x === null || y === null) continue;
      ctx.beginPath();
      ctx.arc(x, y, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = 1;
    ctx.font = 'bold 10px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`${line.side === 'resistance' ? 'R' : 'S'}·${line.touches}t`, xEnd + 6, y2 + (line.side === 'resistance' ? -3 : 10));
  };

  ctx.save();
  state.resistance.forEach(draw);
  state.support.forEach(draw);
  ctx.restore();
}
