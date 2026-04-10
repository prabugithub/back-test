"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.injectSymbolMasterFault = injectSymbolMasterFault;
exports.initSymbolMaster = initSymbolMaster;
exports.getATMOptionSecurityId = getATMOptionSecurityId;
exports.getATMOptionForOrder = getATMOptionForOrder;
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
const logger_1 = __importDefault(require("../utils/logger"));
let currentFaultMode = 'normal';
function injectSymbolMasterFault(mode) {
    currentFaultMode = mode;
    logger_1.default.info(`[MockSymbolMaster] Fault mode set to: ${mode}`);
}
// ─── Static fixtures ──────────────────────────────────────────────────────────
function buildFixtures() {
    const fixtures = [];
    // Use a future weekly expiry (Thursday after today's date in plan context)
    const weeklyExpiry = new Date('2026-04-10T14:30:00.000+05:30');
    const monthlyExpiry = new Date('2026-04-24T14:30:00.000+05:30');
    // NIFTY: strikes 21000–25000 in 50pt steps (CE + PE)
    for (let strike = 21000; strike <= 25000; strike += 50) {
        for (const optionType of ['CE', 'PE']) {
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
        for (const optionType of ['CE', 'PE']) {
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
async function initSymbolMaster() {
    currentFaultMode = 'normal';
    logger_1.default.info(`[MockSymbolMaster] Loaded ${FIXTURES.length} simulation fixtures (no CSV download)`);
}
// ─── Symbol lookup (mirrors real symbolMaster.service.ts) ────────────────────
function getATMOptionSecurityId(spotPrice, optionType, instrumentName) {
    if (currentFaultMode === 'not-ready') {
        throw new Error('Symbol Master is not ready yet — still initializing');
    }
    if (currentFaultMode === 'empty-cache') {
        return null;
    }
    const interval = instrumentName === 'NIFTY' ? 50 : 100;
    const atmStrike = Math.round(spotPrice / interval) * interval;
    return FIXTURES.find(f => f.instrument === instrumentName &&
        f.optionType === optionType &&
        Math.abs(f.strike - atmStrike) < 0.01) || null;
}
// ─── Full ATM option resolver (replaces optionChain.service.ts in sim mode) ──
async function getATMOptionForOrder(spotPrice, optionType, instrumentName = 'NIFTY') {
    if (currentFaultMode === 'not-ready') {
        throw new Error('Symbol Master is not ready yet — still initializing');
    }
    if (currentFaultMode === 'empty-cache') {
        throw new Error(`Security ID not found in Symbol Master for ${instrumentName} ${optionType} strike ~${spotPrice}`);
    }
    const interval = instrumentName === 'NIFTY' ? 50 : 100;
    const atmStrike = Math.round(spotPrice / interval) * interval;
    const entry = FIXTURES.find(f => f.instrument === instrumentName &&
        f.optionType === optionType &&
        Math.abs(f.strike - atmStrike) < 0.01);
    if (!entry) {
        throw new Error(`[MockSymbolMaster] No fixture found for ${instrumentName} ${optionType} @ ${atmStrike}. ` +
            `Extend fixtures if spotPrice is outside 21000–25000 (NIFTY) or 44000–54000 (BANKNIFTY).`);
    }
    // Synthetic LTP: roughly 1% of spot (realistic enough for testing)
    const syntheticLTP = parseFloat((spotPrice * 0.01).toFixed(2));
    const weeklyExpiryStr = '2026-04-10';
    logger_1.default.info(`[MockSymbolMaster] ATM resolved: ${entry.tradingSymbol} | LTP: ${syntheticLTP} | Expiry: ${weeklyExpiryStr}`);
    return {
        securityId: entry.securityId,
        tradingSymbol: entry.tradingSymbol,
        ltp: syntheticLTP,
        expiry: weeklyExpiryStr,
        atmStrike,
        lotSize: entry.lotSize,
    };
}
