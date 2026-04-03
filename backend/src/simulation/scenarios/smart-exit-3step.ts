/**
 * Scenario: smart-exit-3step
 * All 3 SmartExit chaser steps run to completion:
 *   Step 1: LIMIT @ SL×0.995 → PENDING (not filled within 2s)
 *   Step 2: modify to LIMIT @ SL×0.98 → PENDING (not filled within 3s)
 *   Step 3: modify to MARKET → fills instantly
 *
 * IMPORTANT: SmartExit has hardcoded delays of 2s (Step1) + 3s (Step2).
 * Total scenario duration is ~8-9 seconds.
 * Set SMART_EXIT_STEP1_DELAY_MS=500 and SMART_EXIT_STEP2_DELAY_MS=750
 * in .env.simulation for faster CI runs.
 *
 * Usage:
 *   1. Register a LONG position with SL=21900, TP=22300, spotToken='13'
 *   2. POST /api/dev/scenario {"scenarioId":"smart-exit-3step"}
 *   3. Watch server logs for:
 *      "Step 1: Placed Anchor Limit"
 *      "Step 2 (2% buffer)"
 *      "Step 3 (Market Dump)"
 *   4. Expect: position:exit-placed emitted after ~8s
 */
import { registerScenario } from '../scenarioRunner';
import { virtualOrderBook } from '../virtualOrderBook';
import { setInitialPrice } from '../mockMarketFeed';

registerScenario({
    id: 'smart-exit-3step',
    description: 'All 3 SmartExit chaser steps: Step1 LIMIT unfilled (2s) → Step2 LIMIT unfilled (3s) → Step3 MARKET fills',
    setup() {
        setInitialPrice('13', 22100);
        // Block all LIMIT orders from auto-filling (simulates illiquid/locked market)
        // 99999ms = effectively "never fill" for LIMIT orders
        virtualOrderBook.setDefaultFillBehavior({
            autoFillDelayMs: 99999,
        });
        // MARKET orders still fill instantly (default behavior when orderType changes to MARKET)
    },
    ticks: [
        // t=0: Starting price (entry already registered externally)
        { token: '13', price: 22100, delayMs: 0 },
        // t=1.5s: Price drops to SL level → SmartExit fires Step 1 LIMIT order
        { token: '13', price: 21900, delayMs: 1500 },
        // t=4s: Step 1 has waited 2s, still PENDING → Step 2 modify fires
        { token: '13', price: 21880, delayMs: 2500 },
        // t=8s: Step 2 has waited 3s, still PENDING → Step 3 MARKET fires → fills
        { token: '13', price: 21860, delayMs: 4000 },
        // t=9s: Confirm exit is complete
        { token: '13', price: 21840, delayMs: 1500 },
    ],
    teardown() {
        // Reset to instant-fill for subsequent tests
        virtualOrderBook.setDefaultFillBehavior({ autoFillDelayMs: 0 });
    },
});
