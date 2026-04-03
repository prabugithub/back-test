/**
 * Scenario: tp-hit
 * Price rises steadily above TP level → backend positionMonitor fires MARKET exit.
 *
 * Usage:
 *   1. Open frontend, switch to Live mode
 *   2. Register a LONG position with SL=21900, TP=22200, spotToken='13'
 *   3. POST /api/dev/scenario {"scenarioId":"tp-hit"}
 *   4. Expect: "Position Exited (TP)" toast + virtual position cleared
 */
import { registerScenario } from '../scenarioRunner';
import { setInitialPrice } from '../mockMarketFeed';

registerScenario({
    id: 'tp-hit',
    description: 'Price rises steadily to TP level; backend fires MARKET exit automatically',
    setup() {
        // Seed starting price so subscribing frontend gets a sane initial tick
        setInitialPrice('13', 22000);  // NIFTY token
        setInitialPrice('25', 47500);  // BANKNIFTY token
    },
    ticks: [
        { token: '13', price: 22000, delayMs: 0 },
        { token: '13', price: 22050, delayMs: 2000 },
        { token: '13', price: 22100, delayMs: 2000 },
        { token: '13', price: 22150, delayMs: 2000 },
        { token: '13', price: 22200, delayMs: 2000 },  // TP assumed at or below 22200
        { token: '13', price: 22220, delayMs: 1000 },  // overshoot confirms TP fired
    ],
});
