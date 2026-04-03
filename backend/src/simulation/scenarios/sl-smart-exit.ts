/**
 * Scenario: sl-smart-exit
 * Price drops to SL level → SmartExit fires.
 * LIMIT order fills quickly (Step 1 succeeds) — happy path.
 *
 * Usage:
 *   1. Register a LONG position with SL=21900, TP=22200, spotToken='13'
 *   2. POST /api/dev/scenario {"scenarioId":"sl-smart-exit"}
 *   3. Expect: "SL hit" → smartExit Step 1 LIMIT fills → position:exit-placed emitted
 */
import { registerScenario } from '../scenarioRunner';
import { virtualOrderBook } from '../virtualOrderBook';
import { setInitialPrice } from '../mockMarketFeed';

registerScenario({
    id: 'sl-smart-exit',
    description: 'Price drops to SL; SmartExit LIMIT anchor fills at Step 1',
    setup() {
        setInitialPrice('13', 22100);
        // Default fill behavior: instant fill (Step 1 LIMIT fills immediately)
        virtualOrderBook.setDefaultFillBehavior({ autoFillDelayMs: 0 });
    },
    ticks: [
        { token: '13', price: 22100, delayMs: 0 },
        { token: '13', price: 22050, delayMs: 1500 },
        { token: '13', price: 21980, delayMs: 1500 },
        { token: '13', price: 21900, delayMs: 1500 },  // SL hit → SmartExit fires Step 1 LIMIT
        { token: '13', price: 21880, delayMs: 3000 },  // Let Step 1 fill complete
    ],
});
