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
      // Logic for Long SL Distance: abs(min(low[0], low[1]) - close[0]) + 2
      const minLow = Math.min(current.low, prev.low);
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
      // Logic for Short SL Distance: abs(max(high[0], high[1]) - close[0]) + 2
      const maxHigh = Math.max(current.high, prev.high);
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
      });
    }
  }

  return result;
}

export type AlBrooksSignal = 'H1' | 'H2' | 'H3' | 'L1' | 'L2' | 'L3';

export interface AlBrooksMarker {
  time: number;
  signal: AlBrooksSignal;
}

/**
 * Calculate Al Brooks H1/H2/H3 – L1/L2/L3 pullback signals.
 *
 * Core logic:
 *   - Bias: close > EMA21 = Bull, close < EMA21 = Bear
 *   - Pullback starts when price fails to make a new trend extreme
 *   - Confirmed swing LOW (bull) = low[i-1] < low[i-2] AND low[i-1] < low[i]
 *   - Confirmed swing HIGH (bear) = high[i-1] > high[i-2] AND high[i-1] > high[i]
 *   - A candidate break level is stored when a swing is confirmed
 *   - A leg (H1/H2/H3 or L1/L2/L3) fires when price actually breaks that level
 *   - A new trend extreme resets the leg counter
 */
export function calculateAlBrooks(
  candles: Candle[],
  usePullbackDepth: boolean = false,
  atrDepthMultiplier: number = 1.0
): AlBrooksMarker[] {
  const result: AlBrooksMarker[] = [];

  if (!candles || candles.length < 22) return result;

  // ── ATR Calculation (14-period) ──────────────────────────
  const atrValues = usePullbackDepth ? calculateATR(candles, 14) : [];
  const getAtrAt = (timestamp: number) => {
    const found = atrValues.find(a => a.time === timestamp);
    return found ? found.value : 0;
  };

  // ── EMA 21 ───────────────────────────────────────────────
  const ema21Period = 21;
  const ema21Mult = 2 / (ema21Period + 1);
  let ema21 = 0;
  {
    let seed = 0;
    for (let i = 0; i < ema21Period; i++) seed += candles[i].close;
    ema21 = seed / ema21Period;
  }

  // ── State ─────────────────────────────────────────────────
  let highestHigh = NaN;
  let lowestLow = NaN;
  let legCount = 0;
  let inPullback = false;

  let candidateBullBreak = NaN; // high[i-1] of confirmed swing-low bar
  let candidateBearBreak = NaN; // low[i-1] of confirmed swing-high bar

  // ── Main loop (start at ema21Period so we have a valid EMA) ──
  for (let i = ema21Period; i < candles.length; i++) {
    const c = candles[i];
    const c1 = candles[i - 1]; // bar[-1]
    const c2 = candles[i - 2]; // bar[-2]

    // Update EMA21
    ema21 = (c.close - ema21) * ema21Mult + ema21;

    const bullBias = c.close > ema21;
    const bearBias = c.close < ema21;

    // Swing confirmation at bar[i] (pivot was at bar[i-1])
    const confirmSwingLo = c1.low < c2.low && c1.low < c.low;
    const confirmSwingHi = c1.high > c2.high && c1.high > c.high;

    // ── Candidate bull break check ───────────────────────────
    if (!isNaN(candidateBullBreak) && inPullback) {
      if (c.high > candidateBullBreak) {
        legCount++;
        if (legCount === 1) result.push({ time: c.timestamp, signal: 'H1' });
        else if (legCount === 2) result.push({ time: c.timestamp, signal: 'H2' });
        else if (legCount === 3) {
          result.push({ time: c.timestamp, signal: 'H3' });
          legCount = 0;
          inPullback = false;
        }
        candidateBullBreak = NaN;
      }
    }

    // ── Candidate bear break check ───────────────────────────
    if (!isNaN(candidateBearBreak) && inPullback) {
      if (c.low < candidateBearBreak) {
        legCount++;
        if (legCount === 1) result.push({ time: c.timestamp, signal: 'L1' });
        else if (legCount === 2) result.push({ time: c.timestamp, signal: 'L2' });
        else if (legCount === 3) {
          result.push({ time: c.timestamp, signal: 'L3' });
          legCount = 0;
          inPullback = false;
        }
        candidateBearBreak = NaN;
      }
    }

    // ════════════════════════════════════════
    // BULL BIAS
    // ════════════════════════════════════════
    if (bullBias) {
      const newHigh = isNaN(highestHigh) || c.high > highestHigh;

      if (newHigh) {
        highestHigh = c.high;
        if (inPullback) {
          // Trend resumed → reset
          legCount = 0;
          inPullback = false;
          candidateBullBreak = NaN;
        }
      } else {
        // Pullback starts when price stops making new highs
        if (!inPullback && c.high < highestHigh) {
          inPullback = true;
        }

        // Swing low confirmed during pullback
        if (inPullback && confirmSwingLo) {
          const swingLowPrice = c1.low;
          const swingLowBarHi = c1.high; // level to break upward

          const depthOk = usePullbackDepth ?
            (swingLowPrice <= ema21 + getAtrAt(c.timestamp) * atrDepthMultiplier) : true;

          if (depthOk) {
            if (c.high > swingLowBarHi) {
              // Already broken on confirmation bar — fire immediately
              legCount++;
              if (legCount === 1) result.push({ time: c.timestamp, signal: 'H1' });
              else if (legCount === 2) result.push({ time: c.timestamp, signal: 'H2' });
              else if (legCount === 3) {
                result.push({ time: c.timestamp, signal: 'H3' });
                legCount = 0;
                inPullback = false;
              }
              candidateBullBreak = NaN;
            } else {
              candidateBullBreak = swingLowBarHi;
            }
          }
        }
      }
    }

    // ════════════════════════════════════════
    // BEAR BIAS
    // ════════════════════════════════════════
    if (bearBias) {
      const newLow = isNaN(lowestLow) || c.low < lowestLow;

      if (newLow) {
        lowestLow = c.low;
        if (inPullback) {
          legCount = 0;
          inPullback = false;
          candidateBearBreak = NaN;
        }
      } else {
        if (!inPullback && c.low > lowestLow) {
          inPullback = true;
        }

        if (inPullback && confirmSwingHi) {
          const swingHighPrice = c1.high;
          const swingHighBarLo = c1.low; // level to break downward

          const depthOk = usePullbackDepth ?
            (swingHighPrice >= ema21 - getAtrAt(c.timestamp) * atrDepthMultiplier) : true;

          if (depthOk) {
            if (c.low < swingHighBarLo) {
              legCount++;
              if (legCount === 1) result.push({ time: c.timestamp, signal: 'L1' });
              else if (legCount === 2) result.push({ time: c.timestamp, signal: 'L2' });
              else if (legCount === 3) {
                result.push({ time: c.timestamp, signal: 'L3' });
                legCount = 0;
                inPullback = false;
              }
              candidateBearBreak = NaN;
            } else {
              candidateBearBreak = swingHighBarLo;
            }
          }
        }
      }
    }

    // Reset highest/lowest when bias flips
    if (!bullBias) highestHigh = NaN;
    if (!bearBias) lowestLow = NaN;
  }

  return result;
}


