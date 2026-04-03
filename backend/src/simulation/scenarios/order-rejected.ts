/**
 * Scenario: order-rejected
 * The next order placed is rejected by the broker (e.g. insufficient funds).
 * Frontend should show an error notification and not create a position.
 *
 * Usage:
 *   1. Open frontend, switch to Live mode
 *   2. POST /api/dev/scenario {"scenarioId":"order-rejected"}
 *   3. Place a BUY order from the UI
 *   4. Expect: error toast "Failed to place order — Simulated rejection — insufficient funds"
 *              No position should be created
 */
import { registerScenario } from '../scenarioRunner';
import { virtualOrderBook } from '../virtualOrderBook';
import { setInitialPrice } from '../mockMarketFeed';

registerScenario({
    id: 'order-rejected',
    description: 'Next order is rejected by broker — frontend must show error and not create position',
    setup() {
        setInitialPrice('13', 22000);
        virtualOrderBook.setNextOrderOverride({
            _sim_shouldReject: true,
        } as any);
    },
    ticks: [
        { token: '13', price: 22000, delayMs: 0 },
        { token: '13', price: 22005, delayMs: 3000 },
        { token: '13', price: 22010, delayMs: 3000 },
    ],
});
