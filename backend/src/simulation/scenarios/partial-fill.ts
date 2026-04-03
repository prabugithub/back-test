/**
 * Scenario: partial-fill
 * The next order placed is only partially filled (half the requested quantity).
 * Frontend should show reduced position size and filledQty < requested.
 *
 * Usage:
 *   1. Open frontend, switch to Live mode
 *   2. POST /api/dev/scenario {"scenarioId":"partial-fill"}
 *   3. Place a BUY order from the UI
 *   4. Expect: order status = PARTIALLY_TRADED, position qty = ~half
 */
import { registerScenario } from '../scenarioRunner';
import { virtualOrderBook } from '../virtualOrderBook';
import { setInitialPrice } from '../mockMarketFeed';

registerScenario({
    id: 'partial-fill',
    description: 'Next order is partially filled (half qty) — frontend must handle reduced position size',
    setup() {
        setInitialPrice('13', 22000);
        // The next order placed will only fill 37 units (half of typical 75-lot)
        virtualOrderBook.setNextOrderOverride({
            _sim_partialFillQty: 37,
            _sim_autoFillDelayMs: 500,
        } as any);
    },
    ticks: [
        // Keep price stable so user can place order
        { token: '13', price: 22000, delayMs: 0 },
        { token: '13', price: 22005, delayMs: 3000 },
        { token: '13', price: 22010, delayMs: 3000 },
    ],
});
