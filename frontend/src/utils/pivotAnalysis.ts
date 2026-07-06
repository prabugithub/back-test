import type { Candle } from '../types';
import { calculatePivotPoints, calculateEMA, type PivotPoint } from './indicators';

export interface PivotAnalysisResult {
    llhhPivot: 'HH-HL' | 'HH-LL' | 'LH-HL' | 'LH-LL' | '';
    entryPosition: 'gap' | 'on-MA' | 'gap-opposite' | '';
    ltMarket: string;
    htMarket: string;
}

/**
 * Analyzes the most recent pivot point and determines:
 * 1. LLHH-Pivot: The trend pattern (HH-HL, HH-LL, LH-HL, LH-LL)
 * 2. EntryPosition: Whether the pivot is on MA, gap (same side as trade), or gap-opposite
 */
export function analyzePivotForTrade(
    candles: Candle[],
    currentIndex: number,
    tradeType: 'BUY' | 'SELL'
): PivotAnalysisResult {
    const result: PivotAnalysisResult = {
        llhhPivot: '',
        entryPosition: '',
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
    result.llhhPivot = determineLLHHPivot(pivots);

    // ONLY set entryPosition if the pivot is EXACTLY at the current index (Pivot Entry)
    // Otherwise, we leave it empty so the caller can fallback to manual analysis
    const isPivotAtCurrent = recentPivot.time === candles[currentIndex].timestamp;
    if (isPivotAtCurrent) {
        result.entryPosition = determinePivotPosition(visibleCandles, recentPivot, tradeType);
    }

    // Analyze Market Structure
    const marketStructure = analyzeMarketStructure(visibleCandles, pivots);
    result.ltMarket = marketStructure.ltMarket;
    result.htMarket = marketStructure.htMarket;

    return result;
}

/**
 * Specifically for manual entries:
 * 1. Checks relationship of the LAST THREE candles with MA
 * 2. Still finds the RECENT pivot to determine LLHH trend
 */
export function analyzeManualEntry(
    candles: Candle[],
    currentIndex: number,
    tradeType: 'BUY' | 'SELL'
): PivotAnalysisResult {
    const result: PivotAnalysisResult = {
        llhhPivot: '',
        entryPosition: '',
        ltMarket: 'Range',
        htMarket: 'Range',
    };

    if (!candles || candles.length < 5 || currentIndex < 2) {
        return result;
    }

    const visibleCandles = candles.slice(0, currentIndex + 1);
    const pivots = calculatePivotPoints(visibleCandles);

    // 1. LLHH-Pivot from recent pivots
    if (pivots.length > 0) {
        result.llhhPivot = determineLLHHPivot(pivots);
    }

    // 2. entryPosition from LAST THREE candles (currentIndex, currentIndex-1, currentIndex-2)
    result.entryPosition = calculateMAPosition(candles, currentIndex, tradeType);

    // 3. Market Structure
    if (pivots.length > 0) {
        const marketStructure = analyzeMarketStructure(visibleCandles, pivots);
        result.ltMarket = marketStructure.ltMarket;
        result.htMarket = marketStructure.htMarket;
    }

    return result;
}

/**
 * Automatically identifies market structure (Trend, Range, Reversal)
 */
export function analyzeMarketStructure(candles: Candle[], pivots: PivotPoint[]): { ltMarket: string, htMarket: string } {
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
    const currentEma21 = ema21.length > 0 ? ema21[ema21.length - 1].value : lastPrice;
    const currentEma60 = ema60.length > 0 ? ema60[ema60.length - 1].value : lastPrice;

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
 * Raw per-bar overlap ratio for the `lookback` bars ending at `currentIndex` (rolling
 * bar-to-bar comparison, unclamped — same math as the overlap check inside
 * analyzeMarketStructure, generalized to run at any historical index). Used to
 * instrument trade records for later range/regime labeling; only reads indices
 * <= currentIndex so it's safe to call at entry time without look-ahead.
 */
export function calculateBarOverlap(candles: Candle[], currentIndex: number, lookback: number = 8): number[] {
    const ratios: number[] = [];
    const start = Math.max(1, currentIndex - lookback + 1);
    for (let i = start; i <= currentIndex; i++) {
        const c = candles[i];
        const prev = candles[i - 1];
        const totalRange = Math.max(c.high, prev.high) - Math.min(c.low, prev.low);
        const overlapRange = Math.min(c.high, prev.high) - Math.max(c.low, prev.low);
        ratios.push(totalRange > 0 ? overlapRange / totalRange : 0);
    }
    return ratios;
}

/**
 * Mean of the raw ratios from calculateBarOverlap. Kept as a separate helper
 * (rather than inlined at each call site) so both entry-record-construction
 * paths derive the average identically. Returns undefined when there was no
 * prior bar to compare against (empty ratios array).
 */
export function averageBarOverlap(ratios: number[]): number | undefined {
    if (ratios.length === 0) return undefined;
    return ratios.reduce((sum, r) => sum + r, 0) / ratios.length;
}

/**
 * Per-bar range (high-low) and direction for the `lookback` bars ending at
 * `currentIndex` — a trend-strength proxy (bull bars vs bear bars getting
 * bigger/smaller). Direction is 'neutral' only for an exact doji
 * (close === open); near-doji bars with a nonzero body still fall to
 * whichever side their close/open sign tips. No previous-bar comparison is
 * needed (unlike calculateBarOverlap), so the window may start at index 0.
 */
export interface BarRangeSample {
    range: number; // high - low
    direction: 'bull' | 'bear' | 'neutral';
}

export function calculateBarRanges(candles: Candle[], currentIndex: number, lookback: number = 20): BarRangeSample[] {
    const samples: BarRangeSample[] = [];
    const start = Math.max(0, currentIndex - lookback + 1);
    for (let i = start; i <= currentIndex; i++) {
        const c = candles[i];
        const direction = c.close > c.open ? 'bull' : c.close < c.open ? 'bear' : 'neutral';
        samples.push({ range: c.high - c.low, direction });
    }
    return samples;
}

/**
 * Derives the overall/bull/bear mean range from calculateBarRanges samples.
 * Each average is undefined when its bucket is empty (e.g. no bear bars in
 * the window) — not 0 — mirroring averageBarOverlap's empty-input convention.
 */
export function averageBarRanges(samples: BarRangeSample[]): {
    barRangeAvg?: number;
    bullBarRangeAvg?: number;
    bearBarRangeAvg?: number;
} {
    if (samples.length === 0) return {};
    const mean = (xs: BarRangeSample[]) =>
        xs.length > 0 ? xs.reduce((sum, x) => sum + x.range, 0) / xs.length : undefined;
    return {
        barRangeAvg: mean(samples),
        bullBarRangeAvg: mean(samples.filter(s => s.direction === 'bull')),
        bearBarRangeAvg: mean(samples.filter(s => s.direction === 'bear')),
    };
}

/**
 * Determines the LLHH-Pivot pattern based on recent pivot points
 */
export function determineLLHHPivot(pivots: PivotPoint[]): 'HH-HL' | 'HH-LL' | 'LH-HL' | 'LH-LL' | '' {
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
 * Generic function to calculate MA position for any given 3 candles ending at 'index'
 */
function calculateMAPosition(
    candles: Candle[],
    index: number,
    tradeType: 'BUY' | 'SELL'
): 'gap' | 'on-MA' | 'gap-opposite' | '' {
    const ema21 = calculateEMA(candles, 21);
    if (ema21.length === 0 || index < 2) return '';

    const testCandles = [
        candles[index],
        candles[index - 1],
        candles[index - 2],
    ];

    // Build lookup map for efficiency
    const maMap = new Map(ema21.map(m => [m.time, m.value]));

    const maValues = testCandles.map(c => maMap.get(c.timestamp) ?? null);

    if (maValues.some(ma => ma === null)) return '';

    // Use a small buffer to avoid floating point precision issues
    // 0.0001 (0.01%) is usually plenty to distinguish a gap from a touch
    const bufferMult = 0.0001;

    const allClosesAboveMA = testCandles.every((c, i) => c.close > maValues[i]!);
    const allClosesBelowMA = testCandles.every((c, i) => c.close < maValues[i]!);

    if (tradeType === 'BUY') {
        if (allClosesBelowMA) return 'gap-opposite';

        const anyLowTouchesMA = testCandles.some((c, i) => {
            const ma = maValues[i]!;
            const buffer = ma * bufferMult;
            // Touches if: low <= MA <= high (with small buffer room)
            return c.low <= ma + buffer && c.high >= ma - buffer;
        });

        if (anyLowTouchesMA) return 'on-MA';
        return 'gap';
    } else {
        if (allClosesAboveMA) return 'gap-opposite';

        const anyHighTouchesMA = testCandles.some((c, i) => {
            const ma = maValues[i]!;
            const buffer = ma * bufferMult;
            return c.low <= ma + buffer && c.high >= ma - buffer;
        });

        if (anyHighTouchesMA) return 'on-MA';
        return 'gap';
    }
}

/**
 * Determines the pivot position relative to the MA
 */
function determinePivotPosition(
    candles: Candle[],
    pivot: PivotPoint,
    tradeType: 'BUY' | 'SELL'
): 'gap' | 'on-MA' | 'gap-opposite' | '' {
    const pivotIndex = candles.findIndex(c => c.timestamp === pivot.time);
    if (pivotIndex === -1) return '';
    return calculateMAPosition(candles, pivotIndex, tradeType);
}
