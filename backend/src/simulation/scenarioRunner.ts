/**
 * Scenario Runner — plays scripted price tick sequences for offline testing.
 *
 * A Scenario is:
 *   - setup():   called once before ticks start (configure order book overrides)
 *   - ticks[]:   array of { token, price, delayMs } — delayMs is the delay BEFORE emitting
 *   - teardown(): called after last tick
 */
import logger from '../utils/logger';
import { virtualOrderBook } from './virtualOrderBook';
import { emitSimulationTick, setInitialPrice } from './mockMarketFeed';

export interface ScenarioTick {
    token: string;
    price: number;
    /** Milliseconds to wait BEFORE emitting this tick */
    delayMs: number;
}

export interface Scenario {
    id: string;
    description: string;
    setup?: () => void | Promise<void>;
    ticks: ScenarioTick[];
    teardown?: () => void | Promise<void>;
}

// ─── Registry ─────────────────────────────────────────────────────────────────

export const SCENARIO_REGISTRY = new Map<string, Scenario>();

export function registerScenario(scenario: Scenario): void {
    SCENARIO_REGISTRY.set(scenario.id, scenario);
}

// ─── Runner ───────────────────────────────────────────────────────────────────

let abortCurrentScenario = false;
let currentScenarioId: string | null = null;

export async function runScenario(scenarioId: string): Promise<{ started: boolean; scenario: string }> {
    const scenario = SCENARIO_REGISTRY.get(scenarioId);
    if (!scenario) {
        throw new Error(`Unknown scenario: "${scenarioId}". Available: ${Array.from(SCENARIO_REGISTRY.keys()).join(', ')}`);
    }

    // Abort any in-flight scenario
    abortCurrentScenario = true;
    await sleep(50); // give running loop a tick to notice
    abortCurrentScenario = false;
    currentScenarioId = scenarioId;

    // Reset order book for a clean slate
    virtualOrderBook.reset();

    logger.info(`[ScenarioRunner] Starting scenario: ${scenarioId} — ${scenario.description}`);

    await scenario.setup?.();

    // Run ticks asynchronously — don't await so the HTTP response returns immediately
    (async () => {
        try {
            for (const tick of scenario.ticks) {
                if (abortCurrentScenario) {
                    logger.info(`[ScenarioRunner] Scenario ${scenarioId} aborted`);
                    return;
                }
                if (tick.delayMs > 0) {
                    await sleep(tick.delayMs);
                }
                if (abortCurrentScenario) return;
                emitSimulationTick(tick.token, tick.price);
            }
            if (!abortCurrentScenario) {
                await scenario.teardown?.();
                logger.info(`[ScenarioRunner] Scenario ${scenarioId} completed`);
                currentScenarioId = null;
            }
        } catch (err: any) {
            logger.error(`[ScenarioRunner] Scenario ${scenarioId} failed: ${err.message}`);
            currentScenarioId = null;
        }
    })();

    return { started: true, scenario: scenario.description };
}

export function stopCurrentScenario(): void {
    abortCurrentScenario = true;
    logger.info(`[ScenarioRunner] Stop requested for: ${currentScenarioId}`);
    currentScenarioId = null;
}

export function getCurrentScenarioId(): string | null {
    return currentScenarioId;
}

const sleep = (ms: number) => new Promise<void>(res => setTimeout(res, ms));

// ─── Load all scenario scripts (auto-registers them) ─────────────────────────

import './scenarios/tp-hit';
import './scenarios/sl-smart-exit';
import './scenarios/partial-fill';
import './scenarios/order-rejected';
import './scenarios/ws-disconnect';
import './scenarios/smart-exit-3step';
import './scenarios/atm-resolution';
import './scenarios/symbol-master-fault';
