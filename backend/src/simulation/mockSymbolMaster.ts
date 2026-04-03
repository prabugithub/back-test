/**
 * Mock Symbol Master — Simulation Mode
 *
 * Provides static option fixtures for NIFTY (21000–25000, 50pt steps)
 * and BANKNIFTY (44000–54000, 100pt steps) so ATM resolution works
 * without downloading or parsing the Dhan CSV.
 *
 * Also fully replaces getATMOptionForOrder() so optionChain.service.ts
 * (which makes live HTTP calls) is bypassed entirely in simulation.
 */
import logger from '../utils/logger';

export interface DhanOptionSymbol {
    securityId: string;
    tradingSymbol: string;
    strike: number;
    optionType: 'CE' | 'PE';
    expiryDate: Date;
    expiryFlag: string;
    instrument: string;
    lotSize: number;
}

// ─── Fault injection (for Scenario 10) ───────────────────────────────────────

type FaultMode = 'normal' | 'not-ready' | 'empty-cache';
let currentFaultMode: FaultMode = 'normal';

export function injectSymbolMasterFault(mode: FaultMode): void {
    currentFaultMode = mode;
    logger.info(`[MockSymbolMaster] Fault mode set to: ${mode}`);
}

// ─── Static fixtures ──────────────────────────────────────────────────────────

function buildFixtures(): DhanOptionSymbol[] {
    const fixtures: DhanOptionSymbol[] = [];
    // Use a future weekly expiry (Thursday after today's date in plan context)
    const weeklyExpiry = new Date('2026-04-10T14:30:00.000+05:30');
    const monthlyExpiry = new Date('2026-04-24T14:30:00.000+05:30');

    // NIFTY: strikes 21000–25000 in 50pt steps (CE + PE)
    for (let strike = 21000; strike <= 25000; strike += 50) {
        for (const optionType of ['CE', 'PE'] as const) {
            fixtures.push({
                securityId: `SIM-NIF-${strike}-${optionType}`,
                tradingSymbol: `NIFTY-10Apr2026-${strike}-${optionType}`,
                strike,
                optionType,
                expiryDate: weeklyExpiry,
                expiryFlag: 'W',
                instrument: 'NIFTY',
                lotSize: 65,
            });
        }
    }

    // BANKNIFTY: strikes 44000–54000 in 100pt steps (CE + PE)
    for (let strike = 44000; strike <= 54000; strike += 100) {
        for (const optionType of ['CE', 'PE'] as const) {
            fixtures.push({
                securityId: `SIM-BNF-${strike}-${optionType}`,
                tradingSymbol: `BANKNIFTY-10Apr2026-${strike}-${optionType}`,
                strike,
                optionType,
                expiryDate: weeklyExpiry,
                expiryFlag: 'W',
                instrument: 'BANKNIFTY',
                lotSize: 35,
            });
        }
    }

    return fixtures;
}

const FIXTURES = buildFixtures();

// ─── Init (no-op) ─────────────────────────────────────────────────────────────

export async function initSymbolMaster(): Promise<void> {
    currentFaultMode = 'normal';
    logger.info(`[MockSymbolMaster] Loaded ${FIXTURES.length} simulation fixtures (no CSV download)`);
}

// ─── Symbol lookup (mirrors real symbolMaster.service.ts) ────────────────────

export function getATMOptionSecurityId(
    spotPrice: number,
    optionType: 'CE' | 'PE',
    instrumentName: 'NIFTY' | 'BANKNIFTY'
): DhanOptionSymbol | null {
    if (currentFaultMode === 'not-ready') {
        throw new Error('Symbol Master is not ready yet — still initializing');
    }
    if (currentFaultMode === 'empty-cache') {
        return null;
    }

    const interval = instrumentName === 'NIFTY' ? 50 : 100;
    const atmStrike = Math.round(spotPrice / interval) * interval;

    return FIXTURES.find(
        f => f.instrument === instrumentName &&
            f.optionType === optionType &&
            Math.abs(f.strike - atmStrike) < 0.01
    ) || null;
}

// ─── Full ATM option resolver (replaces optionChain.service.ts in sim mode) ──

export async function getATMOptionForOrder(
    spotPrice: number,
    optionType: 'CE' | 'PE',
    instrumentName: 'NIFTY' | 'BANKNIFTY' = 'NIFTY'
): Promise<{ securityId: string; tradingSymbol: string; ltp: number; expiry: string; atmStrike: number; lotSize: number }> {
    if (currentFaultMode === 'not-ready') {
        throw new Error('Symbol Master is not ready yet — still initializing');
    }
    if (currentFaultMode === 'empty-cache') {
        throw new Error(`Security ID not found in Symbol Master for ${instrumentName} ${optionType} strike ~${spotPrice}`);
    }

    const interval = instrumentName === 'NIFTY' ? 50 : 100;
    const atmStrike = Math.round(spotPrice / interval) * interval;

    const entry = FIXTURES.find(
        f => f.instrument === instrumentName &&
            f.optionType === optionType &&
            Math.abs(f.strike - atmStrike) < 0.01
    );

    if (!entry) {
        throw new Error(
            `[MockSymbolMaster] No fixture found for ${instrumentName} ${optionType} @ ${atmStrike}. ` +
            `Extend fixtures if spotPrice is outside 21000–25000 (NIFTY) or 44000–54000 (BANKNIFTY).`
        );
    }

    // Synthetic LTP: roughly 1% of spot (realistic enough for testing)
    const syntheticLTP = parseFloat((spotPrice * 0.01).toFixed(2));
    const weeklyExpiryStr = '2026-04-10';

    logger.info(`[MockSymbolMaster] ATM resolved: ${entry.tradingSymbol} | LTP: ${syntheticLTP} | Expiry: ${weeklyExpiryStr}`);

    return {
        securityId: entry.securityId,
        tradingSymbol: entry.tradingSymbol,
        ltp: syntheticLTP,
        expiry: weeklyExpiryStr,
        atmStrike,
        lotSize: entry.lotSize,
    };
}
