import { Router, Request, Response } from 'express';
import { placeOrder } from '../services/dhan.service';
import { getFeedStatus, emitTestTick } from '../services/dhanMarketFeed.service';
import logger from '../utils/logger';

const router = Router();

/**
 * POST /api/live/order
 * Place a real order on Dhan
 */
router.post('/order', async (req: Request, res: Response) => {
    try {
        const {
            securityId,
            exchangeSegment,
            transactionType,
            quantity,
            productType
        } = req.body;

        if (!securityId || !exchangeSegment || !transactionType || !quantity) {
            return res.status(400).json({
                error: 'Missing required parameters',
                required: ['securityId', 'exchangeSegment', 'transactionType', 'quantity']
            });
        }

        const orderResult = await placeOrder({
            securityId,
            exchangeSegment,
            transactionType,
            quantity,
            productType
        });

        res.json({
            success: true,
            data: orderResult
        });
    } catch (error: any) {
        logger.error('Error placing order:', error.message);
        res.status(500).json({
            error: 'Failed to place order',
            message: error.message
        });
    }
});

/**
 * GET /api/live/feed-status
 * Check the Dhan WebSocket feed connection state
 */
router.get('/feed-status', (req: Request, res: Response) => {
    res.json(getFeedStatus());
});

/**
 * POST /api/live/test-tick
 * Emit a fake tick to test the socket pipeline (development only)
 * Body: { token, price }
 */
router.post('/test-tick', (req: Request, res: Response) => {
    const { token = '13', price = 22500 } = req.body;
    emitTestTick(String(token), Number(price));
    res.json({ success: true, message: `Test tick emitted for token ${token} @ ${price}` });
});

export default router;

