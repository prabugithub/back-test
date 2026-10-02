// Pivot-derived primitives: swings between alternating swing points, plus the two
// statistics the classifier needs (median, least-squares slope).

import type { Swing, SwingPoint } from './types';

export function buildSwings(points: readonly SwingPoint[]): Swing[] {
  const out: Swing[] = [];
  for (let k = 1; k < points.length; k++) {
    const from = points[k - 1];
    const to = points[k];
    const size = Math.abs(to.price - from.price);
    out.push({
      from,
      to,
      dir: to.price >= from.price ? 'up' : 'down',
      size,
      bars: to.barIndex - from.barIndex,
      sizePct: from.price > 0 ? (size / from.price) * 100 : 0,
    });
  }
  return out;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  let t = 0;
  for (const v of values) t += v;
  return t / values.length;
}

/** Least-squares line through (barIndex, price). Null with fewer than 2 points. */
export function fitLine(points: readonly SwingPoint[]): { slope: number; at: (bar: number) => number } | null {
  if (points.length < 2) return null;
  const n = points.length;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const p of points) {
    sx += p.barIndex; sy += p.price; sxx += p.barIndex * p.barIndex; sxy += p.barIndex * p.price;
  }
  const den = n * sxx - sx * sx;
  if (den === 0) return null;
  const slope = (n * sxy - sx * sy) / den;
  const intercept = (sy - slope * sx) / n;
  return { slope, at: bar => intercept + slope * bar };
}
