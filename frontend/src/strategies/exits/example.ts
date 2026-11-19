/**
 * Worked reference exit hooks. Copy one, rename it, register it in ./index.ts.
 *
 * ⚠ The one thing to get right before anything else: **an object return EXITS the trade
 * unless it says `exit: false`**. `return { sl: x }` closes the position; `return
 * { exit: false, sl: x }` moves the stop and stays in. The convention mirrors the entry
 * hook's `take`, and it bites exactly once.
 */
import type { ExitHook } from '../../utils/exitHook';

// ─── 1. Breakeven, then ride ──────────────────────────────────────────────────

/** Move the stop to entry once the trade has paid this many multiples of its initial risk. */
const BREAKEVEN_AT_R = 1;
/** Then trail this many ATR behind the best price seen, once breakeven is banked. */
const TRAIL_ATR = 2;
/** Give up on a trade that has gone nowhere after this many bars. */
const STALE_BARS = 20;
/** "Nowhere" — open profit below this fraction of initial risk at the stale bar. */
const STALE_R = 0.3;

interface BreakevenState {
  /** Initial risk in points, captured on the first bar we see each trade. Keyed per trade,
   *  because ctx.state is shared across every open position in multi-trade mode. */
  risk: Record<string, number>;
  armed: Record<string, boolean>;
}

/**
 * Three rules, in the order Brooks would apply them:
 *
 *   1. bank the risk — at +1R the stop goes to entry, so the trade can no longer lose
 *   2. then ride — trail 2 ATR behind the running extreme, ratcheting only
 *   3. and cut the dead ones — a trade still under +0.3R after 20 bars is capital doing
 *      nothing; the market has had its chance
 *
 * Note rule 1 needs the risk taken AT ENTRY, and `ctx.position.riskPoints` is measured
 * against the CURRENT stop — which this hook is about to start moving. So the initial risk is
 * captured once, on the first bar this trade is seen, and kept in `ctx.state`.
 */
export const breakevenThenTrail: ExitHook = ctx => {
  const st = ctx.state as unknown as BreakevenState;
  st.risk ??= {};
  st.armed ??= {};

  const p = ctx.position;
  const key = p.id ?? 'single';

  // Capture initial risk once. On a restored position with no stop there is nothing to
  // measure against, so this hook simply declines to manage it.
  if (st.risk[key] === undefined) {
    if (p.riskPoints === null || p.riskPoints <= 0) return false;
    st.risk[key] = p.riskPoints;
  }
  const risk0 = st.risk[key];
  const rMultiple = p.openPoints / risk0;

  // ── 3. Stale-trade cut, checked first so a flat trade does not sit behind the trail ──
  if (p.barsInTrade !== null && p.barsInTrade >= STALE_BARS && rMultiple < STALE_R) {
    ctx.log(`stale: ${rMultiple.toFixed(2)}R after ${p.barsInTrade} bars`);
    return { reason: 'stale trade' };
  }

  // ── 1. Breakeven ────────────────────────────────────────────────────────────
  if (!st.armed[key]) {
    if (rMultiple < BREAKEVEN_AT_R) return false;
    st.armed[key] = true;
    ctx.log(`breakeven armed at ${rMultiple.toFixed(2)}R`);
    return { exit: false, sl: p.entryPrice };
  }

  // ── 2. ATR trail behind the running extreme ─────────────────────────────────
  // mfePoints is measured intrabar from entry, so entry ± mfe IS the best price seen.
  if (ctx.atr <= 0 || p.mfePoints === null) return false;
  const best = p.side === 'long' ? p.entryPrice + p.mfePoints : p.entryPrice - p.mfePoints;
  const candidate = p.side === 'long' ? best - ctx.atr * TRAIL_ATR : best + ctx.atr * TRAIL_ATR;

  // Ratchet only. Nothing in the engine enforces this for a hook — a hook may widen a stop —
  // so a trail has to refuse to loosen its own.
  if (p.stopLoss !== null) {
    if (p.side === 'long' && candidate <= p.stopLoss) return false;
    if (p.side === 'short' && candidate >= p.stopLoss) return false;
  }
  return { exit: false, sl: candidate };
};

// ─── 2. Time stop ─────────────────────────────────────────────────────────────

/** Close anything still open after this many bars, win or lose. */
const MAX_BARS = 30;

/**
 * The simplest useful exit hook, and a good first thing to read: a hard cap on how long
 * capital stays committed. Pairs well with 'gate' mode — the built-in Reversal and Opposite
 * Signal exits keep doing their job, and this only adds a ceiling on duration.
 */
export const timeStop: ExitHook = ctx => {
  const bars = ctx.position.barsInTrade;
  if (bars === null || bars < MAX_BARS) return false;
  return { reason: `time stop: ${bars} bars` };
};

// ─── 3. Hold through the noise ────────────────────────────────────────────────

/** Veto a built-in exit while the trade is still paying at least this many R. */
const VETO_ABOVE_R = 1.5;

/**
 * A 'gate'-mode hook that only ever says NO — it never initiates an exit of its own, it just
 * refuses the built-in ones while the trade is clearly working.
 *
 * This is what `ctx.pendingExit` is for. Returning `false` lets the built-in exit stand;
 * `{ exit: false }` vetoes it. The distinction only exists in 'gate' mode, and this hook is
 * meaningless without it — in 'replace' mode there is nothing to veto.
 */
export const holdWinners: ExitHook = ctx => {
  if (!ctx.pendingExit) return false;         // nothing to veto — take no exit of our own
  const p = ctx.position;
  if (p.riskPoints === null || p.riskPoints <= 0) return false;
  const rMultiple = p.openPoints / p.riskPoints;
  if (rMultiple < VETO_ABOVE_R) return false; // let the built-in exit through
  ctx.log(`vetoed ${ctx.pendingExit.reason} at ${rMultiple.toFixed(2)}R`);
  return { exit: false };
};
