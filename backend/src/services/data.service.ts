import { fetchHistoricalCandles as fetchDhanCandles } from './dhan.service';
import { Candle, GetCandlesRequest } from '../types';
import logger from '../utils/logger';

/**
 * Get candles - TEMPORARILY MODIFIED FOR EXCLUSIVE DHAN TESTING
 * Disables cache and all other fallbacks.
 */
export async function getCandles(params: GetCandlesRequest): Promise<Candle[]> {
  try {
    // 1. Check if Dhan credentials exist
    const isDhanAvailable = !!process.env.DHAN_ACCESS_TOKEN && !!process.env.DHAN_CLIENT_ID;

    if (!isDhanAvailable) {
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
