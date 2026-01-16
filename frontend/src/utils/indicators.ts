import type { Candle } from '../types';

/**
 * Calculate Simple Moving Average (SMA)
 */
export function calculateSMA(candles: Candle[], period: number) {
  const result: Array<{ time: number; value: number }> = [];

  for (let i = period - 1; i < candles.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) {
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
  const multiplier = 2 / (period + 1);

  // First EMA is SMA
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += candles[i].close;
  }
  let ema = sum / period;
  result.push({
    time: candles[period - 1].timestamp,
    value: ema,
  });

  // Calculate EMA for remaining candles
  for (let i = period; i < candles.length; i++) {
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

export interface PivotPoint {
  time: number;
  type: 'bullish' | 'bearish';
  price: number;
}

/**
 * Calculate Reversal Pivot Points (Bullish and Bearish)
 * Based on advanced candlestick pattern analysis
 * Detects reversal patterns using multiple candle confirmation
 */
export function calculatePivotPoints(candles: Candle[]): PivotPoint[] {
  const result: PivotPoint[] = [];

  // Need at least 5 candles to detect pivots (current + 4 previous)
  for (let i = 4; i < candles.length; i++) {
    const current = candles[i];      // index 0 in Pine Script
    const prev = candles[i - 1];     // index 1 in Pine Script
    const prev2 = candles[i - 2];    // index 2 in Pine Script
    const prev3 = candles[i - 3];    // index 3 in Pine Script

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

    // Condition 1 OR: Three-candle bullish reversal pattern
    const condition1_bull_or =
      current.close > current.open &&           // Current is bullish
      prev.close > prev.open &&                 // Previous is bullish
      prev.close < current.close &&             // Current closes higher than previous
      prev2.close < prev2.open &&               // Two back is bearish
      prev2.close < prev3.low &&                // Two back closes below three back's low
      !isPreviousBullPivot;

    // Condition 3: Two back is bearish and breaks below three back's low
    const condition3_bull =
      prev2.close < prev2.open &&
      prev2.close < prev3.low;

    // Combined bullish signal
    const bullishPivot = (condition1_bull_or || condition1_bull) && condition3_bull;

    if (bullishPivot) {
      result.push({
        time: current.timestamp,
        type: 'bullish',
        price: current.low, // Place marker at the low of the bullish pivot candle
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

    // Condition 1 OR: Three-candle bearish reversal pattern
    const condition1_bear_or =
      current.close < current.open &&           // Current is bearish
      prev.close < prev.open &&                 // Previous is bearish
      prev.close > current.close &&             // Current closes lower than previous
      prev2.close > prev2.open &&               // Two back is bullish
      prev2.close > prev3.high &&               // Two back closes above three back's high
      !isPreviousBearPivot;

    // Condition 3: Two back is bullish and breaks above three back's high
    const condition3_bear =
      prev2.close > prev2.open &&
      prev2.close > prev3.high;

    // Combined bearish signal
    const bearishPivot = condition1_bear_or || condition1_bear && condition3_bear;

    if (bearishPivot) {
      result.push({
        time: current.timestamp,
        type: 'bearish',
        price: current.high, // Place marker at the high of the bearish pivot candle
      });
    }
  }

  return result;
}
