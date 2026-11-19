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
 * (Session Settings → Double Top Gap / Max Gap / Tol / Reversal).
 */
import type { ExitHook, ExitHookContext, ExitHookResult } from '../../utils/exitHook';
import type { SwingPoint } from '../../utils/marketStructure';
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
  /** Most bars between them — how far back the first top / bottom is searched. */
  doubleTopMaxGap: 500,
  /** How far apart the two tops / bottoms may be and still count as the same level, as a
   *  fraction of the pattern's height (higher top → neckline). */
  doubleTopTolFrac: 0.2,
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

export function climaxExitSettings(ctx: ExitHookContext): { lookback: number; multiple: number } {
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
  doubleTopMinGap?: number; doubleTopMaxGap?: number; doubleTopTolFrac?: number; doubleTopReversalFrac?: number;
}): { minGap: number; maxGap: number; tolFrac: number; reversalFrac: number } {
  const d = DEFAULT_CLIMAX_EXIT;
  const pos = (v: number | undefined, def: number) => (Number.isFinite(v) && (v as number) > 0 ? (v as number) : def);
  const minGap = Number.isFinite(c.doubleTopMinGap) ? Math.max(2, Math.floor(c.doubleTopMinGap as number)) : d.doubleTopMinGap;
  const maxGap = Number.isFinite(c.doubleTopMaxGap) ? Math.floor(c.doubleTopMaxGap as number) : d.doubleTopMaxGap;
  return {
    minGap,
    maxGap: Math.max(minGap, maxGap),
    tolFrac: pos(c.doubleTopTolFrac, d.doubleTopTolFrac),
    reversalFrac: pos(c.doubleTopReversalFrac, d.doubleTopReversalFrac),
  };
}

/** Climax rule: the current bar's range against the mean of the bars before it. */
function climaxReason(ctx: ExitHookContext): string | null {
  const { candles, index, position } = ctx;
  const { lookback, multiple } = climaxExitSettings(ctx);
  // Needs a full baseline window before the current bar; a short history is not evidence.
  const ratio = isClimaxBar(candles, index, lookback, multiple);
  if (ratio === null) return null;
  return `climax: ${ratio.toFixed(1)}x avg range (${lookback} bars), booked ${position.openPoints.toFixed(2)} pts`;
}

/**
 * A double top (top = true) or double bottom (top = false), in a mirrored price space: `x1` /
 * `x2` / `neckX` are highs and lows for a top, NEGATED lows and highs for a bottom — in that
 * space a double bottom IS a double top. `price` converts back. Bar indices are absolute.
 */
export interface DoubleTop {
  top1: number; top2: number; x1: number; x2: number; neckX: number; height: number;
  price(v: number): number;
}

/**
 * The double top / bottom whose SECOND top is the swing point `points[j]`, or null.
 *
 * `points` are re-anchored swing points (ctx.swings()), so every top sits on a bar's true
 * high (low). Only points of the pattern's type are read.
 *
 *   • top 1  — the nearest earlier same-type swing point `minGap`..`maxGap` bars before top 2
 *              that no bar between the two goes beyond, and within `tolFrac` × height of it
 *              (height = higher top → neck). A second top that falls a little short of the
 *              first, or undercuts it a little, both count
 *   • neck   — the deepest opposite extreme strictly between the two tops
 */
export function findDoubleTop(
  candles: readonly { high: number; low: number }[], points: readonly SwingPoint[], j: number,
  top: boolean, minGap: number, maxGap: number, tolFrac: number,
): DoubleTop | null {
  const want = top ? 'high' : 'low';
  if (j < 0 || j >= points.length || points[j].type !== want || !(tolFrac > 0)) return null;
  const x = (k: number) => (top ? candles[k].high : -candles[k].low);
  const y = (k: number) => (top ? candles[k].low : -candles[k].high);

  const top2 = points[j].barIndex;
  const x2 = x(top2);
  // Running extremes of the bars strictly between the candidate and top 2, widened as the
  // scan walks back so each bar is read once.
  let beyond = -Infinity;
  let neck = Infinity;
  let cursor = top2 - 1;
  for (let i = j - 1; i >= 0; i--) {
    if (points[i].type !== want) continue;
    const top1 = points[i].barIndex;
    const gap = top2 - top1;
    if (gap > maxGap) break;
    for (; cursor > top1; cursor--) { beyond = Math.max(beyond, x(cursor)); neck = Math.min(neck, y(cursor)); }
    if (gap < minGap) continue;
    const x1 = x(top1);
    const hi = Math.max(x1, x2);
    if (beyond > hi) continue; // a bar between took out the level — not two tests of it
    const height = hi - neck;
    if (!(height > 0) || Math.abs(x1 - x2) > tolFrac * height) continue;
    return { top1, top2, x1, x2, neckX: neck, height, price: v => (top ? v : -v) };
  }
  return null;
}

/**
 * Double top against a long, double bottom against a short (see `findDoubleTop`).
 *
 *   • top 2  — an in-trade swing point (at or after the entry bar) that no later bar has gone
 *              beyond. Tried newest first, so a higher low printed after the real second
 *              bottom does not hide it
 *   • strong — this bar closes against the trade (bear bar for a long) and has retraced at
 *              least `doubleTopReversalFrac` of the way from top 2 to the neck
 *
 * Swings come from the engine's pivots (ctx.swings(1)), re-anchored to the true extreme, so
 * no ATR is involved: the level tolerance scales with the pattern itself.
 */
export function doubleTopReason(ctx: ExitHookContext): string | null {
  const { fullCandles: candles, absoluteIndex: now, candle, position } = ctx;
  if (position.entryBarIndex === null) return null;
  const { minGap, maxGap, tolFrac, reversalFrac } = doubleTopSettings(ctx.config);

  const isLong = position.side === 'long';
  const want = isLong ? 'high' : 'low';
  const x = (k: number) => (isLong ? candles[k].high : -candles[k].low);
  const closeX = isLong ? candle.close : -candle.close;
  const openX = isLong ? candle.open : -candle.open;
  if (closeX >= openX) return null;

  const points = ctx.swings(1);
  // Most extreme x of the bars after each candidate, built newest-first alongside the scan.
  let after = -Infinity;
  let cursor = now;
  for (let j = points.length - 1; j >= 0; j--) {
    const p = points[j];
    if (p.barIndex < position.entryBarIndex) break;
    if (p.type !== want) continue;
    for (; cursor > p.barIndex; cursor--) after = Math.max(after, x(cursor));
    if (after > x(p.barIndex)) continue; // broken since, or a newer extreme is still forming

    const dt = findDoubleTop(candles, points, j, isLong, minGap, maxGap, tolFrac);
    if (!dt) continue;
    const swing = dt.x2 - dt.neckX;
    if (!(swing > 0)) continue;
    const retrace = (dt.x2 - closeX) / swing;
    if (retrace < reversalFrac) continue;

    const level = (v: number) => dt.price(v).toFixed(2);
    const name = isLong ? 'double top' : 'double bottom';
    return `${name}: ${level(dt.x1)} / ${level(dt.x2)} (${dt.top2 - dt.top1} bars apart), ` +
      `reversed ${(retrace * 100).toFixed(0)}% to neck ${level(dt.neckX)}, booked ${position.openPoints.toFixed(2)} pts`;
  }
  return null;
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
