"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initAngelOneClient = initAngelOneClient;
exports.loginAngelOne = loginAngelOne;
exports.getAngelOneClient = getAngelOneClient;
exports.fetchHistoricalCandles = fetchHistoricalCandles;
exports.searchInstrument = searchInstrument;
exports.retryApiCall = retryApiCall;
const { SmartAPI } = require('smartapi-javascript');
const otplib_1 = require("otplib");
const logger_1 = __importDefault(require("../utils/logger"));
let smartApi = null;
/**
 * Initialize Angel One SmartAPI client
 */
function initAngelOneClient() {
    if (smartApi) {
        return smartApi;
    }
    const apiKey = process.env.ANGELONE_API_KEY;
    const clientCode = process.env.ANGELONE_CLIENT_CODE;
    const password = process.env.ANGELONE_PASSWORD;
    if (!apiKey || !clientCode || !password) {
        logger_1.default.warn('Angel One credentials not configured — Angel One features disabled');
        return null;
    }
    smartApi = new SmartAPI({
        api_key: apiKey,
    });
    logger_1.default.info('Angel One SmartAPI client initialized successfully');
    return smartApi;
}
/**
 * Login to Angel One and generate session
 */
async function loginAngelOne() {
    const client = initAngelOneClient();
    const clientCode = process.env.ANGELONE_CLIENT_CODE;
    const password = process.env.ANGELONE_PASSWORD;
    const totpSecret = process.env.ANGELONE_TOTP;
    if (!clientCode || !password || !totpSecret) {
        throw new Error('ANGELONE_API_KEY, ANGELONE_CLIENT_CODE, ANGELONE_PASSWORD, and ANGELONE_TOTP must be set in environment variables');
    }
    // Generate TOTP code from the secret
    const totpCode = otplib_1.authenticator.generate(totpSecret);
    logger_1.default.info('Attempting Angel One login', {
        clientCode,
        totpCode: totpCode.substring(0, 2) + '****', // Log partial for debugging
    });
    try {
        logger_1.default.info('Calling generateSession with client code and TOTP');
        const loginResponse = await client.generateSession(clientCode, password, totpCode);
        logger_1.default.info('Login response received', {
            hasData: !!loginResponse.data,
            status: loginResponse.status,
            message: loginResponse.message,
            fullResponse: JSON.stringify(loginResponse).substring(0, 500), // Log first 500 chars
        });
        if (loginResponse && loginResponse.data) {
            logger_1.default.info('Angel One login successful', {
                jwtToken: loginResponse.data.jwtToken ? 'present' : 'missing',
            });
            // Set the access token
            client.setAccessToken(loginResponse.data.jwtToken);
            // Set refresh token if the method exists
            if (typeof client.setRefreshToken === 'function' && loginResponse.data.refreshToken) {
                client.setRefreshToken(loginResponse.data.refreshToken);
            }
        }
        else {
            throw new Error(`Login failed: ${loginResponse.message || 'No data in response'}`);
        }
    }
    catch (error) {
        logger_1.default.error('Angel One login failed:', error.message || error);
        logger_1.default.error('Full error:', JSON.stringify(error).substring(0, 500));
        throw new Error(`Angel One login error: ${error.message || error}`);
    }
}
/**
 * Get Angel One client instance
 */
function getAngelOneClient() {
    if (!smartApi) {
        return initAngelOneClient();
    }
    return smartApi;
}
/**
 * Fetch historical candle data from Angel One API
 *
 * Angel One getCandleData expects:
 * {
 *   exchange: "NSE",
 *   symboltoken: "3045",  // Token for the symbol
 *   interval: "FIVE_MINUTE",
 *   fromdate: "2021-02-08 09:00",
 *   todate: "2021-02-08 09:20"
 * }
 *
 * Response format:
 * {
 *   status: true,
 *   message: "SUCCESS",
 *   data: [
 *     ["2021-02-08T09:15:00+05:30", 14299.35, 14299.35, 14032.65, 14058.90, 635100]
 *     // [timestamp, open, high, low, close, volume]
 *   ]
 * }
 */
async function fetchHistoricalCandles(params) {
    const client = getAngelOneClient();
    try {
        logger_1.default.info('Fetching historical data from Angel One API', {
            symbolToken: params.symbolToken,
            interval: params.interval,
            fromDate: params.fromDate,
            toDate: params.toDate,
        });
        // Map interval to Angel One format
        const intervalMap = {
            '1': 'ONE_MINUTE',
            '5': 'FIVE_MINUTE',
            '15': 'FIFTEEN_MINUTE',
            '30': 'THIRTY_MINUTE',
            '60': 'ONE_HOUR',
            '1D': 'ONE_DAY',
        };
        const angelInterval = intervalMap[params.interval] || 'FIVE_MINUTE';
        const response = await client.getCandleData({
            exchange: params.exchange,
            symboltoken: params.symbolToken,
            interval: angelInterval,
            fromdate: params.fromDate, // Format: "YYYY-MM-DD HH:MM"
            todate: params.toDate,
        });
        // Transform Angel One response to our candle format
        const candles = [];
        if (response && response.data && Array.isArray(response.data)) {
            for (const candleArray of response.data) {
                // Angel One returns: [timestamp, open, high, low, close, volume]
                const timestamp = new Date(candleArray[0]).getTime() / 1000; // Convert to Unix timestamp
                candles.push({
                    timestamp: Math.floor(timestamp),
                    open: parseFloat(candleArray[1]),
                    high: parseFloat(candleArray[2]),
                    low: parseFloat(candleArray[3]),
                    close: parseFloat(candleArray[4]),
                    volume: parseInt(candleArray[5]),
                });
            }
        }
        logger_1.default.info(`Fetched ${candles.length} candles from Angel One API`);
        return candles;
    }
    catch (error) {
        logger_1.default.error('Failed to fetch historical data from Angel One API:', {
            error: error.message,
            params,
        });
        throw new Error(`Angel One API error: ${error.message}`);
    }
}
/**
 * Search for instrument token by symbol
 * Note: You'll need to download and cache the instrument list from Angel One
 */
async function searchInstrument(symbol, exchange = 'NSE') {
    // This would typically search through a cached instrument master file
    // For now, returning a placeholder
    logger_1.default.warn('Instrument search not yet fully implemented');
    // You can download the instrument list from:
    // https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json
    return null;
}
/**
 * Retry wrapper for API calls with exponential backoff
 */
async function retryApiCall(fn, maxRetries = 3, baseDelay = 1000) {
    let lastError;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await fn();
        }
        catch (error) {
            lastError = error;
            const delay = baseDelay * Math.pow(2, attempt);
            logger_1.default.warn(`API call failed (attempt ${attempt + 1}/${maxRetries}). Retrying in ${delay}ms...`, {
                error: error.message,
            });
            await new Promise((resolve) => setTimeout(resolve, delay));
        }
    }
    throw lastError || new Error('API call failed after retries');
}
