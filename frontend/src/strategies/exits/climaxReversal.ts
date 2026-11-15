/**
 * Climax Reversal Exit — the patient version of Climax Profit (./climax.ts).
 *
 * Climax Profit books the trade AT the close of the oversized bar. This one lets the big bar
 * print, then waits for the first sign the market is turning: a bar closing against the trade
 * within `climaxReversalWindow` bars of the climax.
 *
 * ── Rules ────────────────────────────────────────────────────────────────────
 *
 *   • climax bar  — an in-trade bar (after the entry bar, before the current bar) whose range
 *                   ≥ `climaxReversalMultiple` × the mean range of the `climaxExitLookback`
 *                   bars before it. Direction ignored: for or against the trade both arm it
 *   • reversal    — the CURRENT bar closes against the trade (bear bar for a long, bull bar
 *                   for a short), at most `climaxReversalWindow` bars after the climax bar
 *   • in profit   — open points at the bar's close > 0; losers are left to the stop
 *
 * The climax bar itself never exits — the scan starts one bar before the current one.
 *
 * Second rule, same guards: the double top / bottom reversal from climax.ts, unchanged.
 */
import type { ExitHook, ExitHookContext, ExitHookResult } from '../../utils/exitHook';
import { climaxReversalSettings, doubleTopReason, isClimaxBar } from './climax';
import { legDecayExit } from './legDecay';

function climaxReversalReason(ctx: ExitHookContext): string | null {
  const { candles, index, candle, position, absoluteIndex } = ctx;
  if (position.entryBarIndex === null) return null;

  const against = position.side === 'long' ? candle.close < candle.open : candle.close > candle.open;
  if (!against) return null;

  const { lookback, multiple, window } = climaxReversalSettings(ctx.config);
  const entryLocal = index - (absoluteIndex - position.entryBarIndex);
  const stop = Math.max(entryLocal + 1, index - window, 0);
  for (let k = index - 1; k >= stop; k--) {
    const ratio = isClimaxBar(candles, k, lookback, multiple);
    if (ratio === null) continue;
    const dir = candles[k].close >= candles[k].open ? 'bull' : 'bear';
    return `climax reversal: ${ratio.toFixed(1)}x ${dir} bar ${index - k} bars ago, ` +
      `${position.side === 'long' ? 'bear' : 'bull'} reversal bar, booked ${position.openPoints.toFixed(2)} pts`;
  }
  return null;
}

export const climaxReversalExit: ExitHook = ctx => {
  const { position } = ctx;
  if (position.barsInTrade === null || position.barsInTrade < 1) return false;
  if (position.openPoints <= 0) return false;

  const reason = climaxReversalReason(ctx) ?? doubleTopReason(ctx);
  return reason ? { reason } : false;
};

/** Climax Reversal first, then Leg Decay — a regime holds only one exit hook. */
export const legDecayWithClimaxReversal: ExitHook = ctx => {
  const r: ExitHookResult = climaxReversalExit(ctx);
  if (r) return r;
  return legDecayExit(ctx);
};
