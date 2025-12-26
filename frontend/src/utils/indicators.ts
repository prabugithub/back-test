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
 * Calculate Pivot Points (Bullish and Bearish)
 * Based on candlestick pattern analysis
 */
export function calculatePivotPoints(candles: Candle[]): PivotPoint[] {
  const result: PivotPoint[] = [];

  // Need at least 4 candles to detect pivots (current + 3 previous)
  for (let i = 3; i < candles.length; i++) {
    const current = candles[i];
    const prev = candles[i - 1];
    const prev2 = candles[i - 2];

    // Bullish Pivot Conditions
    // Condition 1: Current close > previous high AND current close > previous open AND current close > current open
    const condition1_bull =
      current.close > prev.high &&
      current.close > prev.open &&
      current.close > current.open;

    // Condition 3: Candle 2 (two back) is bearish AND previous candle closes below candle 2's open
    const condition3_bull =
      prev2.close < prev2.open && prev.close < prev2.open;

    const bullishPivot = condition1_bull && condition3_bull;

    if (bullishPivot) {
      result.push({
        time: current.timestamp,
        type: 'bullish',
        price: current.low, // Place marker at the low of the bullish pivot candle
      });
    }

    // Bearish Pivot Conditions
    // Condition 1: Current low < previous low AND current close < current open
    const condition1_bear =
      current.low < prev.low && current.close < current.open;

    // Condition 2: Previous high > two candles back high
    const condition2_bear = prev.high > prev2.high;

    const bearishPivot = condition1_bear && condition2_bear;

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
