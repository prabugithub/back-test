// Chart layer — major swing points (utils/marketStructure/swingPoints) as of the current bar,
// at the Swing degree set in Session Settings → Trendlines (pivot). The same points
// ctx.swings(degree) hands to entry/exit hooks: engine pivots re-anchored to the true
// high/low, raised to swings of swings.
//
// A dashed zigzag joins the points; each one gets a ring and an HH / LH (highs, red) or
// HL / LL (lows, green) label against the previous major point of the same type.
//
// Read-only: draws onto the custom-render canvas, never writes store state or markers.
// Rendered only while the 'majorSwings' indicator is toggled on.

import type { IChartApi, ISeriesApi, SeriesType } from 'lightweight-charts';
import type { Candle } from '../../types';
import type { SwingPoint } from '../../utils/marketStructure';

const HIGH = '#dc2626';
const LOW = '#16a34a';
const ZIGZAG = '#7c3aed';

export function drawMajorSwings(
  ctx: CanvasRenderingContext2D,
  chart: IChartApi,
  series: ISeriesApi<SeriesType>,
  candles: Candle[],
  points: readonly SwingPoint[],
): void {
  if (points.length === 0) return;
  const timeScale = chart.timeScale();
  const xy = (p: SwingPoint) => {
    const c = candles[p.barIndex];
    if (!c) return null;
    const x = timeScale.timeToCoordinate(c.timestamp as never);
    const y = series.priceToCoordinate(p.price);
    return x === null || y === null ? null : { x, y };
  };

  ctx.save();

  // Zigzag through the major swings.
  ctx.strokeStyle = ZIGZAG;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  let started = false;
  for (const p of points) {
    const at = xy(p);
    if (!at) { started = false; continue; }
    if (started) ctx.lineTo(at.x, at.y); else { ctx.moveTo(at.x, at.y); started = true; }
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // Ring + structure label per point.
  ctx.globalAlpha = 1;
  ctx.font = 'bold 11px Inter, sans-serif';
  ctx.textAlign = 'center';
  let lastHigh: number | null = null;
  let lastLow: number | null = null;
  for (const p of points) {
    const high = p.type === 'high';
    const prev = high ? lastHigh : lastLow;
    const label = prev === null ? (high ? 'H' : 'L') : high ? (p.price > prev ? 'HH' : 'LH') : (p.price < prev ? 'LL' : 'HL');
    if (high) lastHigh = p.price; else lastLow = p.price;

    const at = xy(p);
    if (!at) continue;
    const color = high ? HIGH : LOW;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(at.x, at.y, 5, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = color;
    // Clear of the pivot-point markers, which sit just beyond the candle.
    ctx.fillText(label, at.x, high ? at.y - 26 : at.y + 34);
  }

  ctx.restore();
}
