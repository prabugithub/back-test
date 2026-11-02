// EXPERIMENTAL chart layer — pivot market structure (utils/marketStructure) drawn as
// translucent bands like the hand sketch: red = down, blue = range, green = up, a vertical
// separator at each structure change, the range box edges, and the trend's protected level.
//
// Read-only: draws onto the custom-render canvas, never writes store state or markers.
// Rendered only while the 'marketStructure' indicator is toggled on.

import type { IChartApi, ISeriesApi, SeriesType } from 'lightweight-charts';
import type { Candle } from '../../types';
import { STRUCTURE_SUB_LABELS, type StructureSegment } from '../../utils/marketStructure';

const COLORS = {
  up: { fill: 'rgba(22,163,74,0.08)', stroke: '#16a34a' },
  down: { fill: 'rgba(220,38,38,0.08)', stroke: '#dc2626' },
  range: { fill: 'rgba(37,99,235,0.07)', stroke: '#2563eb' },
} as const;

function label(s: StructureSegment): string {
  const broad = s.broad === 'up' ? 'UP' : s.broad === 'down' ? 'DOWN' : 'RANGE';
  const sub = s.sub ? ` · ${STRUCTURE_SUB_LABELS[s.sub]}` : '';
  const attempt = s.breakoutAttempt ? ` → ${s.breakoutAttempt === 'up' ? 'UP' : 'DOWN'}?` : '';
  return `${broad}${attempt}${sub}`;
}

export function drawMarketStructure(
  ctx: CanvasRenderingContext2D,
  chart: IChartApi,
  series: ISeriesApi<SeriesType>,
  candles: Candle[],
  segments: StructureSegment[],
): void {
  if (segments.length === 0) return;
  const dpr = window.devicePixelRatio || 1;
  const width = ctx.canvas.width / dpr;
  const height = ctx.canvas.height / dpr;
  const timeScale = chart.timeScale();
  const barSpacing = (timeScale.options() as { barSpacing?: number }).barSpacing || 6;
  const pad = barSpacing / 2;

  ctx.save();
  let prevSegmentId = -1;
  for (const s of segments) {
    const a = candles[s.startIndex];
    const b = candles[s.endIndex];
    if (!a || !b) continue;
    const x1 = timeScale.timeToCoordinate(a.timestamp as never);
    const x2 = timeScale.timeToCoordinate(b.timestamp as never);
    if (x1 === null || x2 === null) { prevSegmentId = s.segmentId; continue; }
    const left = x1 - pad;
    const right = x2 + pad;
    if (right < 0 || left > width) { prevSegmentId = s.segmentId; continue; }
    const c = COLORS[s.broad];

    // Band
    ctx.fillStyle = c.fill;
    ctx.fillRect(left, 0, right - left, height);

    // Open breakout attempt — the range band hatched in the attempt's colour.
    if (s.breakoutAttempt) {
      const h = COLORS[s.breakoutAttempt];
      ctx.save();
      ctx.beginPath();
      ctx.rect(left, 0, right - left, height);
      ctx.clip();
      ctx.strokeStyle = h.fill.replace(/0\.0\d\)/, '0.3)');
      ctx.lineWidth = 1;
      for (let x = left - height; x < right; x += 10) {
        ctx.beginPath();
        ctx.moveTo(x, height);
        ctx.lineTo(x + height, 0);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Separator at a structure change (new segment), like the sketch's red verticals.
    if (s.segmentId !== prevSegmentId && prevSegmentId !== -1) {
      ctx.strokeStyle = c.stroke;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(left, 0);
      ctx.lineTo(left, height);
      ctx.stroke();
    }
    prevSegmentId = s.segmentId;

    // Range box edges / protected trend level, across this run only.
    const hline = (price: number | null, dash: number[]) => {
      if (price === null) return;
      const y = series.priceToCoordinate(price);
      if (y === null) return;
      ctx.setLineDash(dash);
      ctx.beginPath();
      ctx.moveTo(Math.max(0, left), y);
      ctx.lineTo(Math.min(width, right), y);
      ctx.stroke();
    };
    ctx.strokeStyle = c.stroke;
    ctx.lineWidth = 1;
    if (s.broad === 'range') {
      hline(s.rangeHigh, [5, 3]);
      hline(s.rangeLow, [5, 3]);
    } else {
      hline(s.keyLevel, [2, 3]);
    }
    ctx.setLineDash([]);

    // Labels — only where the run is wide enough to read.
    ctx.fillStyle = c.stroke;
    ctx.font = 'bold 10px Inter, sans-serif';
    ctx.textAlign = 'left';
    if (right - left > 60) ctx.fillText(label(s), Math.max(2, left + 3), 26);
    if (s.transitionReason === 'failed-breakout' && right - left > 40) {
      ctx.font = '9px Inter, sans-serif';
      ctx.fillText('✕ failed BO', Math.max(2, left + 3), 38);
    }
  }
  ctx.restore();
}
