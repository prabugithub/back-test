import type { Candle } from '../types';
import { calculatePivotPoints, calculateEMA, type PivotPoint } from './indicators';

export interface PivotAnalysisResult {
    llhhPivot: 'HH-HL' | 'HH-LL' | 'LH-HL' | 'LH-LL' | '';
    pivotPosition: 'gap' | 'on-MA' | 'gap-opposite' | '';
    ltMarket: string;
    htMarket: string;
}

/**
 * Analyzes the most recent pivot point and determines:
 * 1. LLHH-Pivot: The trend pattern (HH-HL, HH-LL, LH-HL, LH-LL)
 * 2. PivotPosition: Whether the pivot is on MA, gap (same side as trade), or gap-opposite
 */
export function analyzePivotForTrade(
    candles: Candle[],
    currentIndex: number,
    tradeType: 'BUY' | 'SELL'
): PivotAnalysisResult {
    const result: PivotAnalysisResult = {
        llhhPivot: '',
        pivotPosition: '',
        ltMarket: 'Range',
        htMarket: 'Range',
    };

    // Need enough candles for analysis
    if (!candles || candles.length < 5 || currentIndex < 4) {
        return result;
    }

    // Get visible candles up to current index
    const visibleCandles = candles.slice(0, currentIndex + 1);

    // Calculate pivot points
    const pivots = calculatePivotPoints(visibleCandles);

    if (pivots.length === 0) {
        return result;
    }

    // Get the most recent pivot point
    const recentPivot = pivots[pivots.length - 1];

    // Determine LLHH-Pivot based on the pivot type and trend labels
    result.llhhPivot = determineLLHHPivot(pivots, recentPivot);

    // Determine PivotPosition based on MA relationship
    result.pivotPosition = determinePivotPosition(visibleCandles, recentPivot, tradeType);

    // Analyze Market Structure
    const marketStructure = analyzeMarketStructure(visibleCandles, pivots);
    result.ltMarket = marketStructure.ltMarket;
    result.htMarket = marketStructure.htMarket;

    return result;
}

/**
 * Automatically identifies market structure (Trend, Range, Reversal)
 */
function analyzeMarketStructure(candles: Candle[], pivots: PivotPoint[]): { ltMarket: string, htMarket: string } {
    if (candles.length < 25) return { ltMarket: 'Range', htMarket: 'Range' };

    const ema21 = calculateEMA(candles, 21);
    const ema60 = calculateEMA(candles, 60);

    const getSlope = (ema: { value: number }[], lookback: number) => {
        if (ema.length < lookback + 1) return 0;
        const current = ema[ema.length - 1].value;
        const prev = ema[ema.length - 1 - lookback].value;
        return (current - prev) / lookback;
    };

    const ltSlope = getSlope(ema21, 10);
    const htSlope = getSlope(ema60, 20);

    const lastPrice = candles[candles.length - 1].close;
    const currentEma21 = ema21[ema21.length - 1].value;
    const currentEma60 = ema60[ema60.length - 1].value;

    // Check bar overlap (Range vs Trend)
    let overlapCount = 0;
    const overlapLookback = 10;
    for (let i = candles.length - overlapLookback; i < candles.length; i++) {
        const c = candles[i];
        const prev = candles[i - 1];
        if (c.high > prev.low && c.low < prev.high) {
            const overlapRange = Math.min(c.high, prev.high) - Math.max(c.low, prev.low);
            const totalRange = Math.max(c.high, prev.high) - Math.min(c.low, prev.low);
            if (overlapRange / totalRange > 0.5) overlapCount++;
        }
    }
    const isHighOverlap = overlapCount > 6;

    // Analyze Pivots
    const lastPivots = pivots.slice(-4);
    const hasHH = lastPivots.some(p => p.trendLabel === 'HH');
    const hasLL = lastPivots.some(p => p.trendLabel === 'LL');
    const hasHL = lastPivots.some(p => p.trendLabel === 'HL');
    const hasLH = lastPivots.some(p => p.trendLabel === 'LH');

    // LT Structure Identification
    let ltMarket = 'Range';
    if (ltSlope > 0.05 && lastPrice > currentEma21 && hasHH && hasHL) {
        ltMarket = isHighOverlap ? 'Bull-Trending-range' : 'Bull-Trend';
    } else if (ltSlope < -0.05 && lastPrice < currentEma21 && hasLL && hasLH) {
        ltMarket = isHighOverlap ? 'Bear-Trending-range' : 'Bear-Trend';
    } else if (ltSlope > 0 && lastPrice > currentEma21 && hasHL && !hasHH) {
        ltMarket = 'Bull-Reversal'; // Potential MTR
    } else if (ltSlope < 0 && lastPrice < currentEma21 && hasLH && !hasLL) {
        ltMarket = 'Bear-Reversal'; // Potential MTR
    }

    // HT Structure Identification (Proxy using 60 EMA and longer lookback)
    let htMarket = 'Range';
    if (htSlope > 0.02 && lastPrice > currentEma60) {
        htMarket = 'Bull-Trend';
    } else if (htSlope < -0.02 && lastPrice < currentEma60) {
        htMarket = 'Bear-Trend';
    }

    return { ltMarket, htMarket };
}

/**
 * Determines the LLHH-Pivot pattern based on recent pivot points
 */
function determineLLHHPivot(pivots: PivotPoint[], recentPivot: PivotPoint): 'HH-HL' | 'HH-LL' | 'LH-HL' | 'LH-LL' | '' {
    // Find the last bullish and bearish pivots
    let lastBullishPivot: PivotPoint | null = null;
    let lastBearishPivot: PivotPoint | null = null;

    // Iterate backwards to find the most recent of each type
    for (let i = pivots.length - 1; i >= 0; i--) {
        if (pivots[i].type === 'bullish' && !lastBullishPivot) {
            lastBullishPivot = pivots[i];
        }
        if (pivots[i].type === 'bearish' && !lastBearishPivot) {
            lastBearishPivot = pivots[i];
        }
        if (lastBullishPivot && lastBearishPivot) {
            break;
        }
    }

    // Need both types of pivots to determine the pattern
    if (!lastBullishPivot || !lastBearishPivot) {
        return '';
    }

    // Get the trend labels (HH/LH for bearish, HL/LL for bullish)
    const bearishLabel = lastBearishPivot.trendLabel || '';
    const bullishLabel = lastBullishPivot.trendLabel || '';

    // Combine them to form the pattern
    // Format: {BearishLabel}-{BullishLabel}
    if (bearishLabel && bullishLabel) {
        return `${bearishLabel}-${bullishLabel}` as 'HH-HL' | 'HH-LL' | 'LH-HL' | 'LH-LL';
    }

    return '';
}

/**
 * Determines the pivot position relative to the MA
 * - 'on-MA': Any of the three pivot candles' close is very near MA (within small threshold)
 * - 'gap-opposite': ALL three pivot candles close on opposite side of MA from trade direction
 * - 'gap': Default when not on-MA or gap-opposite
 */
function determinePivotPosition(
    candles: Candle[],
    pivot: PivotPoint,
    tradeType: 'BUY' | 'SELL'
): 'gap' | 'on-MA' | 'gap-opposite' | '' {
    // Calculate EMA21 (commonly used MA)
    const ema21 = calculateEMA(candles, 21);

    if (ema21.length === 0) {
        return '';
    }

    // Find the pivot candle index
    const pivotIndex = candles.findIndex(c => c.timestamp === pivot.time);

    if (pivotIndex < 2) {
        return '';
    }

    // Get the three candles that form the pivot (current and 2 previous)
    const pivotCandles = [
        candles[pivotIndex],
        candles[pivotIndex - 1],
        candles[pivotIndex - 2],
    ];

    // Get MA values for all three pivot candles
    const maValues = pivotCandles.map(candle => {
        const maAtCandle = ema21.find(ma => ma.time === candle.timestamp);
        return maAtCandle ? maAtCandle.value : null;
    });

    // If we can't find MA values for all candles, return empty
    if (maValues.some(ma => ma === null)) {
        return '';
    }

    // Check if ALL three pivot candles' closes are above or below MA
    const allClosesAboveMA = pivotCandles.every((candle, index) => {
        const maValue = maValues[index]!;
        return candle.close > maValue;
    });

    const allClosesBelowMA = pivotCandles.every((candle, index) => {
        const maValue = maValues[index]!;
        return candle.close < maValue;
    });

    // For LONG trades (BUY):
    // - gap-opposite: ALL three closes below MA (opposite side - check CLOSE only)
    // - on-MA: Any candle's LOW touches MA from above (same side - check WICK)
    // - gap: Default

    // For SHORT trades (SELL):
    // - gap-opposite: ALL three closes above MA (opposite side - check CLOSE only)
    // - on-MA: Any candle's HIGH touches MA from below (same side - check WICK)
    // - gap: Default

    if (tradeType === 'BUY') {
        // First check gap-opposite (all closes below MA)
        if (allClosesBelowMA) {
            return 'gap-opposite';
        }

        // Then check on-MA (any candle's low touches MA from above)
        // This means: candle is above MA but wick touches it
        const anyLowTouchesMA = pivotCandles.some((candle, index) => {
            const maValue = maValues[index]!;
            // Candle touches MA if: low <= MA <= high
            return candle.low <= maValue && candle.high >= maValue;
        });

        if (anyLowTouchesMA) {
            return 'on-MA';
        }

        // Default to gap
        return 'gap';

    } else {
        // SHORT trade
        // First check gap-opposite (all closes above MA)
        if (allClosesAboveMA) {
            return 'gap-opposite';
        }

        // Then check on-MA (any candle's high touches MA from below)
        // This means: candle is below MA but wick touches it
        const anyHighTouchesMA = pivotCandles.some((candle, index) => {
            const maValue = maValues[index]!;
            // Candle touches MA if: low <= MA <= high
            return candle.low <= maValue && candle.high >= maValue;
        });

        if (anyHighTouchesMA) {
            return 'on-MA';
        }

        // Default to gap
        return 'gap';
    }
}


