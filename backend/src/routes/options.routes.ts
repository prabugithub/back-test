import { Router, Request, Response } from 'express';
import { backtestOptions, nakedBuyBacktest } from '../services/backtest.options.service';
import { getLotSizeForInstrument } from '../services/symbolMaster.service';
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

// GET /api/options/lot-size?instrument=NIFTY
router.get('/lot-size', (req: Request, res: Response) => {
    try {
        const instrument = (req.query.instrument as string)?.toUpperCase();
        if (instrument !== 'NIFTY' && instrument !== 'BANKNIFTY') {
            return res.status(400).json({ error: 'instrument must be NIFTY or BANKNIFTY' });
        }
        const lotSize = getLotSizeForInstrument(instrument as 'NIFTY' | 'BANKNIFTY');
        res.json({ instrument, lotSize });
    } catch (error: any) {
        logger.error('Lot size lookup failed:', error);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/options/naked-backtest
router.post('/naked-backtest', async (req: Request, res: Response) => {
    try {
        const {
            spotTrades, instrument, expiryFlag, strikeMode,
            exitMode, rrValues, riskPerTrade, niftyCandles
        } = req.body;

        if (!spotTrades || !Array.isArray(spotTrades)) {
            return res.status(400).json({ error: 'Missing or invalid spotTrades' });
        }
        if (!['NIFTY', 'BANKNIFTY'].includes(instrument)) {
            return res.status(400).json({ error: 'instrument must be NIFTY or BANKNIFTY' });
        }
        if (!['WEEK', 'MONTH'].includes(expiryFlag)) {
            return res.status(400).json({ error: 'expiryFlag must be WEEK or MONTH' });
        }
        if (!['ATM', 'OTM1', 'OTM2', 'ITM1', 'ITM2'].includes(strikeMode)) {
            return res.status(400).json({ error: 'Invalid strikeMode' });
        }
        if (!['actual', 'rr'].includes(exitMode)) {
            return res.status(400).json({ error: 'exitMode must be actual or rr' });
        }
        if (exitMode === 'rr' && (!Array.isArray(rrValues) || rrValues.length === 0)) {
            return res.status(400).json({ error: 'rrValues required for RR exit mode' });
        }

        const result = await nakedBuyBacktest({
            spotTrades,
            instrument: instrument as 'NIFTY' | 'BANKNIFTY',
            expiryFlag: expiryFlag as 'WEEK' | 'MONTH',
            strikeMode: strikeMode as any,
            exitMode: exitMode as 'actual' | 'rr',
            rrValues: rrValues ?? [],
            riskPerTrade: riskPerTrade ?? 10000,
            niftyCandles: niftyCandles ?? []
        });

        res.json(result);
    } catch (error: any) {
        logger.error('Naked buy backtest failed:', error);
        res.status(500).json({ error: 'Failed to run naked buy backtest', message: error.message });
    }
});

export default router;
