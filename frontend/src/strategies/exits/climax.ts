/**
 * Climax Profit Exit — book the profit when an oversized candle prints.
 *
 * A bar whose range is several times the recent average is usually the END of a move, not
 * the start of one: a buy climax in a long, a sell climax in a short, or a violent bar
 * against the trade. Either way the open profit is at its most exposed, so this hook takes
 * it at that bar's close. Works the same for longs and shorts.
 *
 * ── Rules ────────────────────────────────────────────────────────────────────
 *
 *   • big bar   — range (high − low) ≥ `climaxExitMultiple` × the mean range of the
 *                 `climaxExitLookback` bars BEFORE it (Session Settings → Climax Exit)
 *   • in profit — open points at the bar's close > 0. A climax against a losing trade is
 *                 left to the stop: this hook books profit, it does not cut losses
 *   • not the entry bar — the bar that opened the trade is never judged
 *
 * Bar direction is deliberately ignored: a 4x bar for or against the trade both say the
 * move is spent or turning.
 */
import type { ExitHook, ExitHookContext, ExitHookResult } from '../../utils/exitHook';
import { legDecayExit } from './legDecay';

/**
 * Fallbacks for the optional `AutoBacktestConfig.climaxExit*` fields, shared with Session
 * Settings. Lives here rather than in autoBacktestEngine.ts because the engine imports the
 * exit registry — a value import back into it would be a module cycle.
 */
export const DEFAULT_CLIMAX_EXIT = {
  /** Prior bars averaged into the baseline range. */
  climaxExitLookback: 20,
  /** Current bar range ÷ baseline range at or above which the bar is a climax. */
  climaxExitMultiple: 4,
} as const;

function settings(ctx: ExitHookContext): { lookback: number; multiple: number } {
  const c = ctx.config;
  const d = DEFAULT_CLIMAX_EXIT;
  const lb = c.climaxExitLookback;
  const mult = c.climaxExitMultiple;
  return {
    lookback: Number.isFinite(lb) ? Math.max(2, Math.floor(lb as number)) : d.climaxExitLookback,
    multiple: Number.isFinite(mult) && (mult as number) > 1 ? (mult as number) : d.climaxExitMultiple,
  };
}

export const climaxProfitExit: ExitHook = ctx => {
  const { position, candles, index, candle } = ctx;
  if (position.barsInTrade === null || position.barsInTrade < 1) return false;
  if (position.openPoints <= 0) return false;

  const { lookback, multiple } = settings(ctx);
  // Need a full baseline window before the current bar; a short history is not evidence.
  if (index < lookback) return false;

  let sum = 0;
  for (let k = index - lookback; k < index; k++) sum += candles[k].high - candles[k].low;
  const avgRange = sum / lookback;
  if (avgRange <= 0) return false;

  const ratio = (candle.high - candle.low) / avgRange;
  if (ratio < multiple) return false;

  return {
    reason: `climax: ${ratio.toFixed(1)}x avg range (${lookback} bars), booked ${position.openPoints.toFixed(2)} pts`,
  };
};

/** Climax profit exit first, then Leg Decay — so adding the climax rule does not cost the
 *  regime its existing decay exit (a regime holds only one exit hook). */
export const legDecayWithClimax: ExitHook = ctx => {
  const climax: ExitHookResult = climaxProfitExit(ctx);
  if (climax) return climax;
  return legDecayExit(ctx);
};
