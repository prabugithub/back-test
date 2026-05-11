import type { Candle } from '../types';

export interface ColumnarData {
    t: number[];
    o: number[];
    h: number[];
    l: number[];
    c: number[];
    v: number[];
}

/**
 * Parse columnar data (arrays) into array of Candle objects
 */
export function parseColumnarData(data: ColumnarData, timestampOffset: number = 0): Candle[] {
    const candles: Candle[] = [];
    const length = data.t.length;

    for (let i = 0; i < length; i++) {
        candles.push({
            timestamp: data.t[i] + timestampOffset,
            open: data.o[i],
            high: data.h[i],
            low: data.l[i],
            close: data.c[i],
            volume: data.v[i],
        });
    }

    return candles;
}

/**
 * Resample 1-minute candles to a larger timeframe
 * @param candles Source 1-minute candles
 * @param timeframeMinutes Target timeframe in minutes (5, 15, 60, etc.)
 */
export function resampleCandles(candles: Candle[], timeframeMinutes: number): Candle[] {
    if (timeframeMinutes <= 1) return candles;

    const resampled: Candle[] = [];
    const timeframeSeconds = timeframeMinutes * 60;

    // IST = UTC+5:30 = 19800 seconds ahead of UTC.
    // Indian market session opens at 09:15 IST = 33300 seconds from IST midnight.
    // We bucket relative to session open so that 60m candles start at 09:15, 10:15, ...
    // and 1D candles carry the 09:15 timestamp of that trading day.
    const IST_OFFSET = 19800;          // seconds
    const SESSION_START = 9 * 3600 + 15 * 60; // 09:15 in seconds from IST midnight

    let currentBucketStart = -1;
    let bucketCandles: Candle[] = [];

    for (const candle of candles) {
        const timestamp = candle.timestamp;

        // Convert to IST, split into day and intra-day parts
        const tsIst = timestamp + IST_OFFSET;
        const timeInDay = tsIst % 86400;           // seconds past IST midnight
        const istDayStart = tsIst - timeInDay;     // IST midnight (epoch seconds in IST)

        // Seconds elapsed since session open (09:15 IST)
        const sincOpen = timeInDay - SESSION_START;
        // Which bucket within the session (negative means pre-market, treated as bucket 0)
        const bucketIdx = Math.max(0, Math.floor(sincOpen / timeframeSeconds));

        // Bucket start in UTC epoch seconds
        const bucketStart = (istDayStart + SESSION_START + bucketIdx * timeframeSeconds) - IST_OFFSET;

        if (currentBucketStart === -1) {
            currentBucketStart = bucketStart;
            bucketCandles.push(candle);
        } else if (bucketStart === currentBucketStart) {
            bucketCandles.push(candle);
        } else {
            // Finalize previous bucket
            if (bucketCandles.length > 0) {
                resampled.push(aggregateCandles(bucketCandles, currentBucketStart));
            }

            // Start new bucket
            currentBucketStart = bucketStart;
            bucketCandles = [candle];
        }
    }

    // Push last bucket
    if (bucketCandles.length > 0) {
        resampled.push(aggregateCandles(bucketCandles, currentBucketStart));
    }

    return resampled;
}

/**
 * Returns the IST-aligned bucket start timestamp (UTC epoch seconds) for a given
 * candle timestamp and timeframe. Used by the live candle updater to decide
 * whether to extend the last HTF candle or open a new one.
 */
export function getISTBucket(timestamp: number, timeframeMinutes: number): number {
    const timeframeSeconds = timeframeMinutes * 60;
    const IST_OFFSET = 19800;
    const SESSION_START = 9 * 3600 + 15 * 60;

    const tsIst = timestamp + IST_OFFSET;
    const timeInDay = tsIst % 86400;
    const istDayStart = tsIst - timeInDay;
    const sincOpen = timeInDay - SESSION_START;
    const bucketIdx = Math.max(0, Math.floor(sincOpen / timeframeSeconds));
    return (istDayStart + SESSION_START + bucketIdx * timeframeSeconds) - IST_OFFSET;
}

/**
 * Helper to aggregate a list of candles into one
 */
function aggregateCandles(candles: Candle[], timestamp: number): Candle {
    const open = candles[0].open;
    const close = candles[candles.length - 1].close;

    let high = -Infinity;
    let low = Infinity;
    let volume = 0;

    for (const c of candles) {
        if (c.high > high) high = c.high;
        if (c.low < low) low = c.low;
        volume += c.volume;
    }

    return {
        timestamp, // The start time of the bucket
        open,
        high,
        low,
        close,
        volume,
    };
}
