import { Router, Request, Response } from 'express';
import { getCandles, isCached, clearCache } from '../services/data.service';
import { GetCandlesRequest } from '../types';
import logger from '../utils/logger';

const router = Router();

/**
 * GET /api/data/candles
 * Fetch candles with caching
 */
router.get('/candles', async (req: Request, res: Response) => {
  try {
    const {
      securityId,
      exchangeSegment,
      instrument,
      interval,
      fromDate,
      toDate,
    } = req.query;

    // Validate required parameters
    if (!securityId || !exchangeSegment || !instrument || !interval || !fromDate || !toDate) {
      return res.status(400).json({
        error: 'Missing required parameters',
        required: ['securityId', 'exchangeSegment', 'instrument', 'interval', 'fromDate', 'toDate'],
      });
    }

    const params: GetCandlesRequest = {
      securityId: securityId as string,
      exchangeSegment: exchangeSegment as string,
      instrument: instrument as string,
      interval: interval as string,
      fromDate: fromDate as string,
      toDate: toDate as string,
    };

    logger.info('Fetching candles', params);

    const candles = await getCandles(params);

    res.json({
      success: true,
      data: candles,
      count: candles.length,
      cached: isCached(params),
    });
  } catch (error: any) {
    logger.error('Error fetching candles:', error.message);
    res.status(500).json({
      error: 'Failed to fetch candles',
      message: error.message,
    });
  }
});

/**
 * DELETE /api/data/cache
 * Clear cache
 */
router.delete('/cache', (req: Request, res: Response) => {
  try {
    const { securityId, exchangeSegment, interval } = req.query;

    if (securityId || exchangeSegment || interval) {
      clearCache({
        securityId: securityId as string | undefined,
        exchangeSegment: exchangeSegment as string | undefined,
        interval: interval as string | undefined,
      });
    } else {
      clearCache();
    }

    res.json({
      success: true,
      message: 'Cache cleared successfully',
    });
  } catch (error: any) {
    logger.error('Error clearing cache:', error.message);
    res.status(500).json({
      error: 'Failed to clear cache',
      message: error.message,
    });
  }
});

/**
 * GET /api/data/health
 * Health check endpoint
 */
router.get('/health', (req: Request, res: Response) => {
  res.json({
    success: true,
    message: 'Data service is healthy',
    timestamp: new Date().toISOString(),
  });
});

export default router;
