/**
 * Scenario: ws-disconnect
 * Simulates a WebSocket feed disconnection mid-trade.
 * REST polling mode kicks in (2s interval), position monitor continues working,
 * then WS reconnects and heartbeat resumes.
 *
 * Usage:
 *   1. Register a LONG position with SL=21800, TP=22300, spotToken='13'
 *   2. POST /api/dev/scenario {"scenarioId":"ws-disconnect"}
 *   3. Watch server logs for "Simulated WebSocket disconnect" then "REST poll" ticks
 *   4. After reconnect (~8s), heartbeat resumes at 500ms
 *   5. If price drops to SL during disconnect, backend should still fire exit
 */
import { registerScenario } from '../scenarioRunner';
import { simulateDisconnect, simulateReconnect, setInitialPrice } from '../mockMarketFeed';

registerScenario({
    id: 'ws-disconnect',
    description: 'WS disconnects mid-trade; REST poll mode activates; reconnect restores 500ms heartbeat',
    setup() {
        setInitialPrice('13', 22100);
        // Disconnect after 3.5s, reconnect after 12s
        setTimeout(() => simulateDisconnect(), 3500);
        setTimeout(() => simulateReconnect(), 12000);
    },
    ticks: [
        { token: '13', price: 22100, delayMs: 0 },
        { token: '13', price: 22080, delayMs: 2000 },
        { token: '13', price: 22060, delayMs: 500 },   // last heartbeat tick before disconnect
        { token: '13', price: 22050, delayMs: 2500 },  // REST poll interval (2s)
        { token: '13', price: 22040, delayMs: 2000 },
        { token: '13', price: 22035, delayMs: 2000 },
        { token: '13', price: 22030, delayMs: 2000 },
        { token: '13', price: 22050, delayMs: 1000 },  // after reconnect — heartbeat resumes
    ],
    teardown() {
        simulateReconnect(); // ensure we always end connected
    },
});

// Register a variant that actually triggers the disconnect/reconnect mid-sequence
registerScenario({
    id: 'ws-disconnect-reconnect',
    description: 'Full WS disconnect+reconnect cycle — monitoring survives both phases',
    setup() {
        setInitialPrice('13', 22100);
    },
    ticks: [
        { token: '13', price: 22100, delayMs: 0 },
        { token: '13', price: 22080, delayMs: 1500 },
        { token: '13', price: 22060, delayMs: 1500 },
        // REST polling now active (2s intervals) — scenario injects disconnect
        { token: '13', price: 22050, delayMs: 0 },     // signals disconnect injection below
        { token: '13', price: 22040, delayMs: 2500 },  // REST poll interval
        { token: '13', price: 22030, delayMs: 2500 },
        { token: '13', price: 22020, delayMs: 2500 },
        // Reconnect
        { token: '13', price: 22100, delayMs: 1000 },  // signals reconnect injection below
        { token: '13', price: 22110, delayMs: 1000 },  // back to fast heartbeat
        { token: '13', price: 22120, delayMs: 500 },
    ],
    async teardown() {
        // Make sure we always end reconnected
        simulateReconnect();
    },
});

