import { getDatabase, saveDatabase } from '../config/database';
import { fetchHistoricalCandles, retryApiCall } from './angelone.service';
import { shouldUseYahooFinance, fetchYahooHistoricalData } from './yahoo.service';
import { Candle, GetCandlesRequest } from '../types';
import { format } from 'date-fns';
import logger from '../utils/logger';

/**
 * Get candles with automatic caching
 */
export async function getCandles(params: GetCandlesRequest): Promise<Candle[]> {
  try {
    // Check if data exists in cache
    const cachedCandles = getCachedCandles(params);

    if (cachedCandles.length > 0) {
      logger.info('Returning cached candles', {
        count: cachedCandles.length,
        securityId: params.securityId,
      });
      return cachedCandles;
    }

    // Fetch from Angel One API if not cached
    logger.info('Candles not found in cache, fetching from Angel One API');
    const candles = await fetchFromAngelOne(params);

    // Store in cache
    storeCandlesInCache(params, candles);

    return candles;
  } catch (error: any) {
    logger.error('Failed to get candles:', error.message);
    throw error;
  }
}

/**
 * Get candles from SQLite cache
 */
function getCachedCandles(params: GetCandlesRequest): Candle[] {
  const db = getDatabase();

  try {
    const stmt = db.prepare(`
      SELECT timestamp, open, high, low, close, volume
      FROM candles
      WHERE security_id = ?
        AND exchange_segment = ?
        AND interval = ?
        AND timestamp >= ?
        AND timestamp <= ?
      ORDER BY timestamp ASC
    `);

    // Convert date strings to timestamps (assuming fromDate/toDate are YYYY-MM-DD)
    const fromTimestamp = Math.floor(new Date(params.fromDate).getTime() / 1000);
    const toTimestamp = Math.floor(new Date(params.toDate).getTime() / 1000);

    stmt.bind([
      params.securityId,
      params.exchangeSegment,
      params.interval,
      fromTimestamp,
      toTimestamp,
    ]);

    const candles: Candle[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      candles.push({
        timestamp: row.timestamp as number,
        open: row.open as number,
        high: row.high as number,
        low: row.low as number,
        close: row.close as number,
        volume: row.volume as number,
      });
    }

    stmt.free();

    return candles;
  } catch (error: any) {
    logger.error('Error reading from cache:', error.message);
    return [];
  }
}

/**
 * Fetch candles from appropriate data source
 * Uses Yahoo Finance for indices, Angel One for stocks
 */
async function fetchFromAngelOne(params: GetCandlesRequest): Promise<Candle[]> {
  // Check if this is an index that should use Yahoo Finance
  if (shouldUseYahooFinance(params.securityId)) {
    logger.info('Using Yahoo Finance for index data', { token: params.securityId });

    const candleData = await fetchYahooHistoricalData({
      token: params.securityId,
      fromDate: params.fromDate,
      toDate: params.toDate,
      interval: params.interval,
    });

    // Convert to our Candle format
    const candles: Candle[] = candleData.map((c) => ({
      timestamp: c.timestamp,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
    }));

    // Sort by timestamp
    candles.sort((a, b) => a.timestamp - b.timestamp);

    return candles;
  }

  // Use Angel One for stocks
  logger.info('Using Angel One for stock data', { token: params.securityId });

  // Angel One uses symbolToken instead of securityId
  // Format dates to Angel One format
  const fromDateTime = `${params.fromDate} 09:15`;
  const toDateTime = `${params.toDate} 15:30`;

  // Map exchange segment to Angel One exchange format
  // NSE_EQ, NSE_FNO, NSE_INDEX all map to 'NSE'
  // BSE_EQ maps to 'BSE'
  let exchange = 'NSE';
  if (params.exchangeSegment.startsWith('NSE')) {
    exchange = 'NSE';
  } else if (params.exchangeSegment.startsWith('BSE')) {
    exchange = 'BSE';
  }

  const candleData = await retryApiCall(() =>
    fetchHistoricalCandles({
      symbolToken: params.securityId,  // Using securityId as symbolToken
      exchange: exchange,
      interval: params.interval,
      fromDate: fromDateTime,
      toDate: toDateTime,
    })
  );

  // Convert API response to our Candle format
  const candles: Candle[] = candleData.map((c) => ({
    timestamp: c.timestamp,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
  }));

  // Sort by timestamp
  candles.sort((a, b) => a.timestamp - b.timestamp);

  return candles;
}

/**
 * Store candles in SQLite cache
 */
function storeCandlesInCache(params: GetCandlesRequest, candles: Candle[]): void {
  const db = getDatabase();

  try {
    db.run('BEGIN TRANSACTION');

    const stmt = db.prepare(`
      INSERT OR IGNORE INTO candles
      (security_id, exchange_segment, instrument, interval, timestamp, open, high, low, close, volume)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let insertedCount = 0;
    for (const candle of candles) {
      stmt.bind([
        params.securityId,
        params.exchangeSegment,
        params.instrument,
        params.interval,
        candle.timestamp,
        candle.open,
        candle.high,
        candle.low,
        candle.close,
        candle.volume,
      ]);

      if (stmt.step()) {
        insertedCount++;
      }
      stmt.reset();
    }

    stmt.free();
    db.run('COMMIT');

    logger.info(`Stored ${insertedCount} candles in cache`);
    saveDatabase();
  } catch (error: any) {
    db.run('ROLLBACK');
    logger.error('Error storing candles in cache:', error.message);
    throw error;
  }
}

/**
 * Check if candles exist in cache for given parameters
 */
export function isCached(params: GetCandlesRequest): boolean {
  const candles = getCachedCandles(params);
  return candles.length > 0;
}

/**
 * Clear cache for specific parameters or all
 */
export function clearCache(params?: Partial<GetCandlesRequest>): void {
  const db = getDatabase();

  try {
    if (!params) {
      db.run('DELETE FROM candles');
      logger.info('Cleared all cache');
    } else {
      const conditions: string[] = [];
      const values: any[] = [];

      if (params.securityId) {
        conditions.push('security_id = ?');
        values.push(params.securityId);
      }
      if (params.exchangeSegment) {
        conditions.push('exchange_segment = ?');
        values.push(params.exchangeSegment);
      }
      if (params.interval) {
        conditions.push('interval = ?');
        values.push(params.interval);
      }

      if (conditions.length > 0) {
        const query = `DELETE FROM candles WHERE ${conditions.join(' AND ')}`;
        const stmt = db.prepare(query);
        stmt.bind(values);
        stmt.step();
        stmt.free();

        logger.info('Cleared cache with conditions', params);
      }
    }

    saveDatabase();
  } catch (error: any) {
    logger.error('Error clearing cache:', error.message);
    throw error;
  }
}
