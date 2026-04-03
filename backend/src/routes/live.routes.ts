import { Router, Request, Response } from 'express';
import { placeOrder } from '../services/dhan.service';
import { getFeedStatus, emitTestTick } from '../services/dhanMarketFeed.service';
import { getATMOptionForOrder } from '../services/optionChain.service';
import { executeSmartExit } from '../services/smartExit.service';
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
            price,
            orderType,
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
            price,
            orderType,
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
 * POST /api/live/smart-exit
 * Start the Smart Exit Chaser Loop
 */
router.post('/smart-exit', async (req: Request, res: Response) => {
    try {
        const {
            securityId,
            exchangeSegment,
            transactionType,
            quantity,
            slPrice
        } = req.body;

        if (!securityId || !exchangeSegment || !transactionType || !quantity || !slPrice) {
            return res.status(400).json({
                error: 'Missing required parameters',
                required: ['securityId', 'exchangeSegment', 'transactionType', 'quantity', 'slPrice']
            });
        }

        const result = await executeSmartExit(req.body);
        res.json(result);
    } catch (error: any) {
        logger.error('Error starting Smart Exit:', error.message);
        res.status(500).json({
            error: 'Failed to start Smart Exit',
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

/**
 * GET /api/live/atm-option
 * Fetches ATM option details (securityId + live LTP) via:
 *   1. Dhan Option Chain Expiry List API  → picks nearest weekly expiry
 *   2. Dhan Option Chain API              → gets live LTP for ATM strike
 *   3. Symbol Master CSV                  → resolves the official securityId
 */
router.get('/atm-option', async (req: Request, res: Response) => {
    try {
        const { price, type, instrument } = req.query;
        if (!price || !type) {
            return res.status(400).json({ error: 'Missing price or type query params' });
        }

        const spotPrice = Number(price);
        const optType = (type as string).toUpperCase() as 'CE' | 'PE';
        const instName = ((instrument as string) || 'NIFTY').toUpperCase() as 'NIFTY' | 'BANKNIFTY';

        const result = await getATMOptionForOrder(spotPrice, optType, instName);

        logger.info(`ATM Option resolved: ${result.tradingSymbol} | LTP: ${result.ltp} | Expiry: ${result.expiry}`);
        res.json({ success: true, data: result });

    } catch (error: any) {
        logger.error('Error fetching ATM option:', error.message);
        res.status(500).json({ error: 'Server error', message: error.message });
    }
});

/**
 * GET /api/live/positions
 * Fetches actual positions from Dhan API
 */
router.get('/positions', async (req: Request, res: Response) => {
    try {
        const { getPositions } = await import('../services/dhan.service');
        const positions = await getPositions();
        res.json({ success: true, data: positions });
    } catch (error: any) {
        logger.error('Error fetching Dhan positions:', error.message);
        res.status(500).json({ error: 'Server error', message: error.message });
    }
});

/**
 * GET /api/live/order/:orderId
 * Fetch order status from Dhan — used by the frontend to verify fill after placement.
 * Returns the raw Dhan order object which includes:
 *   orderStatus: 'TRADED' | 'REJECTED' | 'PENDING' | 'PARTIALLY_TRADED' | ...
 *   filledQty / tradedQuantity, remainingQuantity, rejectedReason (if rejected)
 */
router.get('/order/:orderId', async (req: Request, res: Response) => {
    try {
        const { orderId } = req.params;
        if (!orderId) {
            return res.status(400).json({ error: 'orderId is required' });
        }
        const { getOrderStatus } = await import('../services/dhan.service');
        const orderData = await getOrderStatus(orderId);
        res.json({ success: true, data: orderData });
    } catch (error: any) {
        logger.error('Error fetching order status:', error.message);
        res.status(500).json({ error: 'Failed to fetch order status', message: error.message });
    }
});

export default router;
