/**
 * A worked reference hook. Copy this file, rename it, register it in ./index.ts.
 *
 * What it does — a deliberately opinionated "deep pullback continuation":
 *
 *   - only fires on the 2nd pullback signal or later (H2+/L2+), which the built-in filter
 *     chain cannot reach past H2/L2 at all
 *   - requires the trigger direction to agree with the LT market structure
 *   - requires the completed breakout leg to have been a clean one (BRR average above a
 *     floor) — reading the same instrumentation the built-in filters gate on
 *   - refuses to re-enter within a cooldown of the previous entry, using ctx.state to
 *     remember across bars
 *   - places the stop just beyond the pullback's own extreme (found by walking the window
 *     back from the trigger bar) rather than at a fixed distance
 *   - sizes so the rupee risk is constant, and widens the target when the leg was strong
 *
 * None of it is sacred. The point is the shape: read what you need off `ctx`, decide, and
 * return either a boolean or a decision object.
 */
import type { EntryHook } from '../utils/entryHook';

/** Skip this many bars after an entry before another one is allowed. */
const COOLDOWN_BARS = 12;
/** Completed leg must have averaged at least this body-to-range ratio to count as clean. */
const MIN_LEG_BRR = 0.45;
/** Rupees risked per trade. Overrides the engine's own sizing. */
const RISK_PER_TRADE = 5000;
/** Padding beyond the pullback extreme, in ATR units. */
const STOP_PAD_ATR = 0.25;

interface ExampleState {
  lastEntryBar?: number;
}

export const deepPullbackContinuation: EntryHook = ctx => {
  const state = ctx.state as ExampleState;

  // ── 1. Only the 2nd pullback signal onward ────────────────────────────────
  // H1 is the first attempt and fails often; H2+ is the Brooks continuation setup. The
  // built-in engine tops out at H2, so counts of 3, 4, 5 are only reachable from here.
  if (ctx.trigger.count < 2) return false;

  // ── 2. Trade with the structure, not against it ───────────────────────────
  const bullish = ctx.ltMarket.startsWith('Bull');
  const bearish = ctx.ltMarket.startsWith('Bear');
  if (ctx.trigger.side === 'long' && !bullish) return false;
  if (ctx.trigger.side === 'short' && !bearish) return false;

  // ── 3. Cooldown — ctx.state persists for the whole run ────────────────────
  if (state.lastEntryBar !== undefined
      && ctx.absoluteIndex - state.lastEntryBar < COOLDOWN_BARS) {
    return false;
  }

  // ── 4. Was the breakout leg a clean one? ──────────────────────────────────
  // brrAvg is graded over the completed breakout leg's own bars (not a fixed lookback)
  // whenever ctx.legWindow is non-null. Undefined means it was not measurable — treat that
  // as a fail here, though the built-in filters would pass it through.
  const brr = ctx.metrics.brrAvg;
  if (brr === undefined || brr < MIN_LEG_BRR) return false;

  // ── 5. Stop beyond the pullback's own extreme ─────────────────────────────
  // Walk back through the window to the start of the current pullback: the bars since the
  // breakout leg ended. ctx.legWindow holds absolute indices, so convert into window space.
  const legEndAbs = ctx.legWindow?.endIndex ?? ctx.absoluteIndex - 1;
  const windowOffset = ctx.absoluteIndex - ctx.index; // absolute index of ctx.candles[0]
  const from = Math.max(0, legEndAbs - windowOffset);

  let extreme = ctx.trigger.side === 'long' ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  for (let i = from; i <= ctx.index; i++) {
    const bar = ctx.candles[i];
    if (ctx.trigger.side === 'long') extreme = Math.min(extreme, bar.low);
    else extreme = Math.max(extreme, bar.high);
  }
  if (!Number.isFinite(extreme)) return false;

  const pad = ctx.atr > 0 ? ctx.atr * STOP_PAD_ATR : 0;
  const sl = ctx.trigger.side === 'long' ? extreme - pad : extreme + pad;

  const entry = ctx.candle.close;
  const risk = Math.abs(entry - sl);
  if (risk <= 0) return false;

  // ── 6. Size to a constant rupee risk ──────────────────────────────────────
  const quantity = Math.floor(RISK_PER_TRADE / risk);
  if (quantity < 1) return false; // stop too wide to size

  // ── 7. Stretch the target when the leg was strong ─────────────────────────
  const targetRR = brr >= 0.6 ? 3 : 2;

  state.lastEntryBar = ctx.absoluteIndex;
  ctx.log(`${ctx.trigger.label} brr=${brr.toFixed(2)} risk=${risk.toFixed(1)}`);

  return { sl, quantity, targetRR };
};

/**
 * The smallest possible hook — takes every H/L signal at any count, with the engine's own
 * direction, sizing, stop and target. Useful as a baseline: run it in `replace` mode to see
 * how many raw trigger bars there actually are before any filtering.
 */
export const takeEverySignal: EntryHook = () => true;
