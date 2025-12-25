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
export function parseColumnarData(data: ColumnarData): Candle[] {
    const candles: Candle[] = [];
    const length = data.t.length;

    for (let i = 0; i < length; i++) {
        candles.push({
            timestamp: data.t[i], // Assuming input is already in seconds or correct format
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

    // Group candles into buckets
    // We align to the timeframe boundaries (e.g. 09:15, 09:20, 09:25)
    // Assuming timestamps are in seconds

    let currentBucketStart = -1;
    let bucketCandles: Candle[] = [];

    for (const candle of candles) {
        const timestamp = candle.timestamp;

        // Find bucket start
        // If timestamp is 09:16:00 (secs), and timeframe is 5 min (300s)
        // 09:15 is the bucket start.
        // floor(time / 300) * 300
        const bucketStart = Math.floor(timestamp / timeframeSeconds) * timeframeSeconds;

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
