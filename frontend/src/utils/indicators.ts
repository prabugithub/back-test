import type { Candle } from '../types';

/**
 * Calculate Simple Moving Average (SMA)
 */
export function calculateSMA(candles: Candle[], period: number) {
  const result: Array<{ time: number; value: number }> = [];

  // Validate we have enough candles
  if (!candles || candles.length < period) {
    console.warn(`Not enough candles for SMA calculation. Need ${period}, have ${candles?.length || 0}`);
    return result;
  }

  for (let i = period - 1; i < candles.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) {
      // Additional safety check
      if (!candles[i - j] || typeof candles[i - j].close !== 'number') {
        console.warn(`Invalid candle data at index ${i - j}`);
        return result;
      }
      sum += candles[i - j].close;
    }
    result.push({
      time: candles[i].timestamp,
      value: sum / period,
    });
  }

  return result;
}

/**
 * Calculate Exponential Moving Average (EMA)
 */
export function calculateEMA(candles: Candle[], period: number) {
  const result: Array<{ time: number; value: number }> = [];

  // Validate we have enough candles
  if (!candles || candles.length < period) {
    console.warn(`Not enough candles for EMA calculation. Need ${period}, have ${candles?.length || 0}`);
    return result;
  }

  const multiplier = 2 / (period + 1);

  // First EMA is SMA
  let sum = 0;
  for (let i = 0; i < period; i++) {
    // Additional safety check
    if (!candles[i] || typeof candles[i].close !== 'number') {
      console.warn(`Invalid candle data at index ${i}`);
      return result;
    }
    sum += candles[i].close;
  }
  let ema = sum / period;
  result.push({
    time: candles[period - 1].timestamp,
    value: ema,
  });

  // Calculate EMA for remaining candles
  for (let i = period; i < candles.length; i++) {
    if (!candles[i] || typeof candles[i].close !== 'number') {
      console.warn(`Invalid candle data at index ${i}`);
      break;
    }
    ema = (candles[i].close - ema) * multiplier + ema;
    result.push({
      time: candles[i].timestamp,
      value: ema,
    });
  }

  return result;
}

/**
 * Calculate Fibonacci Retracement Levels
 */
export function calculateFibonacciLevels(high: number, low: number) {
  const diff = high - low;
  return {
    level_0: low,
    level_236: low + diff * 0.236,
    level_382: low + diff * 0.382,
    level_500: low + diff * 0.5,
    level_618: low + diff * 0.618,
    level_786: low + diff * 0.786,
    level_100: high,
  };
}

/**
 * Calculate Average True Range (ATR)
 * Standard Wilder's smoothing (RMA)
 */
export function calculateATR(candles: Candle[], period: number = 14) {
  const result: Array<{ time: number; value: number }> = [];
  if (!candles || candles.length < period) return result;

  const trs: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const prev = i > 0 ? candles[i - 1] : null;
    if (!prev) {
      trs.push(c.high - c.low);
    } else {
      trs.push(Math.max(
        c.high - c.low,
        Math.abs(c.high - prev.close),
        Math.abs(c.low - prev.close)
      ));
    }
  }

  const alpha = 1 / period;
  let atr = 0;

  // Initial ATR is SMA of first TRs
  let sum = 0;
  for (let i = 0; i < period; i++) sum += trs[i];
  atr = sum / period;

  result.push({ time: candles[period - 1].timestamp, value: atr });

  for (let i = period; i < candles.length; i++) {
    atr = alpha * trs[i] + (1 - alpha) * atr;
    result.push({ time: candles[i].timestamp, value: atr });
  }

  return result;
}

export interface PivotPoint {
  time: number;
  type: 'bullish' | 'bearish';
  price: number;
  slDistance: number;
  trendLabel?: 'HH' | 'HL' | 'LH' | 'LL';
  barIndex: number; // index into the candles array this pivot fired on — enables O(1) bar-distance math
}

/**
 * Calculate Reversal Pivot Points (Bullish and Bearish)
 * Based on advanced candlestick pattern analysis
 * Detects reversal patterns using multiple candle confirmation
 */
export function calculatePivotPoints(candles: Candle[]): PivotPoint[] {
  const result: PivotPoint[] = [];
  let lastBullPrice = 0;
  let lastBearPrice = 0;

  // Validate we have enough candles
  if (!candles || candles.length < 5) {
    console.warn(`Not enough candles for pivot point calculation. Need 5, have ${candles?.length || 0}`);
    return result;
  }

  // Need at least 5 candles to detect pivots (current + 4 previous)
  for (let i = 4; i < candles.length; i++) {
    // Additional safety check for each candle
    if (!candles[i] || !candles[i - 1] || !candles[i - 2] || !candles[i - 3]) {
      console.warn(`Invalid candle data at index ${i}`);
      continue;
    }

    const current = candles[i];      // index 0 in Pine Script logic
    const prev = candles[i - 1];     // index 1 in Pine Script logic
    const prev2 = candles[i - 2];    // index 2 in Pine Script logic
    const prev3 = candles[i - 3];    // index 3 in Pine Script logic

    // ============================================
    // BULLISH REVERSAL PIVOT LOGIC
    // ============================================

    // Check if previous candle was a pivot to avoid consecutive signals
    const isPreviousBullPivot =
      prev.close > prev2.high &&
      prev.close > prev.open &&
      prev3.close < prev3.open;

    // Condition 1: Current breaks previous high (simple pattern)
    const condition1_bull =
      current.close > prev.high &&
      current.close > current.open;

    // low condition check
    const low_condition_bull = prev.low < prev2.low || prev2.low < prev3.low || current.low < prev.low;
    // Condition 1 OR: Three-candle bullish reversal pattern
    const condition1_bull_or =
      current.close > current.open &&           // Current is bullish
      prev.close > prev.open &&                 // Previous is bullish
      prev.close < current.close &&             // Current closes higher than previous
      prev2.close < prev2.open &&               // Two back is bearish
      low_condition_bull &&                // Two back closes below three back's low
      !isPreviousBullPivot;

    // Condition 3: Two back is bearish and breaks below three back's low
    const condition3_bull =
      prev2.close < prev2.open &&
      low_condition_bull;

    // Combined bullish signal
    const bullishPivot = (condition1_bull_or || condition1_bull) && condition3_bull;

    if (bullishPivot) {
      // Logic for Long SL Distance: abs(min(low[0-4]) - close[0]) + 2
      const minLow = Math.min(current.low, prev.low, prev2.low);
      const slDistance = Math.ceil(Math.abs(current.close - minLow) + 2);

      let label: 'HL' | 'LL' | undefined = undefined;
      if (lastBullPrice > 0) {
        label = current.low > lastBullPrice ? 'HL' : 'LL';
      }
      lastBullPrice = current.low;

      result.push({
        time: current.timestamp,
        type: 'bullish',
        price: current.low,
        slDistance: slDistance,
        trendLabel: label,
        barIndex: i,
      });
    }

    // ============================================
    // BEARISH REVERSAL PIVOT LOGIC
    // ============================================

    // Check if previous candle was a pivot to avoid consecutive signals
    const isPreviousBearPivot =
      prev.close < prev2.low &&
      prev.close < prev.open &&
      prev3.close > prev3.open;

    // Condition 1: Current breaks previous low (simple pattern)
    const condition1_bear =
      current.close < prev.low &&
      current.close < current.open;

    // high condition check
    const high_condition_bear = prev.high > prev2.high || prev2.high > prev3.high || current.high > prev.high;
    // Condition 1 OR: Three-candle bearish reversal pattern
    const condition1_bear_or =
      current.close < current.open &&           // Current is bearish
      prev.close < prev.open &&                 // Previous is bearish
      prev.close > current.close &&             // Current closes lower than previous
      prev2.close > prev2.open &&               // Two back is bullish
      high_condition_bear &&               // Two back closes above three back's high
      !isPreviousBearPivot;

    // Condition 3: Two back is bullish and breaks above three back's high
    const condition3_bear =
      prev2.close > prev2.open &&
      high_condition_bear;

    // Combined bearish signal
    const bearishPivot = condition1_bear_or || (condition1_bear && condition3_bear);

    if (bearishPivot) {
      // Logic for Short SL Distance: abs(max(high[0-4]) - close[0]) + 2
      const maxHigh = Math.max(current.high, prev.high, prev2.high);
      const slDistance = Math.ceil(Math.abs(current.close - maxHigh) + 2);

      let label: 'HH' | 'LH' | undefined = undefined;
      if (lastBearPrice > 0) {
        label = current.high > lastBearPrice ? 'HH' : 'LH';
      }
      lastBearPrice = current.high;

      result.push({
        time: current.timestamp,
        type: 'bearish',
        price: current.high,
        slDistance: slDistance,
        trendLabel: label,
        barIndex: i,
      });
    }
  }

  return result;
}

export type AlBrooksSignal = string; // 'H1','H2','H3','H4',... 'L1','L2','L3','L4',...

/** Inclusive bar-index bounds of a completed breakout leg. */
export interface AlBrooksLeg {
  /** Bar of the last H/L signal fired before the breakout (hSwingHigh/lSwingLow break)
   *  confirmed the leg. */
  startIndex: number;
  /** Bar of the leg's swing extreme, frozen when the next pullback began. */
  endIndex: number;
}

/** Per-bar lookup of the most recently COMPLETED leg of each side, as of that bar.
 *  null until the side's first leg completes. Lets any bar (e.g. a manual trade
 *  entry) grade the same leg the H/L markers of the surrounding pullback grade. */
export interface AlBrooksLegsByBar {
  bull: (AlBrooksLeg | null)[];
  bear: (AlBrooksLeg | null)[];
}

/** A completed breakout leg tagged with its impulse direction, recorded in the order
 *  legs freeze. Unlike AlBrooksLegsByBar (per-bar latest of each side), this is the
 *  full chronological history — the raw material for building a contiguous leg+pullback
 *  sequence. */
export interface CompletedLeg extends AlBrooksLeg {
  direction: 'bull' | 'bear';
}

export interface AlBrooksMarker {
  time: number;
  signal: AlBrooksSignal;
  /** Bounds of the most recently COMPLETED breakout leg of this signal's side at
   *  fire time (H markers → bull leg, L markers → bear leg), for strength metrics
   *  (efficiency ratio, overlap, …) to grade actual leg bars instead of a fixed
   *  lookback. A leg starts at the last H/L bar fired before its hSwingHigh /
   *  lSwingLow broke (the hCount/lCount reset = breakout confirmed) and ends at
   *  the swing extreme frozen when the next pullback began. Every signal of the
   *  same pullback carries the same completed leg. undefined until the side's
   *  first leg completes. */
  legStartIndex?: number;
  legEndIndex?: number;
}

/** Everything one runAlBrooks pass produces. Extracted because this exact shape is the
 *  return type of runAlBrooks, the alBrooksCache value type and getFullAlBrooks' return —
 *  three places that must stay in lockstep. */
export interface AlBrooksRun {
  markers: AlBrooksMarker[];
  legs: AlBrooksLegsByBar;
  legHistory: CompletedLeg[];
  /** Dense per-bar H/L label, index-aligned with `candles`; null on bars where nothing
   *  fired (including bars 0-20, which the state machine never reaches). At most one
   *  label per bar — the outside-bar tiebreak makes H and L mutually exclusive.
   *  UNFILTERED: records every signal the counter produced, including ones the
   *  pullback-depth filter suppressed from `markers`, so the count never shows a hole. */
  signalsByBar: (AlBrooksSignal | null)[];
}

/**
 * Calculate Al Brooks H1/H2/H3/H4… – L1/L2/L3/L4… pullback signals.
 *
 * Leg-based model with separate H / L counting:
 *
 *   H system (bull-context pullback counting):
 *     - Continuous high breaks without low breaks = bull trend.
 *     - Low break (c.low < c1.low) ARMS for H and sets
 *       hSwingHigh = latestHigh (running max high since last H signal).
 *       This captures the true high of the up-move even through inside bars.
 *     - High break (c.high > c1.high) while armed → H signal fires.
 *       Each signal increments hCount (H1, H2, H3…).
 *     - If price exceeds hSwingHigh → hCount resets to 0, arm cleared.
 *
 *   L system (bear-context pullback counting):
 *     - Continuous low breaks without high breaks = bear trend.
 *     - High break (c.high > c1.high) ARMS for L and sets
 *       lSwingLow = latestLow (running min low since last L signal).
 *     - Low break (c.low < c1.low) while armed → L signal fires.
 *     - If price drops below lSwingLow → lCount resets to 0, arm cleared.
 *
 *   Outside bars (bar breaks both sides):
 *     - Close direction decides: bullish close → H only, bearish close → L only.
 */
export function calculateAlBrooks(
  candles: Candle[],
  usePullbackDepth: boolean = false,
  atrDepthMultiplier: number = 1.0
): AlBrooksMarker[] {
  return runAlBrooks(candles, usePullbackDepth, atrDepthMultiplier).markers;
}

/** Per-bar completed-leg lookup for both sides — see AlBrooksLegsByBar. The depth
 *  filter only hides markers, never changes leg tracking, so no params needed. */
export function calculateAlBrooksLegs(candles: Candle[]): AlBrooksLegsByBar {
  return runAlBrooks(candles, false, 1.0).legs;
}

/** One full pass, all outputs — the chronological leg history (see CompletedLeg) plus
 *  the dense per-bar H/L labels, so callers needing more than one of them don't run the
 *  state machine twice. Fixed at (false, 1.0): only `markers` depends on the depth
 *  filter, and these are the raw, unsuppressed signals. */
export function calculateAlBrooksRun(candles: Candle[]): AlBrooksRun {
  return runAlBrooks(candles, false, 1.0);
}

function runAlBrooks(
  candles: Candle[],
  usePullbackDepth: boolean,
  atrDepthMultiplier: number
): AlBrooksRun {
  const result: AlBrooksMarker[] = [];
  const bullLegs: (AlBrooksLeg | null)[] = new Array(candles?.length ?? 0).fill(null);
  const bearLegs: (AlBrooksLeg | null)[] = new Array(candles?.length ?? 0).fill(null);
  // Chronological log of completed legs (pushed as each freezes below). Purely
  // observational — never read back into the signal state machine.
  const legHistory: CompletedLeg[] = [];
  // Per-bar H/L label — allocated before the short-input guard below so callers always
  // get a correctly sized array. Also purely observational.
  const signalsByBar: (AlBrooksSignal | null)[] = new Array(candles?.length ?? 0).fill(null);
  const done = { markers: result, legs: { bull: bullLegs, bear: bearLegs }, legHistory, signalsByBar };

  if (!candles || candles.length < 22) return done;

  // ── ATR (14-period) for optional quality filter ──────────
  const atrValues = calculateATR(candles, 14);
  const atrMap = new Map<number, number>();
  for (const a of atrValues) atrMap.set(a.time, a.value);
  const getAtr = (ts: number) => atrMap.get(ts) ?? 0;

  // ── EMA 21 ───────────────────────────────────────────────
  const ema21Period = 21;
  const ema21Mult = 2 / (ema21Period + 1);
  let ema21 = 0;
  {
    let seed = 0;
    for (let i = 0; i < ema21Period; i++) seed += candles[i].close;
    ema21 = seed / ema21Period;
  }

  // ── H System State (bull-context pullback counting) ───────
  let hCount = 0;
  let hArmed = false;       // true after a low break (pullback started)
  let hSwingHigh = -Infinity;   // price level at pullback start; reset threshold
  let latestHigh = -Infinity;   // running max high since last H signal

  // ── L System State (bear-context pullback counting) ───────
  let lCount = 0;
  let lArmed = false;       // true after a high break (pullback started)
  let lSwingLow = Infinity;    // price level at pullback start; reset threshold
  let latestLow = Infinity;    // running min low since last L signal

  // ── Leg tracking (parallel to the signal machinery above; never feeds back
  //    into hCount/hArmed/lCount/lArmed, so signal timing is unchanged) ──────
  //
  // A breakout leg lives through three phases per side:
  //   candidate → every H fired replaces the candidate start; a deeper pullback
  //               low (lowBreak) before the breakout discards it — "until
  //               hSwingHigh breaks, the newest H is the leg start";
  //   active    → the hCount reset (c.high > hSwingHigh = breakout confirmed)
  //               promotes the candidate to an open leg whose running swing
  //               extreme is tracked;
  //   completed → the first lowBreak after confirmation freezes the leg at its
  //               swing extreme. Markers and per-bar lookups always report the
  //               most recently COMPLETED leg of their side.
  let hCandidateStart: number | null = null; // bar of the newest H fired, pre-breakout
  let hActiveStart: number | null = null;    // non-null = confirmed leg still running
  let hActiveMaxHigh = -Infinity;            // running swing extreme of the active leg
  let hActiveMaxHighBar = -1;
  let hCompletedLeg: AlBrooksLeg | null = null;

  let lCandidateStart: number | null = null;
  let lActiveStart: number | null = null;
  let lActiveMinLow = Infinity;
  let lActiveMinLowBar = -1;
  let lCompletedLeg: AlBrooksLeg | null = null;

  // ── Main loop ─────────────────────────────────────────────
  for (let i = ema21Period; i < candles.length; i++) {
    const c = candles[i];
    const c1 = candles[i - 1];

    ema21 = (c.close - ema21) * ema21Mult + ema21;

    const highBreak = c.high > c1.high;
    const lowBreak = c.low < c1.low;

    // ── Update running extreme trackers ──────────────────
    // These accumulate since the last signal of their type,
    // so swing points capture the true move even through
    // inside bars.
    latestHigh = Math.max(latestHigh, c.high);
    latestLow = Math.min(latestLow, c.low);

    // ── Leg extension / completion / candidate invalidation ──────────────
    // Extend the active leg's swing extreme (this bar may itself be the extreme).
    if (hActiveStart !== null && c.high > hActiveMaxHigh) {
      hActiveMaxHigh = c.high; hActiveMaxHighBar = i;
    }
    if (lActiveStart !== null && c.low < lActiveMinLow) {
      lActiveMinLow = c.low; lActiveMinLowBar = i;
    }
    // A lowBreak starts a pullback in bull context: it completes an active bull
    // leg at its swing extreme, and discards a not-yet-confirmed candidate (a
    // deeper pullback low before breakout — the next H becomes the new start).
    // Runs BEFORE the fire block so a signal firing on this same bar already
    // references the just-completed leg. Mirrored for the bear side.
    if (lowBreak) {
      if (hActiveStart !== null) {
        hCompletedLeg = { startIndex: hActiveStart, endIndex: hActiveMaxHighBar };
        legHistory.push({ direction: 'bull', ...hCompletedLeg });
        hActiveStart = null;
      }
      hCandidateStart = null;
    }
    if (highBreak) {
      if (lActiveStart !== null) {
        lCompletedLeg = { startIndex: lActiveStart, endIndex: lActiveMinLowBar };
        legHistory.push({ direction: 'bear', ...lCompletedLeg });
        lActiveStart = null;
      }
      lCandidateStart = null;
    }

    // ── 2. Capture arm state from BEFORE this bar ────────
    // Ensures the bar that starts a pullback cannot also fire
    // the signal on the same bar.
    const wasHArmed = hArmed;
    const wasLArmed = lArmed;

    // ── 3. Arm on pullback start ─────────────────────────
    // H arm: low break starts a pullback in bull context.
    //        hSwingHigh = latestHigh (the true high of the
    //        up-move, even if the previous bar was an inside bar).
    if (lowBreak && !hArmed) {
      hArmed = true;
      hSwingHigh = latestHigh;
    }
    // L arm: high break starts a pullback in bear context.
    //        lSwingLow = latestLow (the true low of the
    //        down-move, even if the previous bar was an inside bar).
    if (highBreak && !lArmed) {
      lArmed = true;
      lSwingLow = latestLow;
    }

    // ── 4. Signal checks (using previous arm state) ──────
    let canFireH = highBreak && wasHArmed;
    let canFireL = lowBreak && wasLArmed;

    // Outside bar: both sides break → close direction decides.
    if (canFireH && canFireL) {
      const isBullishClose = c.close >= c.open;
      canFireH = isBullishClose;
      canFireL = !isBullishClose;
    }

    // ── Fire H signal ────────────────────────────────────
    if (canFireH) {
      hCount++;
      hArmed = false;
      latestHigh = c.high;  // reset tracker for next up-move

      // The newest H is the candidate start of the next breakout leg — replaced
      // by later H fires, discarded by a deeper pullback low, promoted to an
      // active leg when hSwingHigh breaks.
      hCandidateStart = i;

      // Recorded BEFORE the depth gate: hCount already advanced, so gating here would
      // leave a hole (H1 → H3) in the very sequence that exists to show the count.
      // A single slot per bar is lossless only because of the tiebreak above.
      const signal = `H${hCount}`;
      signalsByBar[i] = signal;

      const depthOk = c.low <= ema21 + getAtr(c.timestamp) * atrDepthMultiplier;
      if (!usePullbackDepth || depthOk) {
        result.push({
          time: c.timestamp,
          signal,
          legStartIndex: hCompletedLeg?.startIndex,
          legEndIndex: hCompletedLeg?.endIndex,
        });
      }
    }

    // ── Fire L signal ────────────────────────────────────
    if (canFireL) {
      lCount++;
      lArmed = false;
      latestLow = c.low;   // reset tracker for next down-move

      lCandidateStart = i;

      const signal = `L${lCount}`;
      signalsByBar[i] = signal; // unfiltered, same reasoning as the H side above

      const depthOk = c.high >= ema21 - getAtr(c.timestamp) * atrDepthMultiplier;
      if (!usePullbackDepth || depthOk) {
        result.push({
          time: c.timestamp,
          signal,
          legStartIndex: lCompletedLeg?.startIndex,
          legEndIndex: lCompletedLeg?.endIndex,
        });
      }
    }

    // ── 1. Reset checks (highest priority) ───────────────
    // H reset: price exceeds hSwingHigh → trend resumed,
    //          count resets and current arm is invalidated.
    //          For the leg tracker this IS the breakout confirmation: the
    //          candidate (last H fired) becomes an active leg starting there.
    //          A bar that fires an H and breaks hSwingHigh together starts the
    //          leg at itself. No candidate (H suppressed on an outside bar, or
    //          none fired yet) → the breakout opens no leg: legs only start
    //          from an H.
    if (hSwingHigh !== -Infinity && c.high > hSwingHigh) {
      hCount = 0;
      hArmed = false;
      hSwingHigh = -Infinity;
      if (hCandidateStart !== null) {
        hActiveStart = hCandidateStart;
        hActiveMaxHigh = c.high;
        hActiveMaxHighBar = i;
        hCandidateStart = null;
      }
    }
    // L reset: price drops below lSwingLow → bear trend resumed.
    if (lSwingLow !== Infinity && c.low < lSwingLow) {
      lCount = 0;
      lArmed = false;
      lSwingLow = Infinity;
      if (lCandidateStart !== null) {
        lActiveStart = lCandidateStart;
        lActiveMinLow = c.low;
        lActiveMinLowBar = i;
        lCandidateStart = null;
      }
    }

    // Per-bar lookup: the most recently completed leg of each side as of this
    // bar (a leg completed by this very bar's pullback start is included).
    bullLegs[i] = hCompletedLeg;
    bearLegs[i] = lCompletedLeg;
  }

  return done;
}

// ─── Per-array memoization (auto-backtest hot path) ───────────────────────────
//
// calculatePivotPoints/calculateEMA/calculateATR/runAlBrooks are all strictly
// causal — the value at bar i is a fold over candles[0..i] only, never anything
// after it (verified: each loop only ever reads i, i-1, i-2, i-3 and running
// state built from earlier iterations). That means calling e.g.
// calculatePivotPoints(candles.slice(0, i + 1)) for every i from 0..N produces,
// bar for bar, exactly the same PivotPoint[] prefix as calling it ONCE on the
// full `candles` array and reading off the entries up to bar i — but the naive
// per-bar slice-and-recompute is O(n) per bar (O(n^2) total across a backtest
// run), while computing once and indexing is O(n) total. The auto-backtest
// engine re-derives these on every single bar (entry signal check, trail stop,
// exit-signal check — each potentially per open position), so this is the
// actual cost driver behind a slow/laggy auto-backtest on any reasonably long
// candle history.
//
// WeakMap keys on the exact candles array reference, so this only ever pays
// off when callers pass the SAME stable array (as the auto-backtest loops do)
// — a fresh slice or a different array always misses and just recomputes,
// identically to calling the un-cached function directly. Nothing here changes
// any computed value, only how often it's recomputed.

const pivotPointsCache = new WeakMap<Candle[], PivotPoint[]>();

function getFullPivotPoints(candles: Candle[]): PivotPoint[] {
  let cached = pivotPointsCache.get(candles);
  if (!cached) {
    cached = calculatePivotPoints(candles);
    pivotPointsCache.set(candles, cached);
  }
  return cached;
}

/** Pivots visible as of `endIndex` (inclusive) — identical to
 *  calculatePivotPoints(candles.slice(0, endIndex + 1)), amortized O(log n). */
export function getPivotPointsUpTo(candles: Candle[], endIndex: number): PivotPoint[] {
  const full = getFullPivotPoints(candles);
  // barIndex is strictly ascending in `full`, so binary-search the cut point
  // instead of an O(full.length) filter on every call.
  let lo = 0, hi = full.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (full[mid].barIndex <= endIndex) lo = mid + 1; else hi = mid;
  }
  return full.slice(0, lo);
}

const emaCache = new WeakMap<Candle[], Map<number, Array<{ time: number; value: number }>>>();

function getFullEma(candles: Candle[], period: number): Array<{ time: number; value: number }> {
  let byPeriod = emaCache.get(candles);
  if (!byPeriod) {
    byPeriod = new Map();
    emaCache.set(candles, byPeriod);
  }
  let cached = byPeriod.get(period);
  if (!cached) {
    cached = calculateEMA(candles, period);
    byPeriod.set(period, cached);
  }
  return cached;
}

/** EMA(period) value at `index` — identical to the last value of
 *  calculateEMA(candles.slice(0, index + 1), period), amortized O(1). */
export function getEmaValueAt(candles: Candle[], index: number, period: number): number | null {
  if (index < period - 1) return null;
  const full = getFullEma(candles, period);
  const i = index - (period - 1);
  return i >= 0 && i < full.length ? full[i].value : null;
}

const atrCache = new WeakMap<Candle[], Map<number, Array<{ time: number; value: number }>>>();

function getFullAtr(candles: Candle[], period: number): Array<{ time: number; value: number }> {
  let byPeriod = atrCache.get(candles);
  if (!byPeriod) {
    byPeriod = new Map();
    atrCache.set(candles, byPeriod);
  }
  let cached = byPeriod.get(period);
  if (!cached) {
    cached = calculateATR(candles, period);
    byPeriod.set(period, cached);
  }
  return cached;
}

/** ATR(period) value at `index` — identical to the last value of
 *  calculateATR(candles.slice(0, index + 1), period), amortized O(1). */
export function getAtrValueAt(candles: Candle[], index: number, period: number = 14): number {
  if (index < period - 1) return 0;
  const full = getFullAtr(candles, period);
  const i = index - (period - 1);
  return i >= 0 && i < full.length ? full[i].value : 0;
}

const alBrooksCache = new WeakMap<Candle[], Map<string, AlBrooksRun>>();

function getFullAlBrooks(
  candles: Candle[],
  usePullbackDepth: boolean,
  atrDepthMultiplier: number
): AlBrooksRun {
  const key = `${usePullbackDepth}|${atrDepthMultiplier}`;
  let byKey = alBrooksCache.get(candles);
  if (!byKey) {
    byKey = new Map();
    alBrooksCache.set(candles, byKey);
  }
  let cached = byKey.get(key);
  if (!cached) {
    cached = runAlBrooks(candles, usePullbackDepth, atrDepthMultiplier);
    byKey.set(key, cached);
  }
  return cached;
}

/** AlBrooks markers visible as of `endIndex` (inclusive) — identical to
 *  calculateAlBrooks(candles.slice(0, endIndex + 1), ...), amortized O(log n). */
export function getAlBrooksMarkersUpTo(
  candles: Candle[],
  endIndex: number,
  usePullbackDepth: boolean = false,
  atrDepthMultiplier: number = 1.0
): AlBrooksMarker[] {
  const full = getFullAlBrooks(candles, usePullbackDepth, atrDepthMultiplier).markers;
  const maxTime = candles[endIndex]?.timestamp;
  if (maxTime === undefined) return [];
  // Markers are pushed in ascending bar-index (== ascending time) order.
  let lo = 0, hi = full.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (full[mid].time <= maxTime) lo = mid + 1; else hi = mid;
  }
  return full.slice(0, lo);
}

/** Per-bar completed-leg lookup as of `endIndex` — identical to reading
 *  calculateAlBrooksLegs(candles.slice(0, endIndex + 1)).{bull,bear}[endIndex],
 *  amortized O(1). */
export function getAlBrooksLegsAt(
  candles: Candle[],
  endIndex: number
): { bull: AlBrooksLeg | null; bear: AlBrooksLeg | null } {
  const full = getFullAlBrooks(candles, false, 1.0).legs;
  return { bull: full.bull[endIndex] ?? null, bear: full.bear[endIndex] ?? null };
}
