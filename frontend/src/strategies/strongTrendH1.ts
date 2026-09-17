/**
 * Strong-trend H1 continuation. LONG ONLY.
 *
 * The setup, in words:
 *
 *   In a trend strong enough that the bull count never gets past H1, buy every H1.
 *
 * ── Why a repeated H1 IS the trend-strength signal ──────────────────────────
 *
 * The Al Brooks counter resets whenever the swing it was counting is broken. In a strong
 * bull trend each pullback is so shallow and so brief that the very first attempt up
 * (the H1) immediately makes a new high — which resets the count, so the NEXT pullback
 * also produces an H1. A trend that keeps printing H1, H1, H1 never gave the bears enough
 * room to build an H2, let alone an H3.
 *
 * The mirror image is visible on the other side at the same time: because price never makes
 * a new low, nothing resets the bear count, so the L labels just keep climbing — L1, L2,
 * L3, L4 … L7 is normal inside a strong uptrend. A high L count is therefore CONFIRMING
 * here, not a warning. It is measured and recorded (`lRun`), and available as a gate via
 * MIN_L_RUN, which ships off — see the constant.
 *
 * So the label test is: the last two H-side signals, the trigger bar's own included, are
 * both H1. Interleaved L labels do not break the streak (see H1_STREAK_STRICT).
 *
 * ── The other two gates ─────────────────────────────────────────────────────
 *
 *   - the current bull leg contains at least MIN_CLEAN_BULL_BARS clean bull bars —
 *     bull-bodied bars with a body-to-range ratio at or above MIN_CLEAN_BRR
 *   - both EMAs are sloping up hard at the ENTRY bar, EMA21 and EMA50 alike
 *
 * A pure filter — it returns true/false only, so the regime's own SL, target and position
 * sizing still apply. See the note at the bottom for a structural stop.
 *
 * ── How the leg sequence is laid out ────────────────────────────────────────
 *
 * `ctx.legs()` is NEWEST-FIRST, and a bull leg's retrace is tagged `direction: 'bear'`
 * (a pullback carries the direction counter to the leg it retraced). An H1 usually fires as
 * a shallow retrace ends, so segs[0] is usually the bear pullback and segs[1] the bull leg —
 * but in a strong trend the leg often runs right up to the entry bar with no retrace segment
 * at all, so BOTH shapes are accepted and neither is assumed.
 */
import type { EntryHook, EntryHookContext } from '../utils/entryHook';
import { getEmaValueAt } from '../utils/indicators';
import { calculateEMASlope } from '../utils/pivotAnalysis';
import type { LegSegment } from '../types';
import { probe } from './debug';

/**
 * How many consecutive H-side signals, ending at and INCLUDING the trigger bar, must all be
 * H1. 2 is what "the last two labels should be H1" asks for. Raise to 3+ for a stricter
 * read of "continuously only H1"; 1 disables the streak test and takes every H1.
 */
const REQUIRED_H1_STREAK = 2;

/**
 * Whether an interleaved L label breaks the H1 streak.
 *
 * false (default) — only H-side labels are read, so H1 · L4 · H1 still counts as a streak
 * of two. This is the reading that matches the mechanism above: the climbing L count is a
 * symptom of the same strong trend, not evidence against it.
 *
 * true — the last REQUIRED_H1_STREAK entries of the raw label stream must ALL be H1,
 * whatever side they are on. Much stricter, and on 5m data it mostly fires on runaway
 * one-directional moves. Both readings are recorded (`hStreak` vs `rawStreak` in the probe
 * row) on every bar, so flipping this is an informed choice rather than a guess.
 */
const H1_STREAK_STRICT = false;

/** A bull bar counts as CLEAN at or above this body-to-range ratio. 0.5 = the body is at
 *  least half the bar's range. `__hook.stats('cleanBars')` on your own instrument is the
 *  way to judge whether this and MIN_CLEAN_BULL_BARS are set sensibly together. */
const MIN_CLEAN_BRR = 0.5;

/** Minimum clean bull bars inside the current bull leg. Counted over the WHOLE leg, not
 *  consecutively — `cleanRun` in the probe row carries the longest consecutive run, so
 *  switch the gate to that (it is one line, marked below) if that is what you meant. */
const MIN_CLEAN_BULL_BARS = 3;

/**
 * Minimum EMA slope at the entry bar, in ATRs per bar.
 *
 * Normalised by ATR deliberately: a raw slope is points-per-bar, so a threshold tuned on
 * one symbol or timeframe does not carry to another, while this one does. The lookbacks
 * behind each slope (10 and 20 bars by default) come from Session Settings, not from here.
 *
 * These two numbers are STARTING VALUES, not measurements. Run the hook once with the two
 * lines under "slope gate" commented out and read the real distribution off
 * `__hook.stats('ema21SlopeAtr')` / `__hook.stats('ema50SlopeAtr')`, then set each threshold
 * where it actually separates your trends from your ranges.
 */
const MIN_EMA21_SLOPE_ATR = 0.05;
const MIN_EMA50_SLOPE_ATR = 0.03;

/**
 * Minimum bear count on the other side for the trend to qualify — the "L4, L5 … L7 and
 * still no new low" confirmation. Ships at 0 (OFF) because it is the observation that
 * EXPLAINS the repeated H1 rather than an independent condition, and gating on both tests
 * the same thing twice. `lRun` is recorded on every bar regardless; set this to 3 or 4 once
 * you have looked at that column.
 */
const MIN_L_RUN = 0;

/** probe()'s own rounding is private to debug.ts; extras arrive raw, so round here. */
const r = (v: number | null | undefined, dp: number): number | null =>
  v === null || v === undefined || !Number.isFinite(v) ? null : Number(v.toFixed(dp));

export const strongTrendH1: EntryHook = ctx => {
  // ── 1. Trigger: long side, H1 exactly ─────────────────────────────────────
  // Not "H1 or later": the whole premise is that a strong trend never gets past H1, so an
  // H2 here is itself evidence the trend has slowed.
  if (ctx.trigger.side !== 'long') return false;
  if (ctx.trigger.count !== 1) return false;

  const segs = ctx.legs();

  // ── 2. We must be in / on the back of a bull leg ──────────────────────────
  // Accepted shapes, and only these two:
  //   segs[0] = bull leg                          — the leg ran up to the entry bar
  //   segs[0] = bear pullback, segs[1] = bull leg — the usual H1 position
  // Anything else (a bear leg newest, a bull pullback retracing a bear leg) is not this
  // setup, and is rejected rather than searched past — a bull leg found six segments back
  // says nothing about the bar being entered.
  const head = segs[0];
  if (!head) return false;

  let bullLeg: LegSegment | null = null;
  let pullback: LegSegment | null = null;
  if (head.kind === 'leg' && head.direction === 'bull') {
    bullLeg = head;
  } else if (head.kind === 'pullback' && head.direction === 'bear') {
    const next = segs[1];
    if (next && next.kind === 'leg' && next.direction === 'bull') {
      bullLeg = next;
      pullback = head;
    }
  }
  if (!bullLeg) return false;

  // ── 3. Clean bull bars inside that leg ────────────────────────────────────
  const clean = countCleanBullBars(bullLeg);
  if (clean === null) return false; // per-candle arrays missing — unmeasurable, so untradeable

  // ── 4. The label stream ───────────────────────────────────────────────────
  // Bounded by the leg sequence itself (Session Settings → Leg Seq N), not by a bar count
  // invented here: a previous H1 from 400 bars ago is not part of this trend's structure.
  const labels = recentLabels(ctx, segs);
  const hStreak = countLeadingH1(labels.filter(l => l[0] === 'H'));
  const rawStreak = countLeadingH1(labels);
  const streak = H1_STREAK_STRICT ? rawStreak : hStreak;
  const lRun = maxLCount(labels);

  // ── 5. Moving averages at the ENTRY bar ───────────────────────────────────
  // Why not just read ctx.metrics.ema21Slope: computeEntryMetrics anchors the EMA slopes at
  // legWindow.endIndex when a completed breakout leg exists, so that number describes the MA
  // at the swing extreme — often 5-15 bars back — not at the bar that would fill. These are
  // measured at ctx.absoluteIndex, which is the entry bar itself.
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

  const atr = ctx.atr;
  const slope21Atr = ema21Slope !== undefined && atr > 0 ? ema21Slope / atr : null;
  const slope50Atr = ema50Slope !== undefined && atr > 0 ? ema50Slope / atr : null;

  // Recorded here, after every number is computed and before the first verdict below, so
  // __hook.table() shows the bars that reached the measurements and __hook.stats() gives the
  // real distributions to tune the four thresholds against. Costs nothing when unused.
  probe(ctx, {
    hStreak,            // H1s in a row, L labels ignored     <- what H1_STREAK_STRICT=false uses
    rawStreak,          // H1s in a row in the raw stream     <- what H1_STREAK_STRICT=true uses
    lRun,               // highest L count in the same window — the "L7 and no new low" read
    labels: labels.slice(0, 6).join('·'),
    cleanBars: clean.total,
    cleanRun: clean.maxRun,
    legBars: bullLeg.barCount,
    legBrr: r(bullLeg.brrAvg, 3),
    pullbackBars: pullback?.barCount ?? 0,
    ema21: r(ema21, 2),
    ema50: r(ema50, 2),
    ema21SlopeEntry: r(ema21Slope, 4),
    ema50SlopeEntry: r(ema50Slope, 4),
    // Slope per ATR — the instrument-independent form the gates actually read.
    ema21SlopeAtr: r(slope21Atr, 3),
    ema50SlopeAtr: r(slope50Atr, 3),
    // Signed distance from price to EMA21 in ATRs — how extended the entry is.
    emaDistAtr: ema21 !== null && atr > 0 ? r((ctx.candle.close - ema21) / atr, 2) : null,
  });

  // ── 6. The verdicts ───────────────────────────────────────────────────────
  if (streak < REQUIRED_H1_STREAK) return false;
  if (lRun < MIN_L_RUN) return false;

  // Swap for `clean.maxRun` to require three clean bull bars BACK TO BACK.
  if (clean.total < MIN_CLEAN_BULL_BARS) return false;

  // slope gate — comment these two out to collect the distribution first
  if (slope21Atr === null || slope21Atr < MIN_EMA21_SLOPE_ATR) return false;
  if (slope50Atr === null || slope50Atr < MIN_EMA50_SLOPE_ATR) return false;

  // Stamped onto the trade itself — ctx.log() is appended to the signal's reason, which the
  // batch simulator writes to journal.entrySign and journal.notes. So every trade this rule
  // produces carries its own proof in Trade History:
  //
  //   Long [Uptrend] H1 | … [hook:strong-trend-h1] | H1x2 lRun=5 clean=4/6 …
  //
  // That is the confirmation path that needs no debugger at all: if a trade shows this text,
  // this function ran and every gate above it passed for that bar.
  ctx.log(
    `H1x${streak} lRun=${lRun} clean=${clean.total}/${bullLeg.barCount} run=${clean.maxRun} `
    + `ema21=${ema21 === null ? 'na' : ema21.toFixed(2)} `
    + `slope21atr=${slope21Atr === null ? 'na' : slope21Atr.toFixed(3)} `
    + `ema50=${ema50 === null ? 'na' : ema50.toFixed(2)} `
    + `slope50atr=${slope50Atr === null ? 'na' : slope50Atr.toFixed(3)}`
  );

  return true;

  // To take a structural stop under the pullback (or under the leg when there is no pullback
  // segment) instead of the regime's configured one, replace the line above with:
  //
  //   const anchor = pullback ? pullback.low : bullLeg.low;
  //   return { sl: anchor - (atr > 0 ? atr * 0.25 : 0) };
  //
  // The target then follows from the regime's targetRR against that risk.
};

/**
 * Clean bull bars within a segment: bull-bodied AND body-to-range at or above MIN_CLEAN_BRR.
 *
 * Both series are 'full'-detail only. `ctx.legs()` always builds at 'full', so they are
 * present on this path — but a Firestore-restored sequence has them stripped, so null is
 * returned rather than a silent zero, and the caller fails closed on it.
 *
 * Returns the total and the longest consecutive run, because "minimum three clean bull bars"
 * has both readings and only real data can say which one separates your winners.
 */
function countCleanBullBars(seg: LegSegment): { total: number; maxRun: number } | null {
  const { bullBear, brr } = seg;
  if (!bullBear || !brr || bullBear.length !== brr.length || bullBear.length === 0) return null;

  let total = 0;
  let run = 0;
  let maxRun = 0;
  for (let i = 0; i < bullBear.length; i++) {
    const isClean = bullBear[i] === 1 && brr[i] >= MIN_CLEAN_BRR;
    if (isClean) {
      total++;
      run++;
      if (run > maxRun) maxRun = run;
    } else {
      run = 0;
    }
  }
  return { total, maxRun };
}

/**
 * The H/L labels over the current leg sequence, NEWEST-FIRST, the trigger bar's own label
 * first.
 *
 * Read off `ctx.signals` (dense, window-aligned, causal) rather than each segment's `hl`
 * array, because the gap between two segments — and the trigger bar itself, which may not
 * belong to any completed segment — would otherwise be invisible.
 *
 * The scan is bounded by the OLDEST segment's start, so the window is whatever Session
 * Settings' Leg Seq N spans, not a bar count hard-coded here.
 */
function recentLabels(ctx: EntryHookContext, segs: LegSegment[]): string[] {
  // ctx.signals is aligned with ctx.candles (the window), while segment indices are absolute.
  const windowOffset = ctx.absoluteIndex - ctx.index; // absolute index of ctx.candles[0]
  const oldest = segs[segs.length - 1];
  const floorIdx = oldest ? Math.max(0, oldest.startIndex - windowOffset) : 0;

  const out: string[] = [];
  for (let i = ctx.index; i >= floorIdx; i--) {
    const label = ctx.signals[i];
    if (label) out.push(label);
  }
  return out;
}

/** How many labels from the front of a newest-first list are 'H1', stopping at the first
 *  that is not. */
function countLeadingH1(labels: string[]): number {
  let n = 0;
  while (n < labels.length && labels[n] === 'H1') n++;
  return n;
}

/** Highest bear count present in the window — the "L1, L2 … L7 and still no new low" read.
 *  0 when no L label fired at all. */
function maxLCount(labels: string[]): number {
  let max = 0;
  for (const label of labels) {
    if (label[0] !== 'L') continue;
    const n = Number.parseInt(label.slice(1), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max;
}
