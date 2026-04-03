import { fetchHistoricalCandles as fetchDhanCandles } from './dhan.service';
import { Candle, GetCandlesRequest } from '../types';
import logger from '../utils/logger';

const IS_SIM = process.env.DHAN_SIMULATION === 'true';

// Base prices for synthetic candle generation in simulation mode
const SIM_BASE_PRICES: Record<string, number> = {
    '13': 22700,  // NIFTY 50
    '25': 49500,  // BANKNIFTY
};
const SIM_DEFAULT_BASE = 22700;

/**
 * Generates 200 synthetic 5-min candles ending at ~now for simulation mode.
 * Gives the chart enough seed data so live ticks can update the last candle.
 */
function generateSimCandles(securityId: string, intervalMinutes: number): Candle[] {
    const base = SIM_BASE_PRICES[securityId] ?? SIM_DEFAULT_BASE;
    const count = 200;
    const stepSec = intervalMinutes * 60;
    // Align to current candle boundary and work backwards
    const now = Math.floor(Date.now() / 1000);
    const latestBucket = Math.floor(now / stepSec) * stepSec;
    const candles: Candle[] = [];
    let price = base;

    for (let i = count - 1; i >= 0; i--) {
        const ts = latestBucket - i * stepSec;
        const change = (Math.random() - 0.5) * base * 0.002;
        const open = price;
        const close = parseFloat((price + change).toFixed(2));
        const high = parseFloat((Math.max(open, close) + Math.random() * base * 0.001).toFixed(2));
        const low  = parseFloat((Math.min(open, close) - Math.random() * base * 0.001).toFixed(2));
        candles.push({ timestamp: ts, open, high, low, close, volume: Math.floor(Math.random() * 5000) + 500 });
        price = close;
    }

    return candles;
}

/**
 * Get candles - TEMPORARILY MODIFIED FOR EXCLUSIVE DHAN TESTING
 * Disables cache and all other fallbacks.
 * In simulation mode, falls back to synthetic candles if Dhan is unavailable.
 */
export async function getCandles(params: GetCandlesRequest): Promise<Candle[]> {
  try {
    // 1. Check if Dhan credentials exist
    const isDhanAvailable = !!process.env.DHAN_ACCESS_TOKEN && !!process.env.DHAN_CLIENT_ID;

    if (!isDhanAvailable) {
      if (IS_SIM) {
        const intervalMinutes = parseInt(params.interval, 10) || 5;
        const synthetic = generateSimCandles(params.securityId, intervalMinutes);
        logger.info(`[SIM] No Dhan credentials — serving ${synthetic.length} synthetic candles for ${params.securityId}`);
        return synthetic;
      }
      logger.error('Dhan credentials missing in .env');
      throw new Error('Dhan credentials missing in .env');
    }

    // 2. Fetch ONLY from Dhan API
    logger.info('MODE: DHAN EXCLUSIVE - Fetching candles exclusively from Dhan API', { 
      securityId: params.securityId,
      exchangeSegment: params.exchangeSegment,
      fromDate: params.fromDate,
      toDate: params.toDate
    });

    try {
      const candles = await fetchDhanCandles({
        securityId: params.securityId,
        exchangeSegment: params.exchangeSegment === 'IDX_I' ? 'IDX_I' : 'NSE_INDEX',
        instrument: 'INDEX',
        interval: params.interval,
        fromDate: params.fromDate,
        toDate: params.toDate
      });

      if (candles && candles.length > 0) {
        logger.info(`Successfully fetched ${candles.length} candles from Dhan`);
        return candles.map(c => ({
          timestamp: c.timestamp,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume
        }));
      }
      
      logger.warn('Dhan API returned no data for this request');
      return [];
    } catch (err: any) {
      logger.error('Dhan exclusive fetch failed:', err.message);
      if (IS_SIM) {
        const intervalMinutes = parseInt(params.interval, 10) || 5;
        const synthetic = generateSimCandles(params.securityId, intervalMinutes);
        logger.warn(`[SIM] Dhan fetch failed — serving ${synthetic.length} synthetic candles for ${params.securityId}`);
        return synthetic;
      }
      throw err;
    }
  } catch (error: any) {
    logger.error('Failed to get candles (Exclusive Mode):', error.message);
    throw error;
  }
}

/**
 * Empty stubs for disabled functions to prevent compilation errors
 */
export function isCached(params: GetCandlesRequest): boolean {
  return false;
}

export function clearCache(params?: Partial<GetCandlesRequest>): void {
  logger.info('Cache clearing disabled in EXCLUSIVE mode');
}
