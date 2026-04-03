/**
 * Scenario Routes — mounted at /api/dev in simulation mode only.
 * Provides HTTP control over scenario execution, manual tick injection,
 * and virtual order book inspection.
 */
import { Router, Request, Response } from 'express';
import { runScenario, stopCurrentScenario, getCurrentScenarioId, SCENARIO_REGISTRY } from './scenarioRunner';
import { virtualOrderBook } from './virtualOrderBook';
import { emitSimulationTick, simulateDisconnect, simulateReconnect, getFeedStatus, setInitialPrice } from './mockMarketFeed';
import { injectSymbolMasterFault } from './mockSymbolMaster';
import logger from '../utils/logger';

const router = Router();

/**
 * GET /api/dev/scenario
 * List all available scenarios with their descriptions
 */
router.get('/scenario', (_req: Request, res: Response) => {
    const available = Array.from(SCENARIO_REGISTRY.entries()).map(([id, s]) => ({
        id,
        description: s.description,
        tickCount: s.ticks.length,
        durationMs: s.ticks.reduce((sum, t) => sum + t.delayMs, 0),
    }));
    res.json({
        available,
        current: getCurrentScenarioId(),
    });
});

/**
 * POST /api/dev/scenario
 * Start a scenario. Returns immediately; ticks run asynchronously.
 * Body: { scenarioId: string }
 */
router.post('/scenario', async (req: Request, res: Response) => {
    try {
        const { scenarioId } = req.body;
        if (!scenarioId) {
            return res.status(400).json({ error: 'scenarioId is required' });
        }
        const result = await runScenario(scenarioId);
        res.json(result);
    } catch (err: any) {
        logger.error('[ScenarioRoutes] Failed to run scenario:', err.message);
        res.status(400).json({ error: err.message });
    }
});

/**
 * POST /api/dev/scenario/stop
 * Cancel any currently running scenario
 */
router.post('/scenario/stop', (_req: Request, res: Response) => {
    stopCurrentScenario();
    res.json({ stopped: true, previousScenario: getCurrentScenarioId() });
});

/**
 * POST /api/dev/tick
 * Inject a single manual tick — useful for step-by-step interactive debugging.
 * Body: { token?: string, price: number }
 */
router.post('/tick', (req: Request, res: Response) => {
    const { token = '13', price } = req.body;
    if (price === undefined || price === null) {
        return res.status(400).json({ error: 'price is required' });
    }
    emitSimulationTick(String(token), Number(price));
    res.json({ emitted: true, token, price: Number(price) });
});

/**
 * POST /api/dev/seed
 * Seed the initial price for a token (without emitting a tick to subscribers).
 * Body: { token: string, price: number }
 */
router.post('/seed', (req: Request, res: Response) => {
    const { token = '13', price } = req.body;
    if (price === undefined) {
        return res.status(400).json({ error: 'price is required' });
    }
    setInitialPrice(String(token), Number(price));
    res.json({ seeded: true, token, price: Number(price) });
});

/**
 * GET /api/dev/orders
 * Inspect the current virtual order book state
 */
router.get('/orders', (_req: Request, res: Response) => {
    res.json({
        orders: virtualOrderBook.getAllOrders(),
    });
});

/**
 * GET /api/dev/positions
 * Inspect current virtual positions (open only)
 */
router.get('/positions', (_req: Request, res: Response) => {
    res.json({
        positions: virtualOrderBook.getPositions(),
    });
});

/**
 * POST /api/dev/reset
 * Reset the virtual order book (clear all orders and positions)
 */
router.post('/reset', (_req: Request, res: Response) => {
    virtualOrderBook.reset();
    res.json({ reset: true });
});

/**
 * POST /api/dev/feed/disconnect
 * Simulate WebSocket feed disconnection
 */
router.post('/feed/disconnect', (_req: Request, res: Response) => {
    simulateDisconnect();
    res.json({ disconnected: true, feedStatus: getFeedStatus() });
});

/**
 * POST /api/dev/feed/reconnect
 * Simulate WebSocket feed reconnection
 */
router.post('/feed/reconnect', (_req: Request, res: Response) => {
    simulateReconnect();
    res.json({ reconnected: true, feedStatus: getFeedStatus() });
});

/**
 * POST /api/dev/symbol-master/fault
 * Inject a symbol master fault mode for testing ATM resolution failures.
 * Body: { mode: 'normal' | 'not-ready' | 'empty-cache' }
 */
router.post('/symbol-master/fault', (req: Request, res: Response) => {
    const { mode = 'normal' } = req.body;
    if (!['normal', 'not-ready', 'empty-cache'].includes(mode)) {
        return res.status(400).json({ error: 'mode must be: normal | not-ready | empty-cache' });
    }
    injectSymbolMasterFault(mode as any);
    res.json({ faultMode: mode });
});

/**
 * POST /api/dev/order-override
 * Override behavior for the next order placed.
 * Body: { shouldReject?: boolean, partialFillQty?: number, autoFillDelayMs?: number }
 */
router.post('/order-override', (req: Request, res: Response) => {
    const { shouldReject, partialFillQty, autoFillDelayMs } = req.body;
    virtualOrderBook.setNextOrderOverride({
        _sim_shouldReject: shouldReject ?? false,
        _sim_partialFillQty: partialFillQty ?? null,
        _sim_autoFillDelayMs: autoFillDelayMs ?? 0,
    } as any);
    res.json({ override: { shouldReject, partialFillQty, autoFillDelayMs } });
});

export default router;
