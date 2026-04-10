"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.shouldUseYahooFinance = shouldUseYahooFinance;
exports.getYahooSymbol = getYahooSymbol;
exports.fetchYahooHistoricalData = fetchYahooHistoricalData;
exports.getAvailableYahooSymbols = getAvailableYahooSymbols;
const yahoo_finance2_1 = __importDefault(require("yahoo-finance2"));
const logger_1 = __importDefault(require("../utils/logger"));
// Initialize Yahoo Finance instance (v3 API)
const yahooFinance = new yahoo_finance2_1.default();
// Yahoo Finance symbol mapping for Indian indices
const YAHOO_SYMBOL_MAP = {
    // Nifty indices (Angel One Tokens)
    '99926000': '^NSEI', // Nifty 50
    '99926009': '^NSEBANK', // Nifty Bank
    '99926037': '^CNXFIN', // Nifty Financial Services (Finnifty)
    '99926074': '^NSEMDCP50', // Nifty Midcap 50
    '99926013': '^CNXIT', // Nifty IT
    // Dhan Tokens
    '13': '^NSEI', // Nifty 50 Spot
    '25': '^NSEBANK', // Bank Nifty Spot
    '27': '^CNXFIN', // Nifty Financial Services Spot
};
/**
 * Check if a token is an index that should use Yahoo Finance
 */
function shouldUseYahooFinance(token) {
    return token in YAHOO_SYMBOL_MAP;
}
/**
 * Get Yahoo Finance symbol for a token
 */
function getYahooSymbol(token) {
    return YAHOO_SYMBOL_MAP[token] || null;
}
/**
 * Fetch historical data from Yahoo Finance
 */
async function fetchYahooHistoricalData(params) {
    const yahooSymbol = getYahooSymbol(params.token);
    if (!yahooSymbol) {
        throw new Error(`No Yahoo Finance mapping found for token: ${params.token}`);
    }
    try {
        logger_1.default.info('Fetching historical data from Yahoo Finance', {
            token: params.token,
            yahooSymbol,
            fromDate: params.fromDate,
            toDate: params.toDate,
            interval: params.interval,
        });
        // Map our interval format to Yahoo Finance format
        const intervalMap = {
            '1': '1m',
            '5': '5m',
            '15': '15m',
            '30': '30m',
            '60': '1h',
            '1D': '1d',
        };
        const yahooInterval = intervalMap[params.interval] || '1d';
        // Parse dates
        const period1 = new Date(params.fromDate);
        const period2 = new Date(params.toDate);
        period2.setHours(23, 59, 59, 999); // End of day
        // Fetch data from Yahoo Finance
        const result = await yahooFinance.chart(yahooSymbol, {
            period1,
            period2,
            interval: yahooInterval,
        });
        // Transform Yahoo Finance response to our format
        const candles = [];
        // @ts-ignore - yahoo-finance2 type definitions are incomplete
        if (result && result.quotes && Array.isArray(result.quotes)) {
            // @ts-ignore - yahoo-finance2 type definitions are incomplete
            for (const quote of result.quotes) {
                // Skip quotes with missing data
                if (!quote.date || quote.open === null || quote.high === null ||
                    quote.low === null || quote.close === null) {
                    continue;
                }
                const timestamp = Math.floor(quote.date.getTime() / 1000);
                candles.push({
                    timestamp,
                    open: quote.open,
                    high: quote.high,
                    low: quote.low,
                    close: quote.close,
                    volume: quote.volume || 0,
                });
            }
        }
        logger_1.default.info(`Fetched ${candles.length} candles from Yahoo Finance`);
        return candles;
    }
    catch (error) {
        logger_1.default.error('Failed to fetch data from Yahoo Finance:', {
            error: error.message,
            token: params.token,
            yahooSymbol,
        });
        throw new Error(`Yahoo Finance error: ${error.message}`);
    }
}
/**
 * Get available Yahoo Finance symbols
 */
function getAvailableYahooSymbols() {
    return [
        { token: '99926000', yahooSymbol: '^NSEI', name: 'Nifty 50' },
        { token: '99926009', yahooSymbol: '^NSEBANK', name: 'Nifty Bank' },
        { token: '99926037', yahooSymbol: '^CNXFIN', name: 'Nifty Financial Services' },
        { token: '99926074', yahooSymbol: '^NSEMDCP50', name: 'Nifty Midcap 50' },
        { token: '99926013', yahooSymbol: '^CNXIT', name: 'Nifty IT' },
    ];
}
