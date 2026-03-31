import axios from 'axios';
import logger from '../utils/logger';
import { getATMOptionSecurityId } from './symbolMaster.service';

// NIFTY securityId for index = 13, segment = IDX_I
const INSTRUMENT_CONFIG: Record<string, { underlyingScrip: number; underlyingSeg: string; strikeInterval: number }> = {
    NIFTY: { underlyingScrip: 13, underlyingSeg: 'IDX_I', strikeInterval: 50 },
    BANKNIFTY: { underlyingScrip: 25, underlyingSeg: 'IDX_I', strikeInterval: 100 },
};

function getHeaders() {
    const accessToken = process.env.DHAN_ACCESS_TOKEN;
    const clientID = process.env.DHAN_CLIENT_ID;
    if (!accessToken || !clientID) throw new Error('DHAN_ACCESS_TOKEN and DHAN_CLIENT_ID are required');
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
async function fetchExpiryList(instrumentName: 'NIFTY' | 'BANKNIFTY'): Promise<string[]> {
    const config = INSTRUMENT_CONFIG[instrumentName];
    if (!config) throw new Error(`Unknown instrument: ${instrumentName}`);

    const response = await axios.post(
        'https://api.dhan.co/v2/optionchain/expirylist',
        { UnderlyingScrip: config.underlyingScrip, UnderlyingSeg: config.underlyingSeg },
        { headers: getHeaders() }
    );

    const expiries: string[] = response.data?.data || [];
    if (!expiries.length) throw new Error('Dhan returned empty expiry list');

    // Sort ascending — they may already be sorted but ensure it
    return expiries.sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
}

/**
 * Picks the nearest WEEKLY expiry from the expiry list.
 * Dhan returns expiry dates like "2026-04-07", "2026-04-14", etc.
 * Weekly = expiry happens every Thursday (or nearest trading day).
 * We pick the NEXT upcoming one (today + at least 1 day buffer).
 */
function pickWeeklyExpiry(expiries: string[]): string {
    const now = new Date();
    // Give at least a 1-minute buffer to current time
    const minExpiry = new Date(now.getTime() + 60_000);

    const future = expiries.filter(e => new Date(e).getTime() > minExpiry.getTime());
    if (!future.length) throw new Error('No upcoming expiry dates found');

    // The nearest future expiry is the weekly (Dhan lists weeklies first in ascending order)
    return future[0];
}

/**
 * Fetches option chain data for a given expiry and returns the LTP
 * for the ATM strike of the requested option type.
 */
async function fetchATMLTPFromChain(
    instrumentName: 'NIFTY' | 'BANKNIFTY',
    expiry: string,
    spotPrice: number,
    optionType: 'CE' | 'PE'
): Promise<{ ltp: number; atmStrike: number }> {
    const config = INSTRUMENT_CONFIG[instrumentName];

    const response = await axios.post(
        'https://api.dhan.co/v2/optionchain',
        { UnderlyingScrip: config.underlyingScrip, UnderlyingSeg: config.underlyingSeg, Expiry: expiry },
        { headers: getHeaders() }
    );

    const oc = response.data?.data?.oc || response.data?.oc;
    if (!oc) throw new Error('Option chain data missing from Dhan response');

    // Round spot to nearest strike interval
    const interval = config.strikeInterval;
    const atmStrike = Math.round(spotPrice / interval) * interval;

    // Search for ATM strike — try exact, then ±1 interval
    for (const delta of [0, interval, -interval, 2 * interval, -2 * interval]) {
        const strike = atmStrike + delta;
        const strikeKey = String(strike);
        const strikeData = oc[strikeKey];
        if (strikeData) {
            const optData = strikeData[optionType.toLowerCase()];
            if (optData && optData.last_price > 0) {
                logger.info(`Option chain LTP for ${instrumentName} ${optionType} ${strike} exp ${expiry}: ${optData.last_price}`);
                return { ltp: optData.last_price, atmStrike: strike };
            }
        }
    }

    throw new Error(`Could not find LTP for ${instrumentName} ATM ${optionType} in chain (spot: ${spotPrice}, strike tried: ${atmStrike})`);
}

/**
 * Main function: given spot price and option type, returns the security ID (from CSV)
 * and live LTP (from option chain API) for the nearest weekly ATM option.
 */
export async function getATMOptionForOrder(
    spotPrice: number,
    optionType: 'CE' | 'PE',
    instrumentName: 'NIFTY' | 'BANKNIFTY' = 'NIFTY'
): Promise<{ securityId: string; tradingSymbol: string; ltp: number; expiry: string; atmStrike: number; lotSize: number }> {

    // Step 1: Get the nearest weekly expiry from Dhan
    const expiries = await fetchExpiryList(instrumentName);
    const weeklyExpiry = pickWeeklyExpiry(expiries);
    logger.info(`Using weekly expiry: ${weeklyExpiry} for ${instrumentName}`);

    // Step 2: Get ATM LTP from option chain
    const { ltp, atmStrike } = await fetchATMLTPFromChain(instrumentName, weeklyExpiry, spotPrice, optionType);

    // Step 3: Get securityId from symbolMaster CSV (official ID lookup)
    // Try exact ATM strike first, then ±1 interval
    const interval = INSTRUMENT_CONFIG[instrumentName].strikeInterval;
    let symbolEntry = getATMOptionSecurityId(atmStrike, optionType, instrumentName);

    if (!symbolEntry) {
        // Try with the actual spot price in case of rounding difference
        symbolEntry = getATMOptionSecurityId(spotPrice, optionType, instrumentName);
    }

    if (!symbolEntry) {
        throw new Error(
            `Security ID not found in Symbol Master for ${instrumentName} ${optionType} strike ~${atmStrike}. ` +
            `Symbol master may be stale — restart server to refresh.`
        );
    }

    return {
        securityId: symbolEntry.securityId,
        tradingSymbol: symbolEntry.tradingSymbol,
        ltp,
        expiry: weeklyExpiry,
        atmStrike,
        lotSize: symbolEntry.lotSize,
    };
}
