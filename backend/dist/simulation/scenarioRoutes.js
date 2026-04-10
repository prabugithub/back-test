"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Scenario Routes — mounted at /api/dev in simulation mode only.
 * Provides HTTP control over scenario execution, manual tick injection,
 * and virtual order book inspection.
 */
const express_1 = require("express");
const scenarioRunner_1 = require("./scenarioRunner");
const virtualOrderBook_1 = require("./virtualOrderBook");
const mockMarketFeed_1 = require("./mockMarketFeed");
const mockSymbolMaster_1 = require("./mockSymbolMaster");
const logger_1 = __importDefault(require("../utils/logger"));
const router = (0, express_1.Router)();
/**
 * GET /api/dev/scenario
 * List all available scenarios with their descriptions
 */
router.get('/scenario', (_req, res) => {
    const available = Array.from(scenarioRunner_1.SCENARIO_REGISTRY.entries()).map(([id, s]) => ({
        id,
        description: s.description,
        tickCount: s.ticks.length,
        durationMs: s.ticks.reduce((sum, t) => sum + t.delayMs, 0),
    }));
    res.json({
        available,
        current: (0, scenarioRunner_1.getCurrentScenarioId)(),
    });
});
/**
 * POST /api/dev/scenario
 * Start a scenario. Returns immediately; ticks run asynchronously.
 * Body: { scenarioId: string }
 */
router.post('/scenario', async (req, res) => {
    try {
        const { scenarioId } = req.body;
        if (!scenarioId) {
            return res.status(400).json({ error: 'scenarioId is required' });
        }
        const result = await (0, scenarioRunner_1.runScenario)(scenarioId);
        res.json(result);
    }
    catch (err) {
        logger_1.default.error('[ScenarioRoutes] Failed to run scenario:', err.message);
        res.status(400).json({ error: err.message });
    }
});
/**
 * POST /api/dev/scenario/stop
 * Cancel any currently running scenario
 */
router.post('/scenario/stop', (_req, res) => {
    (0, scenarioRunner_1.stopCurrentScenario)();
    res.json({ stopped: true, previousScenario: (0, scenarioRunner_1.getCurrentScenarioId)() });
});
/**
 * POST /api/dev/tick
 * Inject a single manual tick — useful for step-by-step interactive debugging.
 * Body: { token?: string, price: number }
 */
router.post('/tick', (req, res) => {
    const { token = '13', price } = req.body;
    if (price === undefined || price === null) {
        return res.status(400).json({ error: 'price is required' });
    }
    (0, mockMarketFeed_1.emitSimulationTick)(String(token), Number(price));
    res.json({ emitted: true, token, price: Number(price) });
});
/**
 * POST /api/dev/seed
 * Seed the initial price for a token (without emitting a tick to subscribers).
 * Body: { token: string, price: number }
 */
router.post('/seed', (req, res) => {
    const { token = '13', price } = req.body;
    if (price === undefined) {
        return res.status(400).json({ error: 'price is required' });
    }
    (0, mockMarketFeed_1.setInitialPrice)(String(token), Number(price));
    res.json({ seeded: true, token, price: Number(price) });
});
/**
 * GET /api/dev/orders
 * Inspect the current virtual order book state
 */
router.get('/orders', (_req, res) => {
    res.json({
        orders: virtualOrderBook_1.virtualOrderBook.getAllOrders(),
    });
});
/**
 * GET /api/dev/positions
 * Inspect current virtual positions (open only)
 */
router.get('/positions', (_req, res) => {
    res.json({
        positions: virtualOrderBook_1.virtualOrderBook.getPositions(),
    });
});
/**
 * POST /api/dev/reset
 * Reset the virtual order book (clear all orders and positions)
 */
router.post('/reset', (_req, res) => {
    virtualOrderBook_1.virtualOrderBook.reset();
    res.json({ reset: true });
});
/**
 * POST /api/dev/feed/disconnect
 * Simulate WebSocket feed disconnection
 */
router.post('/feed/disconnect', (_req, res) => {
    (0, mockMarketFeed_1.simulateDisconnect)();
    res.json({ disconnected: true, feedStatus: (0, mockMarketFeed_1.getFeedStatus)() });
});
/**
 * POST /api/dev/feed/reconnect
 * Simulate WebSocket feed reconnection
 */
router.post('/feed/reconnect', (_req, res) => {
    (0, mockMarketFeed_1.simulateReconnect)();
    res.json({ reconnected: true, feedStatus: (0, mockMarketFeed_1.getFeedStatus)() });
});
/**
 * POST /api/dev/symbol-master/fault
 * Inject a symbol master fault mode for testing ATM resolution failures.
 * Body: { mode: 'normal' | 'not-ready' | 'empty-cache' }
 */
router.post('/symbol-master/fault', (req, res) => {
    const { mode = 'normal' } = req.body;
    if (!['normal', 'not-ready', 'empty-cache'].includes(mode)) {
        return res.status(400).json({ error: 'mode must be: normal | not-ready | empty-cache' });
    }
    (0, mockSymbolMaster_1.injectSymbolMasterFault)(mode);
    res.json({ faultMode: mode });
});
/**
 * POST /api/dev/order-override
 * Override behavior for the next order placed.
 * Body: { shouldReject?: boolean, partialFillQty?: number, autoFillDelayMs?: number }
 */
router.post('/order-override', (req, res) => {
    const { shouldReject, partialFillQty, autoFillDelayMs } = req.body;
    virtualOrderBook_1.virtualOrderBook.setNextOrderOverride({
        _sim_shouldReject: shouldReject ?? false,
        _sim_partialFillQty: partialFillQty ?? null,
        _sim_autoFillDelayMs: autoFillDelayMs ?? 0,
    });
    res.json({ override: { shouldReject, partialFillQty, autoFillDelayMs } });
});
exports.default = router;
