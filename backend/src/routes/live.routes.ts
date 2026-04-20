import { Router, Request, Response } from 'express';
import { placeOrder, getOptionLTP } from '../adapters/dhan.adapter';
import { getFeedStatus, emitTestTick } from '../adapters/dhanFeed.adapter';
import { getATMOptionForOrder } from '../adapters/optionChain.adapter';
import { executeSmartExit } from '../services/smartExit.service';
import { registerPosition, unregisterPosition, getMonitoredPositions, updatePositionTarget, updatePositionQuantity } from '../services/positionMonitor.service';
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
 * GET /api/live/option-ltp/:securityId
 * Fetches current LTP for a held option — used to anchor the Smart Exit chaser at SL time.
 */
router.get('/option-ltp/:securityId', async (req: Request, res: Response) => {
    try {
        const { securityId } = req.params;
        const exchangeSegment = (req.query.exchange as string) || 'NSE_FNO';
        const ltp = await getOptionLTP(securityId, exchangeSegment);
        if (ltp === null) {
            return res.status(404).json({ success: false, message: 'LTP unavailable for this security' });
        }
        res.json({ success: true, ltp });
    } catch (error: any) {
        logger.error('Error fetching option LTP:', error.message);
        res.status(500).json({ error: 'Server error', message: error.message });
    }
});

/**
 * GET /api/live/positions
 * Fetches actual positions from Dhan API
 */
router.get('/positions', async (req: Request, res: Response) => {
    try {
        const { getPositions } = await import('../adapters/dhan.adapter');
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
        const { getOrderStatus } = await import('../adapters/dhan.adapter');
        const orderData = await getOrderStatus(orderId);
        res.json({ success: true, data: orderData });
    } catch (error: any) {
        logger.error('Error fetching order status:', error.message);
        res.status(500).json({ error: 'Failed to fetch order status', message: error.message });
    }
});

/**
 * POST /api/live/monitor
 * Register a position for backend SL/TP monitoring.
 * Called by frontend immediately after a live option order is placed.
 * Once registered, the backend will fire the exit order even if the browser is closed.
 */
router.post('/monitor', (req: Request, res: Response) => {
    try {
        const { id, spotToken, spotSegment, direction, stopLoss, target, optionSecurityId, optionExchangeSegment, quantity, entryPrice, productType } = req.body;

        if (!id || !spotToken || !direction || !optionSecurityId || !quantity) {
            return res.status(400).json({
                error: 'Missing required parameters',
                required: ['id', 'spotToken', 'direction', 'optionSecurityId', 'quantity'],
            });
        }
        if (!stopLoss && !target) {
            return res.status(400).json({ error: 'At least one of stopLoss or target must be provided' });
        }

        const VALID_PRODUCT_TYPES = ['INTRADAY', 'CNC', 'MARGIN', 'MTF', 'CO', 'BO'] as const;
        const resolvedProductType = VALID_PRODUCT_TYPES.includes(productType) ? productType : 'INTRADAY';

        registerPosition({
            id,
            spotToken: String(spotToken),
            spotSegment: spotSegment || 'IDX_I',
            direction,
            stopLoss: Number(stopLoss) || 0,
            target: Number(target) || 0,
            optionSecurityId: String(optionSecurityId),
            optionExchangeSegment: optionExchangeSegment || 'NSE_FNO',
            quantity: Number(quantity),
            entryPrice: Number(entryPrice) || 0,
            productType: resolvedProductType,
        });

        res.json({ success: true, message: `Position ${id} registered for backend monitoring` });
    } catch (error: any) {
        logger.error('Error registering position monitor:', error.message);
        res.status(500).json({ error: 'Failed to register position monitor', message: error.message });
    }
});

/**
 * DELETE /api/live/monitor/:id
 * Unregister a position from backend monitoring.
 * Called by frontend when the user manually closes a position.
 */
router.delete('/monitor/:id', (req: Request, res: Response) => {
    const { id } = req.params;
    const removed = unregisterPosition(id);
    res.json({ success: true, removed, message: removed ? `Position ${id} unregistered` : `Position ${id} was not monitored` });
});

/**
 * PATCH /api/live/monitor/:id
 * Update mutable fields for a monitored position: target and/or quantity.
 * Stop loss is strict and cannot be modified via this endpoint.
 * quantity update is used when a partial fill confirms fewer units than originally requested.
 */
router.patch('/monitor/:id', (req: Request, res: Response) => {
    const { id } = req.params;
    const { target, quantity } = req.body;

    if (target === undefined && quantity === undefined) {
        return res.status(400).json({ error: 'Provide at least one of: target, quantity' });
    }

    let updated = false;

    if (target !== undefined) {
        if (isNaN(Number(target))) {
            return res.status(400).json({ error: 'target must be a valid number' });
        }
        updated = updatePositionTarget(id, Number(target)) || updated;
    }

    if (quantity !== undefined) {
        if (isNaN(Number(quantity)) || Number(quantity) <= 0) {
            return res.status(400).json({ error: 'quantity must be a positive number' });
        }
        updated = updatePositionQuantity(id, Number(quantity)) || updated;
    }

    if (!updated) {
        return res.status(404).json({ error: `Position ${id} not found or already exited` });
    }
    res.json({ success: true, message: `Position ${id} updated` });
});

/**
 * GET /api/live/monitor
 * List all currently monitored positions.
 * Used by the frontend on reconnect to re-sync its local state.
 */
router.get('/monitor', (_req: Request, res: Response) => {
    res.json({ success: true, data: getMonitoredPositions() });
});

export default router;
