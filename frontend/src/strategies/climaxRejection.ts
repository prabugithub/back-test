/**
 * Climax Rejection Guard — don't sell a bear climax that failed (or buy a failed bull climax).
 *
 * A Gate-mode filter: the regime's own chain decides the trade and this hook can only refuse
 * it. It never changes side, stop, target or quantity. Mirrored per side.
 *
 * Short side, e.g. a bear bar 1050 → 1000:
 *
 *   • climax   — a BEAR bar (close < open) whose range ≥ `climaxReversalMultiple` × the mean
 *                range of the `climaxExitLookback` bars before it (Session Settings → Climax)
 *   • held     — no bar since (up to and including the trigger bar) traded below its low:
 *                the sellers could not extend the move past 1000
 *   • rejected — a BULL bar (close > open) printed after the climax bar
 *   • window   — the climax bar is at most `climaxReversalWindow` bars before the trigger
 *
 * Held + rejected inside the window → the short is blocked. A low below the climax low, or
 * the window running out, lifts the block. Longs mirror on a bull climax bar, its high and a
 * bear bar after it.
 *
 * Look-ahead safe: reads only candles ≤ the trigger bar.
 */
import type { Candle } from '../types';
import type { EntryHook } from '../utils/entryHook';
import { climaxReversalSettings, isClimaxBar } from './exits/climax';
import { probe } from './debug';

export interface ClimaxRejection {
  climaxBar: number;
  ratio: number;
  level: number;      // the climax extreme that held (low for a bear climax, high for a bull one)
  reversalBar: number;
}

/** The newest failed climax against `long` (a bull climax blocks longs, a bear one shorts)
 *  within the window ending at bar `i`, or null. */
export function findClimaxRejection(
  candles: readonly Candle[], i: number, long: boolean, lookback: number, multiple: number, window: number,
): ClimaxRejection | null {
  for (let c = i - 1; c >= Math.max(lookback, i - window); c--) {
    const bar = candles[c];
    if (long ? bar.close <= bar.open : bar.close >= bar.open) continue; // climax must point the trade's way
    const ratio = isClimaxBar(candles, c, lookback, multiple);
    if (ratio === null) continue;

    const level = long ? bar.high : bar.low;
    let held = true, reversalBar = -1;
    for (let x = c + 1; x <= i; x++) {
      const k = candles[x];
      if (long ? k.high > level : k.low < level) { held = false; break; }
      if (reversalBar < 0 && (long ? k.close < k.open : k.close > k.open)) reversalBar = x;
    }
    if (held && reversalBar >= 0) return { climaxBar: c, ratio, level, reversalBar };
  }
  return null;
}

export const climaxRejectionGuard: EntryHook = ctx => {
  const long = ctx.trigger.side === 'long';
  const { lookback, multiple, window } = climaxReversalSettings(ctx.config);
  const r = findClimaxRejection(ctx.fullCandles, ctx.absoluteIndex, long, lookback, multiple, window);
  probe(ctx, {
    crBlocked: r !== null,
    crClimaxBar: r?.climaxBar ?? null,
    crRatio: r ? Number(r.ratio.toFixed(2)) : null,
    crLevel: r?.level ?? null,
    crReversalBar: r?.reversalBar ?? null,
  });
  if (r) return false;
  ctx.log(`climax rejection ok: no failed ${long ? 'bull' : 'bear'} ${multiple}x climax in ${window} bars`);
  return true;
};
