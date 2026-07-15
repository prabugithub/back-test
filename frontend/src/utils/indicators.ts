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

export interface AlBrooksMarker {
  time: number;
  signal: AlBrooksSignal;
  /** Bar index of the swing extreme (hSwingHigh/lSwingLow) that anchors this pullback —
   *  i.e. the end of the impulse leg, before the pullback that led to this signal began. */
  anchorIndex: number;
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
  const result: AlBrooksMarker[] = [];

  if (!candles || candles.length < 22) return result;

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
  let hSwingHighBarIndex = ema21Period; // bar index of hSwingHigh, for anchoring filter windows
  let latestHigh = -Infinity;   // running max high since last H signal
  let latestHighBarIndex = ema21Period; // bar index that set the current latestHigh

  // ── L System State (bear-context pullback counting) ───────
  let lCount = 0;
  let lArmed = false;       // true after a high break (pullback started)
  let lSwingLow = Infinity;    // price level at pullback start; reset threshold
  let lSwingLowBarIndex = ema21Period; // bar index of lSwingLow, for anchoring filter windows
  let latestLow = Infinity;    // running min low since last L signal
  let latestLowBarIndex = ema21Period; // bar index that set the current latestLow

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
    if (c.high > latestHigh) latestHighBarIndex = i;
    if (c.low < latestLow) latestLowBarIndex = i;
    latestHigh = Math.max(latestHigh, c.high);
    latestLow = Math.min(latestLow, c.low);


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
      hSwingHighBarIndex = latestHighBarIndex;
    }
    // L arm: high break starts a pullback in bear context.
    //        lSwingLow = latestLow (the true low of the
    //        down-move, even if the previous bar was an inside bar).
    if (highBreak && !lArmed) {
      lArmed = true;
      lSwingLow = latestLow;
      lSwingLowBarIndex = latestLowBarIndex;
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

      const depthOk = c.low <= ema21 + getAtr(c.timestamp) * atrDepthMultiplier;
      if (!usePullbackDepth || depthOk) {
        result.push({ time: c.timestamp, signal: `H${hCount}`, anchorIndex: hSwingHighBarIndex });
      }
    }

    // ── Fire L signal ────────────────────────────────────
    if (canFireL) {
      lCount++;
      lArmed = false;
      latestLow = c.low;   // reset tracker for next down-move

      const depthOk = c.high >= ema21 - getAtr(c.timestamp) * atrDepthMultiplier;
      if (!usePullbackDepth || depthOk) {
        result.push({ time: c.timestamp, signal: `L${lCount}`, anchorIndex: lSwingLowBarIndex });
      }
    }

    // ── 1. Reset checks (highest priority) ───────────────
    // H reset: price exceeds hSwingHigh → trend resumed,
    //          count resets and current arm is invalidated.
    if (hSwingHigh !== -Infinity && c.high > hSwingHigh) {
      hCount = 0;
      hArmed = false;
      hSwingHigh = -Infinity;
    }
    // L reset: price drops below lSwingLow → bear trend resumed.
    if (lSwingLow !== Infinity && c.low < lSwingLow) {
      lCount = 0;
      lArmed = false;
      lSwingLow = Infinity;
    }

  }

  return result;
}
