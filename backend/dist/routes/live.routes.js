"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const dhan_adapter_1 = require("../adapters/dhan.adapter");
const dhanFeed_adapter_1 = require("../adapters/dhanFeed.adapter");
const optionChain_adapter_1 = require("../adapters/optionChain.adapter");
const smartExit_service_1 = require("../services/smartExit.service");
const positionMonitor_service_1 = require("../services/positionMonitor.service");
const logger_1 = __importDefault(require("../utils/logger"));
const router = (0, express_1.Router)();
/**
 * POST /api/live/order
 * Place a real order on Dhan
 */
router.post('/order', async (req, res) => {
    try {
        const { securityId, exchangeSegment, transactionType, quantity, price, orderType, productType } = req.body;
        if (!securityId || !exchangeSegment || !transactionType || !quantity) {
            return res.status(400).json({
                error: 'Missing required parameters',
                required: ['securityId', 'exchangeSegment', 'transactionType', 'quantity']
            });
        }
        const orderResult = await (0, dhan_adapter_1.placeOrder)({
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
    }
    catch (error) {
        logger_1.default.error('Error placing order:', error.message);
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
router.post('/smart-exit', async (req, res) => {
    try {
        const { securityId, exchangeSegment, transactionType, quantity, slPrice } = req.body;
        if (!securityId || !exchangeSegment || !transactionType || !quantity || !slPrice) {
            return res.status(400).json({
                error: 'Missing required parameters',
                required: ['securityId', 'exchangeSegment', 'transactionType', 'quantity', 'slPrice']
            });
        }
        const result = await (0, smartExit_service_1.executeSmartExit)(req.body);
        res.json(result);
    }
    catch (error) {
        logger_1.default.error('Error starting Smart Exit:', error.message);
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
router.get('/feed-status', (req, res) => {
    res.json((0, dhanFeed_adapter_1.getFeedStatus)());
});
/**
 * POST /api/live/test-tick
 * Emit a fake tick to test the socket pipeline (development only)
 * Body: { token, price }
 */
router.post('/test-tick', (req, res) => {
    const { token = '13', price = 22500 } = req.body;
    (0, dhanFeed_adapter_1.emitTestTick)(String(token), Number(price));
    res.json({ success: true, message: `Test tick emitted for token ${token} @ ${price}` });
});
/**
 * GET /api/live/atm-option
 * Fetches ATM option details (securityId + live LTP) via:
 *   1. Dhan Option Chain Expiry List API  → picks nearest weekly expiry
 *   2. Dhan Option Chain API              → gets live LTP for ATM strike
 *   3. Symbol Master CSV                  → resolves the official securityId
 */
router.get('/atm-option', async (req, res) => {
    try {
        const { price, type, instrument } = req.query;
        if (!price || !type) {
            return res.status(400).json({ error: 'Missing price or type query params' });
        }
        const spotPrice = Number(price);
        const optType = type.toUpperCase();
        const instName = (instrument || 'NIFTY').toUpperCase();
        const result = await (0, optionChain_adapter_1.getATMOptionForOrder)(spotPrice, optType, instName);
        logger_1.default.info(`ATM Option resolved: ${result.tradingSymbol} | LTP: ${result.ltp} | Expiry: ${result.expiry}`);
        res.json({ success: true, data: result });
    }
    catch (error) {
        logger_1.default.error('Error fetching ATM option:', error.message);
        res.status(500).json({ error: 'Server error', message: error.message });
    }
});
/**
 * GET /api/live/positions
 * Fetches actual positions from Dhan API
 */
router.get('/positions', async (req, res) => {
    try {
        const { getPositions } = await Promise.resolve().then(() => __importStar(require('../adapters/dhan.adapter')));
        const positions = await getPositions();
        res.json({ success: true, data: positions });
    }
    catch (error) {
        logger_1.default.error('Error fetching Dhan positions:', error.message);
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
router.get('/order/:orderId', async (req, res) => {
    try {
        const { orderId } = req.params;
        if (!orderId) {
            return res.status(400).json({ error: 'orderId is required' });
        }
        const { getOrderStatus } = await Promise.resolve().then(() => __importStar(require('../adapters/dhan.adapter')));
        const orderData = await getOrderStatus(orderId);
        res.json({ success: true, data: orderData });
    }
    catch (error) {
        logger_1.default.error('Error fetching order status:', error.message);
        res.status(500).json({ error: 'Failed to fetch order status', message: error.message });
    }
});
/**
 * POST /api/live/monitor
 * Register a position for backend SL/TP monitoring.
 * Called by frontend immediately after a live option order is placed.
 * Once registered, the backend will fire the exit order even if the browser is closed.
 */
router.post('/monitor', (req, res) => {
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
        const VALID_PRODUCT_TYPES = ['INTRADAY', 'CNC', 'MARGIN', 'MTF', 'CO', 'BO'];
        const resolvedProductType = VALID_PRODUCT_TYPES.includes(productType) ? productType : 'INTRADAY';
        (0, positionMonitor_service_1.registerPosition)({
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
    }
    catch (error) {
        logger_1.default.error('Error registering position monitor:', error.message);
        res.status(500).json({ error: 'Failed to register position monitor', message: error.message });
    }
});
/**
 * DELETE /api/live/monitor/:id
 * Unregister a position from backend monitoring.
 * Called by frontend when the user manually closes a position.
 */
router.delete('/monitor/:id', (req, res) => {
    const { id } = req.params;
    const removed = (0, positionMonitor_service_1.unregisterPosition)(id);
    res.json({ success: true, removed, message: removed ? `Position ${id} unregistered` : `Position ${id} was not monitored` });
});
/**
 * PATCH /api/live/monitor/:id
 * Update mutable fields for a monitored position: target and/or quantity.
 * Stop loss is strict and cannot be modified via this endpoint.
 * quantity update is used when a partial fill confirms fewer units than originally requested.
 */
router.patch('/monitor/:id', (req, res) => {
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
        updated = (0, positionMonitor_service_1.updatePositionTarget)(id, Number(target)) || updated;
    }
    if (quantity !== undefined) {
        if (isNaN(Number(quantity)) || Number(quantity) <= 0) {
            return res.status(400).json({ error: 'quantity must be a positive number' });
        }
        updated = (0, positionMonitor_service_1.updatePositionQuantity)(id, Number(quantity)) || updated;
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
router.get('/monitor', (_req, res) => {
    res.json({ success: true, data: (0, positionMonitor_service_1.getMonitoredPositions)() });
});
exports.default = router;
