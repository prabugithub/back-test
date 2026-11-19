/**
 * Double Top / Bottom Guard — don't fade an unconfirmed double top or bottom. Gate mode, both sides.
 *
 * The Climax Profit / Climax Reversal exits book a short on a strong reversal off a DOUBLE
 * BOTTOM and a long off a DOUBLE TOP. This hook is the entry-side follow-up:
 *
 *   • long trigger  — blocked while a double bottom has reversed strongly and no bar has yet
 *                     CLOSED above its neckline (the high between the two bottoms)
 *   • short trigger — blocked while a double top has reversed strongly and no bar has yet
 *                     closed below its neckline (the low between the two tops)
 *
 * The bar that closes through the neckline is itself allowed to enter. Only the trigger's side
 * is checked: shorts are never blocked by a double bottom, longs never by a double top.
 *
 * Same pattern as the exit (`findDoubleTop` in exits/climax.ts) and the same Session Settings:
 * Double Top Gap / Max Gap / Tol / Reversal. "Strong reversal" = a bar after the second
 * bottom (top), closing away from it, that has retraced at least Double Top Reversal of the
 * way to the neckline, with no bar before it going beyond the second bottom (top).
 *
 * Only the NEWEST pattern that has reversed is judged — a newer double bottom replaces an older
 * one, the way a newer exit would. Patterns come from ctx.swings(1), so they must sit inside
 * the Entry Hook Candles window. An entry hook cannot see trades, so this blocks after any such
 * reversal, whether or not a trade was open and exited on it.
 */
import type { EntryHook } from '../utils/entryHook';
import type { SwingPoint } from '../utils/marketStructure';
import { doubleTopSettings, findDoubleTop } from './exits/climax';
import { probe } from './debug';

interface Candleish { open: number; high: number; low: number; close: number }

export interface DoubleTopGuardRead {
  blocked: boolean;
  reason: string;
  /** Neckline price of the judged pattern, or null when none has reversed. */
  neck: number | null;
}

/**
 * Pure verdict for a trigger at bar `now` (absolute). `long` = the trigger side: a long is
 * judged against double BOTTOMS, a short against double TOPS. Reads no bar after `now`.
 */
export function doubleTopGuardRead(
  candles: readonly Candleish[], points: readonly SwingPoint[], now: number, long: boolean,
  s: { minGap: number; maxGap: number; tolFrac: number; reversalFrac: number },
): DoubleTopGuardRead {
  // Mirrored space as in findDoubleTop: for a double top x = price; for a double bottom x = −price.
  // `top` is the pattern type that blocks this side.
  const top = !long;
  const want = top ? 'high' : 'low';
  const x = (k: number) => (top ? candles[k].high : -candles[k].low);
  const cx = (k: number) => (top ? candles[k].close : -candles[k].close);
  const ox = (k: number) => (top ? candles[k].open : -candles[k].open);
  const name = top ? 'double top' : 'double bottom';

  for (let j = points.length - 1; j >= 0; j--) {
    const p = points[j];
    if (p.type !== want || p.barIndex >= now) continue;
    const dt = findDoubleTop(candles, points, j, top, s.minGap, s.maxGap, s.tolFrac);
    if (!dt) continue;
    const swing = dt.x2 - dt.neckX;
    if (!(swing > 0)) continue;

    // First strong reversal bar after the second top/bottom, before any bar goes beyond it.
    let rev = -1;
    for (let k = dt.top2 + 1; k <= now; k++) {
      if (x(k) > dt.x2) break; // second top/bottom taken out first — not a reversal off it
      if (cx(k) < ox(k) && (dt.x2 - cx(k)) / swing >= s.reversalFrac) { rev = k; break; }
    }
    if (rev < 0) continue;

    const neck = dt.price(dt.neckX);
    const level = (v: number) => dt.price(v).toFixed(2);
    // Neckline break = a close beyond it, from the reversal bar through the trigger bar.
    for (let k = rev; k <= now; k++) {
      if (cx(k) < dt.neckX) {
        return { blocked: false, neck, reason: `${name} ${level(dt.x1)}/${level(dt.x2)} neck ${level(dt.neckX)} broken` };
      }
    }
    return {
      blocked: true,
      neck,
      reason: `${name} ${level(dt.x1)}/${level(dt.x2)} reversed ${now - rev} bars ago, ` +
        `${long ? 'long' : 'short'} blocked until close ${long ? '>' : '<'} neck ${level(dt.neckX)}`,
    };
  }
  return { blocked: false, neck: null, reason: `no ${name} pending` };
}

export const doubleTopGuard: EntryHook = ctx => {
  const long = ctx.trigger.side === 'long';
  const v = doubleTopGuardRead(ctx.fullCandles, ctx.swings(1), ctx.absoluteIndex, long, doubleTopSettings(ctx.config));
  probe(ctx, { dtBlocked: v.blocked, dtNeck: v.neck, dtReason: v.reason });
  if (v.blocked) return false;
  ctx.log(v.reason);
  return true;
};
