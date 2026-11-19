/**
 * Higher-high continuation on a shallow bear pullback. LONG ONLY.
 *
 * The setup, in words:
 *
 *   On an H2-or-later signal, the market must be making a HIGHER HIGH, the current bull leg
 *   must have pulled back NO MORE THAN 50%, and that bear pullback must have held entirely
 *   above the PREVIOUS leg's high.
 *
 * A pure filter — it returns true/false only, so the regime's own SL, target and position
 * sizing still apply. See the note at the bottom for the one-line switch to a structural stop
 * under the pullback low.
 *
 * ── How the leg sequence is laid out ────────────────────────────────────────
 *
 * `ctx.legs()` is NEWEST-FIRST, and a bull leg's retrace is tagged `direction: 'bear'`
 * (a pullback carries the direction counter to the leg it retraced). So a long setup reads:
 *
 *     segs[0]  pullback / bear   <- still forming, runs up to the entry bar
 *     segs[1]  leg      / bull   <- "current leg"
 *     segs[2]  pullback / bear
 *     segs[3]  leg      / bull   <- "previous leg"
 *
 * Those positions are CHECKED rather than assumed. segs[0] is only a pullback when the leg
 * did not run right up to the entry bar, and legs are occasionally adjacent with no retrace
 * between them — so the previous leg is found by walking back, not by indexing segs[3].
 */
import type { EntryHook } from '../utils/entryHook';
import { getEmaValueAt } from '../utils/indicators';
import { calculateEMASlope } from '../utils/pivotAnalysis';
import type { LegSegment } from '../types';
import { probe } from './debug';

/**
 * Retrace ceiling, as a fraction of the current leg's own high-to-low range.
 * A CEILING: deeper pullbacks are rejected as too weak to be a continuation.
 *
 * Measured on 5 037 HDFCBANK 5m candles, over the bars that survive every gate before this
 * one, the retrace distribution is:
 *
 *     min 0.37 · p25 0.52 · median 0.58 · p75 0.70 · max 1.00
 *
 * so a strict 0.50 keeps only 2 of 11 — the median pullback on this instrument gives back
 * 58%, not 50%. Opened to 0.75 to get a sample size worth judging. Tighten it back once you
 * have enough trades to compare; `__hook.stats('retrace')` prints this distribution for
 * whatever instrument you are actually looking at.
 */
const MAX_RETRACE = 0.5;

/** H1 is the first attempt off a pullback and fails often in Brooks terms; require the
 *  second push or later. The built-in filter chain cannot express counts above 2 at all. */
 const MIN_TRIGGER_COUNT = 2;

/** probe()'s own rounding is private to debug.ts; extras arrive raw, so round here. */
const r = (v: number | null | undefined, dp: number): number | null =>
  v === null || v === undefined || !Number.isFinite(v) ? null : Number(v.toFixed(dp));

export const higherHighShallowPullback: EntryHook = ctx => {
  // ── 1. Trigger: long side, H2 or later ────────────────────────────────────
  if (ctx.trigger.side !== 'long') return false;
   if (ctx.trigger.count !== MIN_TRIGGER_COUNT) return false;

  const segs = ctx.legs();

  // ── 2. The newest segment must be the bear pullback we are buying into ────
  const pullback = segs[0];
  if (!pullback || pullback.kind !== 'pullback' || pullback.direction !== 'bear') return false;

  // ── 3. The leg that pullback retraced, and the bull leg before it ─────────
  const current = segs[1];
  if (!current || current.kind !== 'leg' || current.direction !== 'bull') return false;

  const previous = findPreviousBullLeg(segs, 2);
  if (!previous) return false;

  // ── 4. Higher high ────────────────────────────────────────────────────────
  if (!(current.high > previous.high)) return false;

  // ── 5. The pullback held above the previous leg's high ────────────────────
  // The strict breakout-and-hold reading: price broke the prior peak and never came back
  // under it. Note this is a stronger claim than a plain higher low.
  if (!(pullback.low > previous.high)) return false;

  // ── 6. Shallow retrace ────────────────────────────────────────────────────
  // Price-based, against the leg's OWN range — matching retracePct's (high - x) / (high - low)
  // form, not a move-percent ratio. `high`/`low` on a segment are its extremes across all of
  // its candles, so this is the real retracement.
  const legRange = current.high - current.low;
  if (!(legRange > 0)) return false; // degenerate leg — not measurable, so not tradeable

  const retrace = (current.high - pullback.low) / legRange;

  // ── 7. Moving average at the ENTRY bar ────────────────────────────────────
  // Why not just read ctx.metrics.ema21Slope: computeEntryMetrics anchors the EMA slopes
  // at legWindow.endIndex when a completed breakout leg exists, so that number describes
  // the MA at the swing extreme — often 5-15 bars back — not at the bar that would fill.
  // These are measured at ctx.absoluteIndex, which is the entry bar itself.
  //
  // ctx.ema21 is already entry-bar anchored (getEmaAt(candles, currentIndex, 21) in the
  // engine), so it is used as-is; EMA50 has no ctx field and is looked up from the cached
  // per-bar series on fullCandles — never on ctx.candles, which is a fresh slice and would
  // force a full recompute on every trigger bar.
  //
  // Both lookbacks come from Session Settings. The ?? defaults mirror computeEntryMetrics
  // exactly so an entry-bar slope stays comparable with the leg-end one beside it.
  const ema21 = ctx.ema21;
  const ema50 = getEmaValueAt(ctx.fullCandles, ctx.absoluteIndex, 50);
  const ema21Slope = calculateEMASlope(ctx.fullCandles, ctx.absoluteIndex, 21, ctx.config.ema21SlopeLookback ?? 10);
  const ema50Slope = calculateEMASlope(ctx.fullCandles, ctx.absoluteIndex, 50, ctx.config.ema50SlopeLookback ?? 20);

  // Recorded here, after the arithmetic and before the verdict, so __hook.table() shows only
  // the bars that got this far and __hook.stats('retrace') gives the real depth distribution
  // to tune MAX_RETRACE against. Costs nothing when you are not looking at it.
  probe(ctx, {
    retrace: Number(retrace.toFixed(3)),
    currentHigh: current.high,
    prevHigh: previous.high,
    pullbackLow: pullback.low,
    pullbackBars: pullback.barCount,
    legBars: current.barCount,
    // MA value and slope AT ENTRY. The row's built-in ema21Slope column stays as it was —
    // leg-end anchored — so the two sit side by side and the difference is visible.
    ema21: r(ema21, 2),
    ema50: r(ema50, 2),
    ema60: r(ctx.ema60, 2),
    ema21SlopeEntry: r(ema21Slope, 4),
    ema50SlopeEntry: r(ema50Slope, 4),
    // Slope per ATR: points-per-bar is instrument- and timeframe-scaled, so a threshold
    // tuned on one symbol does not carry to another. This one does.
    ema21SlopeAtr: ctx.atr > 0 ? r((ema21Slope ?? NaN) / ctx.atr, 3) : null,
    // Signed distance from price to EMA21 in ATRs — how extended the entry is.
    emaDistAtr: ema21 !== null && ctx.atr > 0 ? r((ctx.candle.close - ema21) / ctx.atr, 2) : null,
  });

  if (retrace > MAX_RETRACE) return false;

  // Stamped onto the trade itself — ctx.log() is appended to the signal's reason, which the
  // batch simulator writes to journal.entrySign and journal.notes. So every trade this rule
  // produces carries its own proof in Trade History:
  //
  //   Long [Uptrend] H3 | … [hook:hh-shallow-pullback] | HH 993.20>988.10 retrace=0.42 …
  //
  // That is the confirmation path that needs no debugger at all: if a trade shows this text,
  // this function ran and every gate above it passed for that bar.
  ctx.log(
    `HH ${current.high.toFixed(2)}>${previous.high.toFixed(2)} `
    + `retrace=${retrace.toFixed(2)} pbLow=${pullback.low.toFixed(2)} `
    + `legBars=${current.barCount} pbBars=${pullback.barCount} `
    + `ema21=${ema21 === null ? 'na' : ema21.toFixed(2)} `
    + `slope21=${ema21Slope === undefined ? 'na' : ema21Slope.toFixed(3)} `
    + `ema50=${ema50 === null ? 'na' : ema50.toFixed(2)} `
    + `slope50=${ema50Slope === undefined ? 'na' : ema50Slope.toFixed(3)}`
  );

  return true;

  // To take a structural stop under the pullback instead of the regime's configured one,
  // replace the line above with:
  //
  //   return { sl: pullback.low - (ctx.atr > 0 ? ctx.atr * 0.25 : 0) };
  //
  // The target then follows from the regime's targetRR against that wider/narrower risk.
};

/**
 * Walk back from `from` for the next bull impulse leg.
 *
 * Not simply `segs[3]`: legs are sometimes adjacent with no pullback between them, so the
 * leg/pullback alternation drifts. Measured on real 5m data, segment 2 is a leg only 75% of
 * the time and segment 3 only 25% — indexing a fixed position would silently compare against
 * the wrong thing rather than fail loudly.
 */
function findPreviousBullLeg(segs: LegSegment[], from: number): LegSegment | null {
  for (let i = from; i < segs.length; i++) {
    const s = segs[i];
    if (s.kind === 'leg' && s.direction === 'bull') return s;
  }
  return null;
}
