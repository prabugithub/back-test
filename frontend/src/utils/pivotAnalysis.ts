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

    // HT Structure Identification — NOT a true higher-timeframe read. This is a longer-lookback
    // EMA(60) slope proxy computed on the SAME base-timeframe `candles` array as ltMarket above (no
    // resampling to a real higher timeframe exists), reusing the same pivot-label checks (hasHH/
    // hasHL/hasLH/hasLL) as the LT branch above for the Reversal case. In sustained trends it
    // structurally tends to agree with ltMarket — don't assume LT/HT agreement or divergence here
    // reflects independent confirmation.
    let htMarket = 'Range';
    if (htSlope > 0.02 && lastPrice > currentEma60) {
        htMarket = 'Bull-Trend';
    } else if (htSlope < -0.02 && lastPrice < currentEma60) {
        htMarket = 'Bear-Trend';
    } else if (htSlope > 0 && lastPrice > currentEma60 && hasHL && !hasHH) {
        htMarket = 'Bull-Reversal'; // Potential MTR
    } else if (htSlope < 0 && lastPrice < currentEma60 && hasLH && !hasLL) {
        htMarket = 'Bear-Reversal'; // Potential MTR
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

export interface BarQualitySample {
    brr: number; // body-to-range ratio: |close-open| / (high-low) — high = trend bar, low = doji/spinning top
    clv: number; // close location value: (close-low) / (high-low) — near 1 = closed near high (bullish), near 0 = closed near low (bearish)
    uwr: number; // upper wick ratio: (high-max(open,close)) / (high-low) — large UWR on an up-close bar exposes rejection at highs (fakeout)
    lwr: number; // lower wick ratio: (min(open,close)-low) / (high-low) — large LWR on a down-close bar exposes rejection at lows (fakeout)
}

function barQualityOf(c: Candle): BarQualitySample {
    const range = c.high - c.low;
    if (range <= 0) return { brr: 0, clv: 0, uwr: 0, lwr: 0 };
    const body = Math.abs(c.close - c.open);
    const upperWick = c.high - Math.max(c.open, c.close);
    const lowerWick = Math.min(c.open, c.close) - c.low;
    return {
        brr: body / range,
        clv: (c.close - c.low) / range,
        uwr: upperWick / range,
        lwr: lowerWick / range,
    };
}

/**
 * Per-bar body/close/wick quality ratios (BRR, CLV, UWR, LWR — see BarQualitySample)
 * for the `lookback` bars ending at `currentIndex`. One sample per candle, oldest→
 * newest, so callers can read the bar-by-bar sequence across a leg (e.g. H1, H2, ...
 * for a 7-bar bull leg) rather than only a collapsed average. Zero-range bars
 * (high === low) yield all-zero ratios rather than NaN/Infinity. No previous-bar
 * comparison needed (unlike calculateBarOverlap), so the window may start at index 0.
 */
export function calculateBarQuality(candles: Candle[], currentIndex: number, lookback: number = 20): BarQualitySample[] {
    const samples: BarQualitySample[] = [];
    const start = Math.max(0, currentIndex - lookback + 1);
    for (let i = start; i <= currentIndex; i++) {
        samples.push(barQualityOf(candles[i]));
    }
    return samples;
}

/**
 * Mean BRR/CLV/UWR/LWR from calculateBarQuality samples. Undefined when the
 * window is empty — mirrors averageBarRanges' empty-input convention.
 */
export function averageBarQuality(samples: BarQualitySample[]): {
    brrAvg?: number;
    clvAvg?: number;
    uwrAvg?: number;
    lwrAvg?: number;
} {
    if (samples.length === 0) return {};
    const mean = (xs: number[]) => xs.reduce((sum, x) => sum + x, 0) / xs.length;
    return {
        brrAvg: mean(samples.map(s => s.brr)),
        clvAvg: mean(samples.map(s => s.clv)),
        uwrAvg: mean(samples.map(s => s.uwr)),
        lwrAvg: mean(samples.map(s => s.lwr)),
    };
}

/**
 * Kaufman Efficiency Ratio: net price displacement over the lookback window
 * divided by the total bar-to-bar distance traveled within it. Bounded in
 * [0,1] — near 1 means the window's moves were efficient/one-directional
 * (trend), near 0 means moves cancelled out (range/chop). Undefined when
 * there's no prior bar to measure from, or the window is perfectly flat
 * (zero total path, which would otherwise divide by zero).
 */
export function calculateEfficiencyRatio(candles: Candle[], currentIndex: number, lookback: number = 10): number | undefined {
    const start = Math.max(0, currentIndex - lookback);
    if (start >= currentIndex) return undefined;
    const netChange = Math.abs(candles[currentIndex].close - candles[start].close);
    let totalPath = 0;
    for (let i = start + 1; i <= currentIndex; i++) {
        totalPath += Math.abs(candles[i].close - candles[i - 1].close);
    }
    return totalPath > 0 ? netChange / totalPath : undefined;
}

export interface BarBreakCounts {
    highBreakCount: number; // bars where high_i > high_{i-1}
    lowBreakCount: number;  // bars where low_i < low_{i-1}
    barsCompared: number;   // actual bar-to-bar comparisons made (<= lookback, shorter early in a session)
}

/**
 * Counts, over the `lookback` bars ending at `currentIndex`, how many bars broke
 * the immediately preceding bar's high vs. how many broke its low (independent
 * counts — an outside bar breaking both counts toward both). A momentum/
 * persistence proxy distinct from bar overlap (range overlap) and bar range
 * (candle size): a trend can look fine on those while new-high frequency is
 * already dropping off, which is what this metric is meant to catch.
 */
export function calculateBarBreaks(candles: Candle[], currentIndex: number, lookback: number = 20): BarBreakCounts {
    const start = Math.max(1, currentIndex - lookback + 1);
    let highBreakCount = 0;
    let lowBreakCount = 0;
    let barsCompared = 0;
    for (let i = start; i <= currentIndex; i++) {
        const c = candles[i];
        const prev = candles[i - 1];
        if (c.high > prev.high) highBreakCount++;
        if (c.low < prev.low) lowBreakCount++;
        barsCompared++;
    }
    return { highBreakCount, lowBreakCount, barsCompared };
}

export interface ConsecutiveBreakRuns {
    maxConsecutiveHighBreaks: number; // longest run of bars: high > prev.high AND NOT low < prev.low
    maxConsecutiveLowBreaks: number;  // longest run of bars: low < prev.low AND NOT high > prev.high
}

/**
 * Longest run of consecutive directional breakout bars within [startIndex, endIndex]
 * — the Brooks "impulse micro-channel" test. A bar extends the high-run only when it
 * breaks the prior bar's high WITHOUT breaking its low (an outside bar breaks both
 * runs; an inside bar breaks both too). Distinct from calculateBarBreaks, which
 * counts total breaks in the window regardless of consecutiveness — a leg can have
 * many scattered high breaks yet never a clean 4-bar run.
 */
export function calculateConsecutiveBreaks(
    candles: Candle[],
    startIndex: number,
    endIndex: number
): ConsecutiveBreakRuns {
    let maxHigh = 0, maxLow = 0;
    let runHigh = 0, runLow = 0;
    const first = Math.max(1, startIndex + 1);
    for (let i = first; i <= Math.min(endIndex, candles.length - 1); i++) {
        const c = candles[i];
        const prev = candles[i - 1];
        const highBreak = c.high > prev.high;
        const lowBreak = c.low < prev.low;
        runHigh = highBreak && !lowBreak ? runHigh + 1 : 0;
        runLow = lowBreak && !highBreak ? runLow + 1 : 0;
        if (runHigh > maxHigh) maxHigh = runHigh;
        if (runLow > maxLow) maxLow = runLow;
    }
    return { maxConsecutiveHighBreaks: maxHigh, maxConsecutiveLowBreaks: maxLow };
}

/**
 * Slope (points-per-bar rate of change) of an EMA of the given period, measured
 * over slopeLookback bars ending at currentIndex. Same formula as the inline
 * getSlope() used by analyzeMarketStructure for regime detection, generalized
 * to run at any historical index and return undefined (not 0) when there isn't
 * enough history — analyzeMarketStructure's 0-default is a regime-threshold
 * convenience specific to that function, not appropriate for raw instrumentation.
 */
export function calculateEMASlope(candles: Candle[], currentIndex: number, period: number, slopeLookback: number): number | undefined {
    const visible = candles.slice(0, currentIndex + 1);
    const ema = calculateEMA(visible, period);
    if (ema.length < slopeLookback + 1) return undefined;
    const current = ema[ema.length - 1].value;
    const prior = ema[ema.length - 1 - slopeLookback].value;
    return (current - prior) / slopeLookback;
}

export interface EMAInteractionStats {
    gapBarRatio?: number;      // fraction of bars whose full range doesn't touch the EMA (Brooks "gap bar" — strong-trend signal)
    closeAboveRatio?: number;  // fraction of closes above the EMA ("always-in" bias; below = 1 - this)
    barsCompared: number;      // actual window size used (<= configured lookback, shorter early in a session, or 0 if EMA not yet defined)
}

/**
 * Brooks-style EMA interaction stats over the lookback bars ending at
 * currentIndex, for the given EMA period (defaults to 20 — Brooks' standard
 * MA). Reuses the same touch/buffer tolerance as calculateMAPosition's
 * on-MA/gap check (0.01% of the EMA value) rather than inventing a new one.
 */
export function calculateEMAInteraction(candles: Candle[], currentIndex: number, period: number = 20, lookback: number = 20): EMAInteractionStats {
    const visible = candles.slice(0, currentIndex + 1);
    const ema = calculateEMA(visible, period);
    if (ema.length === 0) return { barsCompared: 0 };

    const emaMap = new Map(ema.map(e => [e.time, e.value]));
    const start = Math.max(period - 1, currentIndex - lookback + 1);
    const bufferMult = 0.0001;

    let touchless = 0;
    let aboveCount = 0;
    let barsCompared = 0;

    for (let i = start; i <= currentIndex; i++) {
        const c = candles[i];
        const maVal = emaMap.get(c.timestamp);
        if (maVal === undefined) continue;
        const buffer = maVal * bufferMult;
        const touches = c.low <= maVal + buffer && c.high >= maVal - buffer;
        if (!touches) touchless++;
        if (c.close > maVal) aboveCount++;
        barsCompared++;
    }

    if (barsCompared === 0) return { barsCompared: 0 };
    return {
        gapBarRatio: touchless / barsCompared,
        closeAboveRatio: aboveCount / barsCompared,
        barsCompared,
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

export interface PivotSequenceStats {
    highSeq: string[];      // last up-to-4 bearish trendLabels (oldest→newest), e.g. ['LH','HH','HH','HH']
    lowSeq: string[];       // last up-to-4 bullish trendLabels (oldest→newest), e.g. ['LL','LL','HL','HL']
    highGapsBars: number[]; // bar-count gaps between consecutive entries in highSeq (length = highSeq.length - 1)
    lowGapsBars: number[];  // bar-count gaps between consecutive entries in lowSeq
}

/**
 * Separately tracks the last `count` bearish-pivot labels (highs: HH/LH) and
 * bullish-pivot labels (lows: HL/LL), plus the bar-count gap between each
 * consecutive pivot within each sequence — a pace/acceleration proxy distinct
 * from determineLLHHPivot's single-most-recent-pivot snapshot.
 */
export function getPivotSequenceStats(pivots: PivotPoint[], count: number = 4): PivotSequenceStats {
    const bears = pivots.filter(p => p.type === 'bearish' && p.trendLabel).slice(-count);
    const bulls = pivots.filter(p => p.type === 'bullish' && p.trendLabel).slice(-count);
    const gaps = (arr: PivotPoint[]) => arr.slice(1).map((p, i) => p.barIndex - arr[i].barIndex);
    return {
        highSeq: bears.map(p => p.trendLabel!),
        lowSeq: bulls.map(p => p.trendLabel!),
        highGapsBars: gaps(bears),
        lowGapsBars: gaps(bulls),
    };
}

/**
 * Mean bar-count gap across both the high and low sequence gaps. Undefined
 * when there are fewer than 2 pivots of either type (no gaps to measure).
 */
export function averagePivotGapBars(stats: PivotSequenceStats): number | undefined {
    const all = [...stats.highGapsBars, ...stats.lowGapsBars];
    if (all.length === 0) return undefined;
    return all.reduce((sum, g) => sum + g, 0) / all.length;
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
