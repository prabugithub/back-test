import { Router, Request, Response } from 'express';
import { backtestOptions } from '../services/backtest.options.service';
import logger from '../utils/logger';

const router = Router();

router.post('/backtest', async (req: Request, res: Response) => {
    try {
        const { spotTrades, offsetSell, offsetBuy, instrument } = req.body;

        if (!spotTrades || !Array.isArray(spotTrades)) {
            return res.status(400).json({ error: 'Missing or invalid spotTrades' });
        }

        const result = await backtestOptions({
            spotTrades,
            offsetSell: offsetSell || 2,
            offsetBuy: offsetBuy || 4,
            instrument: instrument || 'NIFTY'
        });

        res.json(result);
    } catch (error: any) {
        logger.error('Option backtesting failed:', error);
        res.status(500).json({
            error: 'Failed to run option backtest',
            message: error.message
        });
    }
});

export default router;
