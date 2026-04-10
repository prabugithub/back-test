"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Scenario: symbol-master-fault
 * Simulates the Symbol Master CSV being unavailable (server restart before 8AM,
 * network error, etc.). The frontend should receive a clear error and not
 * attempt to place an order with an undefined securityId.
 *
 * Modes:
 *   not-ready   → throws "Symbol Master is not ready yet"
 *   empty-cache → returns null securityId (no matching fixture found)
 *
 * Usage:
 *   1. POST /api/dev/scenario {"scenarioId":"symbol-master-fault"}
 *   2. Try to place a LONG trade from the UI (Live mode)
 *   3. Expect: error toast with the fault message
 *   4. POST /api/dev/scenario {"scenarioId":"symbol-master-fault-empty"}
 *   5. Try again — expect "Security ID not found in Symbol Master" error
 */
const scenarioRunner_1 = require("../scenarioRunner");
const mockSymbolMaster_1 = require("../mockSymbolMaster");
const mockMarketFeed_1 = require("../mockMarketFeed");
(0, scenarioRunner_1.registerScenario)({
    id: 'symbol-master-fault',
    description: 'Symbol Master reports not-ready — ATM option lookup throws; frontend must show error',
    setup() {
        (0, mockMarketFeed_1.setInitialPrice)('13', 22000);
        (0, mockSymbolMaster_1.injectSymbolMasterFault)('not-ready');
    },
    ticks: [
        { token: '13', price: 22000, delayMs: 0 },
        { token: '13', price: 22010, delayMs: 5000 },
    ],
    teardown() {
        // Restore normal operation after test
        (0, mockSymbolMaster_1.injectSymbolMasterFault)('normal');
    },
});
(0, scenarioRunner_1.registerScenario)({
    id: 'symbol-master-fault-empty',
    description: 'Symbol Master returns null securityId — "Security ID not found" error path',
    setup() {
        (0, mockMarketFeed_1.setInitialPrice)('13', 22000);
        (0, mockSymbolMaster_1.injectSymbolMasterFault)('empty-cache');
    },
    ticks: [
        { token: '13', price: 22000, delayMs: 0 },
        { token: '13', price: 22010, delayMs: 5000 },
    ],
    teardown() {
        (0, mockSymbolMaster_1.injectSymbolMasterFault)('normal');
    },
});
