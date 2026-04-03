/**
 * Scenario: atm-resolution
 * Tests the ATM option lookup pipeline end-to-end:
 *   GET /api/live/atm-option?price=22100&type=CE&instrument=NIFTY
 *   → mockSymbolMaster resolves ATM strike 22100 CE
 *   → Returns fixture securityId, tradingSymbol, synthetic LTP
 *
 * Usage:
 *   1. POST /api/dev/scenario {"scenarioId":"atm-resolution"}
 *   2. GET /api/live/atm-option?price=22100&type=CE&instrument=NIFTY
 *   3. Expect: { securityId: "SIM-NIF-22100-CE", tradingSymbol: "NIFTY-10Apr2026-22100-CE", ltp: 221, ... }
 *   4. GET /api/live/atm-option?price=47500&type=PE&instrument=BANKNIFTY
 *   5. Expect: { securityId: "SIM-BNF-47500-PE", ... }
 */
import { registerScenario } from '../scenarioRunner';
import { injectSymbolMasterFault } from '../mockSymbolMaster';
import { setInitialPrice } from '../mockMarketFeed';

registerScenario({
    id: 'atm-resolution',
    description: 'ATM option lookup returns correct fixture symbol — no Dhan API call needed',
    setup() {
        injectSymbolMasterFault('normal');
        setInitialPrice('13', 22100);
        setInitialPrice('25', 47500);
    },
    ticks: [
        { token: '13', price: 22100, delayMs: 0 },
        { token: '25', price: 47500, delayMs: 0 },
    ],
});
