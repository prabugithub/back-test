"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SCENARIO_REGISTRY = void 0;
exports.registerScenario = registerScenario;
exports.runScenario = runScenario;
exports.stopCurrentScenario = stopCurrentScenario;
exports.getCurrentScenarioId = getCurrentScenarioId;
/**
 * Scenario Runner — plays scripted price tick sequences for offline testing.
 *
 * A Scenario is:
 *   - setup():   called once before ticks start (configure order book overrides)
 *   - ticks[]:   array of { token, price, delayMs } — delayMs is the delay BEFORE emitting
 *   - teardown(): called after last tick
 */
const logger_1 = __importDefault(require("../utils/logger"));
const virtualOrderBook_1 = require("./virtualOrderBook");
const mockMarketFeed_1 = require("./mockMarketFeed");
// ─── Registry ─────────────────────────────────────────────────────────────────
exports.SCENARIO_REGISTRY = new Map();
function registerScenario(scenario) {
    exports.SCENARIO_REGISTRY.set(scenario.id, scenario);
}
// ─── Runner ───────────────────────────────────────────────────────────────────
let abortCurrentScenario = false;
let currentScenarioId = null;
async function runScenario(scenarioId) {
    const scenario = exports.SCENARIO_REGISTRY.get(scenarioId);
    if (!scenario) {
        throw new Error(`Unknown scenario: "${scenarioId}". Available: ${Array.from(exports.SCENARIO_REGISTRY.keys()).join(', ')}`);
    }
    // Abort any in-flight scenario
    abortCurrentScenario = true;
    await sleep(50); // give running loop a tick to notice
    abortCurrentScenario = false;
    currentScenarioId = scenarioId;
    // Reset order book for a clean slate
    virtualOrderBook_1.virtualOrderBook.reset();
    logger_1.default.info(`[ScenarioRunner] Starting scenario: ${scenarioId} — ${scenario.description}`);
    await scenario.setup?.();
    // Run ticks asynchronously — don't await so the HTTP response returns immediately
    (async () => {
        try {
            for (const tick of scenario.ticks) {
                if (abortCurrentScenario) {
                    logger_1.default.info(`[ScenarioRunner] Scenario ${scenarioId} aborted`);
                    return;
                }
                if (tick.delayMs > 0) {
                    await sleep(tick.delayMs);
                }
                if (abortCurrentScenario)
                    return;
                (0, mockMarketFeed_1.emitSimulationTick)(tick.token, tick.price);
            }
            if (!abortCurrentScenario) {
                await scenario.teardown?.();
                logger_1.default.info(`[ScenarioRunner] Scenario ${scenarioId} completed`);
                currentScenarioId = null;
            }
        }
        catch (err) {
            logger_1.default.error(`[ScenarioRunner] Scenario ${scenarioId} failed: ${err.message}`);
            currentScenarioId = null;
        }
    })();
    return { started: true, scenario: scenario.description };
}
function stopCurrentScenario() {
    abortCurrentScenario = true;
    logger_1.default.info(`[ScenarioRunner] Stop requested for: ${currentScenarioId}`);
    currentScenarioId = null;
}
function getCurrentScenarioId() {
    return currentScenarioId;
}
const sleep = (ms) => new Promise(res => setTimeout(res, ms));
// ─── Load all scenario scripts (auto-registers them) ─────────────────────────
require("./scenarios/tp-hit");
require("./scenarios/sl-smart-exit");
require("./scenarios/partial-fill");
require("./scenarios/order-rejected");
require("./scenarios/ws-disconnect");
require("./scenarios/smart-exit-3step");
require("./scenarios/atm-resolution");
require("./scenarios/symbol-master-fault");
