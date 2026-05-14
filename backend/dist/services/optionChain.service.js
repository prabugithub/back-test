"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getATMOptionForOrder = getATMOptionForOrder;
const axios_1 = __importDefault(require("axios"));
const logger_1 = __importDefault(require("../utils/logger"));
const symbolMaster_service_1 = require("./symbolMaster.service");
// NIFTY securityId for index = 13, segment = IDX_I
const INSTRUMENT_CONFIG = {
    NIFTY: { underlyingScrip: 13, underlyingSeg: 'IDX_I', strikeInterval: 50 },
    BANKNIFTY: { underlyingScrip: 25, underlyingSeg: 'IDX_I', strikeInterval: 100 },
};
function getHeaders() {
    const accessToken = process.env.DHAN_ACCESS_TOKEN;
    const clientID = process.env.DHAN_CLIENT_ID;
    if (!accessToken || !clientID)
        throw new Error('DHAN_ACCESS_TOKEN and DHAN_CLIENT_ID are required');
    return {
        'access-token': accessToken,
        'client-id': clientID,
        'Content-Type': 'application/json',
    };
}
/**
 * Fetches all expiry dates for a given underlying from Dhan Option Chain API.
 * Returns dates sorted ascending (nearest first).
 */
async function fetchExpiryList(instrumentName) {
    const config = INSTRUMENT_CONFIG[instrumentName];
    if (!config)
        throw new Error(`Unknown instrument: ${instrumentName}`);
    const response = await axios_1.default.post('https://api.dhan.co/v2/optionchain/expirylist', { UnderlyingScrip: config.underlyingScrip, UnderlyingSeg: config.underlyingSeg }, { headers: getHeaders() });
    const expiries = response.data?.data || [];
    if (!expiries.length)
        throw new Error('Dhan returned empty expiry list');
    // Sort ascending — they may already be sorted but ensure it
    return expiries.sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
}
/**
 * Picks the nearest WEEKLY expiry from the expiry list.
 * Dhan returns expiry dates like "2026-04-07", "2026-04-14", etc.
 * Weekly = expiry happens every Thursday (or nearest trading day).
 * We pick the NEXT upcoming one (today + at least 1 day buffer).
 */
function pickWeeklyExpiry(expiries) {
    const now = new Date();
    // Give at least a 1-minute buffer to current time
    const minExpiry = new Date(now.getTime() + 60000);
    const future = expiries.filter(e => new Date(e).getTime() > minExpiry.getTime());
    if (!future.length)
        throw new Error('No upcoming expiry dates found');
    // The nearest future expiry is the weekly (Dhan lists weeklies first in ascending order)
    return future[0];
}
/**
 * Fetches option chain data for a given expiry and returns the LTP
 * for the ATM strike of the requested option type.
 *
 * IMPORTANT: always returns { atmStrike } as the strike calculated from spot price,
 * never the fallback strike. This ensures the security ID lookup always resolves
 * to the option the user intended to trade. LTP may come from a nearby strike if
 * the exact ATM has no price, but that only affects the limit-order anchor — not
 * which security is ordered.
 */
async function fetchATMLTPFromChain(instrumentName, expiry, spotPrice, optionType) {
    const config = INSTRUMENT_CONFIG[instrumentName];
    const response = await axios_1.default.post('https://api.dhan.co/v2/optionchain', { UnderlyingScrip: config.underlyingScrip, UnderlyingSeg: config.underlyingSeg, Expiry: expiry }, { headers: getHeaders() });
    const oc = response.data?.data?.oc || response.data?.oc;
    // Round spot to nearest strike interval — this is the INTENDED strike
    const interval = config.strikeInterval;
    const atmStrike = Math.round(spotPrice / interval) * interval;
    if (!oc) {
        logger_1.default.warn(`Option chain data missing from Dhan response for ${instrumentName} exp ${expiry}`);
        return { ltp: 0, atmStrike };
    }
    // Try exact ATM first, then adjacent strikes only for LTP fallback.
    // Never change atmStrike — the security ID must always match the intended strike.
    const searchRange = [0];
    for (let i = 1; i <= 10; i++) {
        searchRange.push(i * interval);
        searchRange.push(-i * interval);
    }
    for (const delta of searchRange) {
        const strike = atmStrike + delta;
        const strikeKey = String(strike);
        // Dhan might return strikes as "22500" or "22500.0"
        const strikeData = oc[strikeKey] || oc[`${strike}.0`];
        if (strikeData) {
            const optData = strikeData[optionType.toLowerCase()];
            if (optData && optData.last_price > 0) {
                if (delta !== 0) {
                    logger_1.default.warn(`ATM ${atmStrike} ${optionType} has no LTP in chain — using nearby strike ${strike} as LTP reference only. ` +
                        `Security ID will still resolve to ATM ${atmStrike}.`);
                }
                logger_1.default.info(`Option chain LTP for ${instrumentName} ${optionType} ${strike} exp ${expiry}: ${optData.last_price}`);
                // Always return the intended atmStrike, not the fallback strike
                return { ltp: optData.last_price, atmStrike };
            }
        }
    }
    logger_1.default.warn(`Could not find ANY LTP for ${instrumentName} near ATM ${atmStrike} in chain. Returning LTP 0.`);
    return { ltp: 0, atmStrike };
}
/**
 * Fetches the most recent 1-min closed candle's close price for a given option.
 * Used as a fallback limit-price anchor when option chain LTP is unavailable.
 * Returns 0 if intraday data cannot be fetched.
 */
async function fetchOptionLastClose(securityId) {
    const accessToken = process.env.DHAN_ACCESS_TOKEN;
    const clientID = process.env.DHAN_CLIENT_ID;
    if (!accessToken || !clientID)
        return 0;
    const today = new Date().toISOString().split('T')[0];
    try {
        const response = await axios_1.default.post('https://api.dhan.co/v2/charts/intraday', {
            securityId,
            exchangeSegment: 'NSE_FNO',
            instrument: 'OPTIDX',
            interval: '1',
            fromDate: today,
            toDate: today,
        }, {
            headers: {
                'access-token': accessToken,
                'client-id': clientID,
                'Content-Type': 'application/json',
            },
            timeout: 5000,
        });
        const closes = response.data?.close || [];
        // Prefer second-to-last (previous fully closed candle); fall back to last
        const idx = closes.length >= 2 ? closes.length - 2 : closes.length - 1;
        const price = closes[idx] ? Number(closes[idx]) : 0;
        if (price > 0) {
            logger_1.default.info(`[OptionLTP Fallback] Used intraday candle close for ${securityId}: ${price}`);
        }
        return price;
    }
    catch (err) {
        logger_1.default.warn(`[OptionLTP Fallback] Intraday fetch failed for ${securityId}: ${err.message}`);
        return 0;
    }
}
/**
 * Main function: given spot price and option type, returns the security ID (from CSV)
 * and live LTP (from option chain API) for the nearest weekly ATM option.
 */
async function getATMOptionForOrder(spotPrice, optionType, instrumentName = 'NIFTY') {
    // Step 1: Get the nearest weekly expiry from Dhan
    const expiries = await fetchExpiryList(instrumentName);
    const weeklyExpiry = pickWeeklyExpiry(expiries);
    logger_1.default.info(`Using weekly expiry: ${weeklyExpiry} for ${instrumentName}`);
    // Step 2: Get ATM LTP from option chain
    const { ltp, atmStrike } = await fetchATMLTPFromChain(instrumentName, weeklyExpiry, spotPrice, optionType);
    // Step 3: Get securityId from symbolMaster CSV (official ID lookup)
    // Try exact ATM strike first, then ±1 interval
    const interval = INSTRUMENT_CONFIG[instrumentName].strikeInterval;
    let symbolEntry = (0, symbolMaster_service_1.getATMOptionSecurityId)(atmStrike, optionType, instrumentName);
    if (!symbolEntry) {
        // Try with the actual spot price in case of rounding difference
        symbolEntry = (0, symbolMaster_service_1.getATMOptionSecurityId)(spotPrice, optionType, instrumentName);
    }
    if (!symbolEntry) {
        throw new Error(`Security ID not found in Symbol Master for ${instrumentName} ${optionType} strike ~${atmStrike}. ` +
            `Symbol master may be stale — restart server to refresh.`);
    }
    // Step 4: If option chain returned no LTP, fall back to previous 1-min candle close
    let resolvedLtp = ltp;
    if (resolvedLtp === 0) {
        resolvedLtp = await fetchOptionLastClose(symbolEntry.securityId);
        if (resolvedLtp === 0) {
            logger_1.default.warn(`[OptionLTP] No price from chain or intraday candles for ${symbolEntry.tradingSymbol} — order will use MARKET`);
        }
    }
    return {
        securityId: symbolEntry.securityId,
        tradingSymbol: symbolEntry.tradingSymbol,
        ltp: resolvedLtp,
        expiry: weeklyExpiry,
        atmStrike,
        lotSize: symbolEntry.lotSize,
    };
}
