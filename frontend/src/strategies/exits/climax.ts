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
 *
 * Second rule, same guards: a DOUBLE TOP that reverses strongly closes an in-profit long, a
 * DOUBLE BOTTOM closes an in-profit short. See `doubleTopReason` for the exact definition
 * (Session Settings → Double Top Gap / Tol ATR / Reversal).
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
  /** Fewest bars between the two tops / bottoms of a double top / bottom. */
  doubleTopMinGap: 25,
  /** How far apart the two tops / bottoms may be and still count as the same level, in ATR. */
  doubleTopTolAtr: 0.5,
  /** Strong reversal: fraction of the way from the second top back to the neckline the
   *  close must have travelled (1 = a neckline break). */
  doubleTopReversalFrac: 0.5,
  /** Climax Reversal exit: bar range ÷ baseline for the climax bar. */
  climaxReversalMultiple: 4.5,
  /** Same two hooks: most bars after the climax bar in which the reversal still counts. */
  climaxReversalWindow: 20,
} as const;

/**
 * Range ratio of `candles[k]` against the mean range of the `lookback` bars before it, or
 * null when there is no full baseline, the baseline is flat, or the ratio is below `multiple`.
 */
export function isClimaxBar(
  candles: readonly { high: number; low: number }[], k: number, lookback: number, multiple: number,
): number | null {
  if (k < lookback || k >= candles.length) return null;
  let sum = 0;
  for (let j = k - lookback; j < k; j++) sum += candles[j].high - candles[j].low;
  const avgRange = sum / lookback;
  if (avgRange <= 0) return null;
  const ratio = (candles[k].high - candles[k].low) / avgRange;
  return ratio >= multiple ? ratio : null;
}

/** Settings of the Climax Reversal exit. The
 *  baseline lookback is the existing Climax Lookback. */
export function climaxReversalSettings(c: {
  climaxExitLookback?: number; climaxReversalMultiple?: number; climaxReversalWindow?: number;
}): { lookback: number; multiple: number; window: number } {
  const d = DEFAULT_CLIMAX_EXIT;
  const lb = c.climaxExitLookback, mult = c.climaxReversalMultiple, win = c.climaxReversalWindow;
  return {
    lookback: Number.isFinite(lb) ? Math.max(2, Math.floor(lb as number)) : d.climaxExitLookback,
    multiple: Number.isFinite(mult) && (mult as number) > 1 ? (mult as number) : d.climaxReversalMultiple,
    window: Number.isFinite(win) ? Math.max(1, Math.floor(win as number)) : d.climaxReversalWindow,
  };
}

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

export function doubleTopSettings(c: {
  doubleTopMinGap?: number; doubleTopTolAtr?: number; doubleTopReversalFrac?: number;
}): { minGap: number; tolAtr: number; reversalFrac: number } {
  const d = DEFAULT_CLIMAX_EXIT;
  const pos = (v: number | undefined, def: number) => (Number.isFinite(v) && (v as number) > 0 ? (v as number) : def);
  return {
    minGap: Number.isFinite(c.doubleTopMinGap) ? Math.max(2, Math.floor(c.doubleTopMinGap as number)) : d.doubleTopMinGap,
    tolAtr: pos(c.doubleTopTolAtr, d.doubleTopTolAtr),
    reversalFrac: pos(c.doubleTopReversalFrac, d.doubleTopReversalFrac),
  };
}

/** Climax rule: the current bar's range against the mean of the bars before it. */
function climaxReason(ctx: ExitHookContext): string | null {
  const { candles, index, position } = ctx;
  const { lookback, multiple } = settings(ctx);
  // Needs a full baseline window before the current bar; a short history is not evidence.
  const ratio = isClimaxBar(candles, index, lookback, multiple);
  if (ratio === null) return null;
  return `climax: ${ratio.toFixed(1)}x avg range (${lookback} bars), booked ${position.openPoints.toFixed(2)} pts`;
}

/**
 * Double top against a long, double bottom against a short.
 *
 * Written once for the TOP case in a mirrored price space: `x` is the bar's extreme in the
 * trade's favour (high for a long, −low for a short) and `y` its other end (low / −high).
 * In that space a double bottom IS a double top, so one scan serves both sides.
 *
 *   • top 2  — the trade's best extreme since entry (so the second test happened in-trade)
 *   • top 1  — the nearest earlier swing extreme (beats both neighbours) at least
 *              `doubleTopMinGap` bars before top 2, within `doubleTopTolAtr` × ATR of it;
 *              the scan stops at any bar beyond top 2 + tolerance, so nothing in between
 *              may take out the level
 *   • neck   — the deepest opposite extreme between the two tops; the pattern must be at
 *              least two tolerances tall, or it is a flat range rather than two tests
 *   • strong — this bar closes against the trade (bear bar for a long) and has retraced at
 *              least `doubleTopReversalFrac` of the way from top 2 to the neck
 */
/**
 * A double top (top = true) or double bottom (top = false) whose SECOND top is bar `top2`,
 * in the mirrored price space described on `doubleTopReason`: `x1` / `x2` / `neckX` are
 * highs and lows for a top, NEGATED lows and highs for a bottom. `price` converts back.
 *
 *   • top 1 — the nearest earlier swing extreme ≥ `minGap` bars before `top2`, within `tol`
 *             of it; the scan stops at any bar beyond top 2 + tol
 *   • neck  — deepest opposite extreme between them; the pattern must be ≥ 2 × tol tall
 */
export interface DoubleTop {
  top1: number; top2: number; x1: number; x2: number; neckX: number; height: number;
  price(v: number): number;
}

export function findDoubleTopAt(
  candles: readonly { high: number; low: number }[], top2: number, top: boolean, minGap: number, tol: number,
): DoubleTop | null {
  if (top2 < 0 || top2 >= candles.length || !(tol > 0)) return null;
  const x = (k: number) => (top ? candles[k].high : -candles[k].low);
  const y = (k: number) => (top ? candles[k].low : -candles[k].high);

  let top1 = -1;
  for (let k = top2 - 1; k >= 0; k--) {
    if (x(k) > x(top2) + tol) break;
    if (top2 - k < minGap || Math.abs(x(k) - x(top2)) > tol) continue;
    const peak = (k === 0 || x(k) >= x(k - 1)) && x(k) >= x(k + 1);
    if (peak) { top1 = k; break; }
  }
  if (top1 < 0) return null;

  let neck = Infinity;
  for (let k = top1 + 1; k < top2; k++) neck = Math.min(neck, y(k));
  const height = x(top2) - neck;
  if (!Number.isFinite(height) || height < 2 * tol) return null;
  return { top1, top2, x1: x(top1), x2: x(top2), neckX: neck, height, price: v => (top ? v : -v) };
}

export function doubleTopReason(ctx: ExitHookContext): string | null {
  const { candles, index, candle, position, absoluteIndex } = ctx;
  if (position.entryBarIndex === null || ctx.atr <= 0) return null;
  const { minGap, tolAtr, reversalFrac } = doubleTopSettings(ctx.config);
  const tol = tolAtr * ctx.atr;

  const isLong = position.side === 'long';
  const x = (k: number) => (isLong ? candles[k].high : -candles[k].low);

  // ── top 2: best extreme since entry ─────────────────────────────────────────
  const entry = Math.max(0, index - (absoluteIndex - position.entryBarIndex));
  let top2 = entry;
  for (let k = entry + 1; k <= index; k++) if (x(k) > x(top2)) top2 = k;

  // ── top 1, neck, height ─────────────────────────────────────────────────────
  const dt = findDoubleTopAt(candles, top2, isLong, minGap, tol);
  if (!dt) return null;
  const { top1, neckX: neck, height } = dt;

  // ── strong reversal off top 2 ───────────────────────────────────────────────
  const closeX = isLong ? candle.close : -candle.close;
  const openX = isLong ? candle.open : -candle.open;
  if (closeX >= openX) return null;
  const retrace = (x(top2) - closeX) / height;
  if (retrace < reversalFrac) return null;

  const level = (v: number) => (isLong ? v : -v).toFixed(2);
  const name = isLong ? 'double top' : 'double bottom';
  return `${name}: ${level(x(top1))} / ${level(x(top2))} (${top2 - top1} bars apart), ` +
    `reversed ${(retrace * 100).toFixed(0)}% to neck ${level(neck)}, booked ${position.openPoints.toFixed(2)} pts`;
}

export const climaxProfitExit: ExitHook = ctx => {
  const { position } = ctx;
  if (position.barsInTrade === null || position.barsInTrade < 1) return false;
  if (position.openPoints <= 0) return false;

  const reason = climaxReason(ctx) ?? doubleTopReason(ctx);
  return reason ? { reason } : false;
};

/** Climax profit exit first, then Leg Decay — so adding the climax rule does not cost the
 *  regime its existing decay exit (a regime holds only one exit hook). */
export const legDecayWithClimax: ExitHook = ctx => {
  const climax: ExitHookResult = climaxProfitExit(ctx);
  if (climax) return climax;
  return legDecayExit(ctx);
};
