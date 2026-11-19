// Swing points from the engine's pivots: alternated, re-anchored to the true extreme of each
// swing, and optionally raised to higher degrees (swing of swings). Shared by the trendline
// finder and the hook contexts' ctx.swings().
//
// Pure moves of what used to live privately in trendlines.ts — a change here moves the
// trendlines, ctx.swings() and every hook that reads it (e.g. the double top/bottom exit).

import type { Candle } from '../../types';
import type { PivotPoint } from '../indicators';
import type { SwingPoint } from './types';

/** In-place mergePoint without a cap — consecutive same-type points keep the more extreme. */
export function pushMerged(out: SwingPoint[], sp: SwingPoint): void {
  const last = out[out.length - 1];
  if (!last || last.type !== sp.type) out.push(sp);
  else if (sp.type === 'high' ? sp.price > last.price : sp.price < last.price) out[out.length - 1] = sp;
}

/** Engine pivots → alternating swing points at the pivots' own (signal-bar) prices. */
export function pivotsToSwings(pivots: readonly PivotPoint[]): SwingPoint[] {
  const raw: SwingPoint[] = [];
  for (const pv of pivots) {
    pushMerged(raw, {
      type: pv.type === 'bearish' ? 'high' : 'low',
      price: pv.price, barIndex: pv.barIndex, time: pv.time, label: pv.trendLabel,
    });
  }
  return raw;
}

/**
 * Re-anchor each swing point to the true extreme of its swing. A pivot's price is its signal
 * bar's low/high, which can sit a bar or two after the real turn; the extreme between the
 * previous opposite point and the pivot's own bar is fully known by then, so this stays
 * look-ahead safe. The first raw point only serves as the anchor and is not returned.
 *
 * Zigzag repair: each point is searched from the previous point's RE-ANCHORED bar, and the
 * previous point moves forward when price went further its way before this swing's extreme.
 * The pivot detector can skip a turn — e.g. a gap-down low followed by a rally fires the
 * next HIGH pivot with no low in between — and that low is often the major one.
 */
export function reanchorSwings(candles: readonly Candle[], raw: readonly SwingPoint[]): SwingPoint[] {
  const out: SwingPoint[] = [];
  if (raw.length === 0) return out;

  // Most extreme high (low) over bars [from, to], starting from `init`.
  const ext = (high: boolean, from: number, to: number, init: { price: number; bar: number }) => {
    let { price, bar } = init;
    for (let x = from; x <= to; x++) {
      const v = high ? candles[x].high : candles[x].low;
      if (high ? v > price : v < price) { price = v; bar = x; }
    }
    return { price, bar };
  };
  const at = (p: SwingPoint, e: { price: number; bar: number }): SwingPoint =>
    ({ ...p, price: e.price, barIndex: e.bar, time: candles[e.bar].timestamp });

  let prev = raw[0];
  for (let k = 1; k < raw.length; k++) {
    const p = raw[k];
    const high = p.type === 'high';
    let cur = ext(high, prev.barIndex + 1, p.barIndex, { price: p.price, bar: p.barIndex });
    const further = ext(!high, prev.barIndex + 1, cur.bar - 1, { price: prev.price, bar: prev.barIndex });
    if (further.bar !== prev.barIndex) {
      prev = at(prev, further);
      if (out.length) out[out.length - 1] = prev;
      cur = ext(high, prev.barIndex + 1, p.barIndex, { price: p.price, bar: p.barIndex });
    }
    prev = at(p, cur);
    out.push(prev);
  }
  return out;
}

/** One degree up: keep a high (low) only if it is above (below) the previous same-type point
 *  and at least as high (low) as the next one — a swing of swings. Needing the NEXT point
 *  makes it confirmed by data already on the chart, so it stays look-ahead safe; the newest
 *  point of each type waits until the following one prints. Re-alternated with pushMerged. */
export function raiseDegree(points: readonly SwingPoint[]): SwingPoint[] {
  const keep = new Set<SwingPoint>();
  for (const type of ['high', 'low'] as const) {
    const same = points.filter(p => p.type === type);
    for (let i = 1; i + 1 < same.length; i++) {
      const [a, p, b] = [same[i - 1], same[i], same[i + 1]];
      if (type === 'high' ? p.price > a.price && p.price >= b.price : p.price < a.price && p.price <= b.price) keep.add(p);
    }
  }
  const out: SwingPoint[] = [];
  for (const p of points) if (keep.has(p)) pushMerged(out, p);
  return out;
}

/** Re-anchored swing points per degree (index 0 = degree 1), uncut. */
export function swingLevels(candles: readonly Candle[], pivots: readonly PivotPoint[], degree: number): SwingPoint[][] {
  const levels = [reanchorSwings(candles, pivotsToSwings(pivots))];
  for (let d = 1; d < degree; d++) levels.push(raiseDegree(levels[d - 1]));
  return levels;
}
