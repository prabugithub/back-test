"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initDhanClient = initDhanClient;
exports.loginDhan = loginDhan;
exports.fetchHistoricalCandles = fetchHistoricalCandles;
exports.fetchIntradayCandles = fetchIntradayCandles;
exports.getDhanClient = getDhanClient;
exports.fetchRollingOptionData = fetchRollingOptionData;
exports.placeOrder = placeOrder;
exports.getOrderStatus = getOrderStatus;
exports.modifyOrder = modifyOrder;
exports.getPositions = getPositions;
exports.retryApiCall = retryApiCall;
const dhanhq_1 = require("dhanhq");
const logger_1 = __importDefault(require("../utils/logger"));
const axios_1 = __importDefault(require("axios"));
const otplib_1 = require("otplib");
let dhanClient = null;
let tokenRefreshTimer = null;
/**
 * Initialize Dhan API client
 */
function initDhanClient() {
    if (dhanClient) {
        return dhanClient;
    }
    const accessToken = process.env.DHAN_ACCESS_TOKEN;
    if (!accessToken) {
        logger_1.default.warn('DHAN_ACCESS_TOKEN not set in environment variables. Dhan features will be disabled.');
        return null;
    }
    try {
        dhanClient = new dhanhq_1.DhanHqClient({
            accessToken,
            env: dhanhq_1.DhanEnv.PROD,
        });
        logger_1.default.info('Dhan API client initialized successfully');
        return dhanClient;
    }
    catch (error) {
        logger_1.default.error('Failed to initialize Dhan client:', error.message);
        return null;
    }
}
/**
 * Login to Dhan using TOTP and update the access token automatically.
 * Requires DHAN_PIN and DHAN_TOTP_SECRET env vars.
 * Falls back to static DHAN_ACCESS_TOKEN if not set.
 * Schedules a refresh 23 hours after each successful login.
 */
async function loginDhan() {
    const clientId = process.env.DHAN_CLIENT_ID;
    const pin = process.env.DHAN_PIN;
    const totpSecret = process.env.DHAN_TOTP_SECRET;
    if (!clientId || !pin || !totpSecret) {
        logger_1.default.warn('DHAN_PIN or DHAN_TOTP_SECRET not set — skipping TOTP login, using static DHAN_ACCESS_TOKEN');
        return;
    }
    // Clear the old refresh timer BEFORE the first await to prevent cascading retries
    if (tokenRefreshTimer) {
        clearTimeout(tokenRefreshTimer);
        tokenRefreshTimer = null;
    }
    const totp = otplib_1.authenticator.generate(totpSecret);
    logger_1.default.info('Attempting Dhan TOTP login', { clientId });
    const response = await axios_1.default.post('https://auth.dhan.co/app/generateAccessToken', null, { params: { dhanClientId: clientId, pin, totp }, timeout: 10000 });
    const { accessToken, expiryTime } = response.data;
    if (!accessToken) {
        throw new Error(`Dhan TOTP login failed: no accessToken in response — ${JSON.stringify(response.data)}`);
    }
    process.env.DHAN_ACCESS_TOKEN = accessToken;
    // Re-initialize Dhan client with the fresh token
    dhanClient = null;
    initDhanClient();
    logger_1.default.info(`Dhan TOTP login successful, token expires: ${expiryTime}`);
    // Schedule next refresh 1 hour before expiry (23h from now)
    if (tokenRefreshTimer)
        clearTimeout(tokenRefreshTimer);
    tokenRefreshTimer = setTimeout(() => {
        loginDhan().catch((err) => logger_1.default.error('Dhan token auto-refresh failed:', err.message));
    }, 23 * 60 * 60 * 1000);
}
/**
 * Fetch historical candles from Dhan API (v2)
 * Supports up to 1000 candles per request
 */
async function fetchHistoricalCandles(params) {
    const accessToken = process.env.DHAN_ACCESS_TOKEN;
    const clientID = process.env.DHAN_CLIENT_ID;
    if (!accessToken || !clientID) {
        throw new Error('DHAN_ACCESS_TOKEN and DHAN_CLIENT_ID are required');
    }
    try {
        logger_1.default.info('Fetching historical candles from Dhan API (v2)', params);
        const isMinuteInterval = ['1', '5', '15', '25', '60'].includes(String(params.interval));
        const endpoint = isMinuteInterval
            ? 'https://api.dhan.co/v2/charts/intraday'
            : 'https://api.dhan.co/v2/charts/historical';
        const payload = isMinuteInterval ? {
            securityId: params.securityId,
            exchangeSegment: params.exchangeSegment,
            instrument: params.instrument,
            fromDate: params.fromDate,
            toDate: params.toDate,
            interval: params.interval
        } : {
            symbol: params.securityId,
            securityId: params.securityId,
            exchangeSegment: params.exchangeSegment,
            instrument: params.instrument,
            expiryCode: 0,
            fromDate: params.fromDate,
            toDate: params.toDate,
            interval: params.interval
        };
        const response = await axios_1.default.post(endpoint, payload, {
            headers: {
                'Content-Type': 'application/json',
                'access-token': accessToken,
                'client-id': clientID
            },
            timeout: 10000,
        });
        const timeArray = response.data.start_time || response.data.start_Time || response.data.timestamp;
        if (response.data && timeArray) {
            const candles = [];
            for (let i = 0; i < timeArray.length; i++) {
                candles.push({
                    timestamp: timeArray[i],
                    open: response.data.open[i],
                    high: response.data.high[i],
                    low: response.data.low[i],
                    close: response.data.close[i],
                    volume: response.data.volume[i],
                });
            }
            return candles;
        }
        return [];
    }
    catch (error) {
        if (error.response) {
            logger_1.default.error('Dhan Historical API error response:', error.response.data);
            throw new Error(`Dhan API error: ${JSON.stringify(error.response.data)}`);
        }
        logger_1.default.error('Dhan Historical API error:', error.message);
        throw new Error(`Dhan API error: ${error.message}`);
    }
}
/**
 * Fetch intraday candles (today/yesterday) from Dhan API (v2)
 */
async function fetchIntradayCandles(params) {
    const accessToken = process.env.DHAN_ACCESS_TOKEN;
    const clientID = process.env.DHAN_CLIENT_ID;
    if (!accessToken || !clientID) {
        throw new Error('DHAN_ACCESS_TOKEN and DHAN_CLIENT_ID are required');
    }
    try {
        logger_1.default.info('Fetching intraday candles from Dhan API (v2)', params);
        const response = await axios_1.default.post('https://api.dhan.co/v2/charts/intraday', {
            securityId: params.securityId,
            exchangeSegment: params.exchangeSegment,
            instrument: params.instrument,
            interval: params.interval
        }, {
            headers: {
                'Content-Type': 'application/json',
                'access-token': accessToken,
                'client-id': clientID
            },
            timeout: 10000,
        });
        const timeArray = response.data.start_time || response.data.start_Time || response.data.timestamp;
        if (response.data && timeArray) {
            const candles = [];
            for (let i = 0; i < timeArray.length; i++) {
                candles.push({
                    timestamp: timeArray[i],
                    open: response.data.open[i],
                    high: response.data.high[i],
                    low: response.data.low[i],
                    close: response.data.close[i],
                    volume: response.data.volume[i],
                });
            }
            return candles;
        }
        return [];
    }
    catch (error) {
        if (error.response) {
            logger_1.default.error('Dhan Intraday API error response:', error.response.data);
            throw new Error(`Dhan API error: ${JSON.stringify(error.response.data)}`);
        }
        logger_1.default.error('Dhan Intraday API error:', error.message);
        throw new Error(`Dhan API error: ${error.message}`);
    }
}
/**
 * Get Dhan client instance
 */
function getDhanClient() {
    if (!dhanClient) {
        return initDhanClient();
    }
    return dhanClient;
}
/**
 * Fetch rolling option historical data (Expired options support)
 * This uses a direct HTTP request as the dhanhq-js package might not expose this endpoint yet.
 */
async function fetchRollingOptionData(params) {
    const accessToken = process.env.DHAN_ACCESS_TOKEN;
    const clientID = process.env.DHAN_CLIENT_ID;
    if (!accessToken || !clientID) {
        throw new Error('DHAN_ACCESS_TOKEN and DHAN_CLIENT_ID are required');
    }
    try {
        logger_1.default.info('Fetching rolling option data from Dhan API (v2)', params);
        const response = await axios_1.default.post('https://api.dhan.co/v2/charts/rollingoption', {
            exchangeSegment: params.exchangeSegment,
            interval: params.interval,
            securityId: Number(params.securityId), // Dhan expects integer, not string
            instrument: params.instrument,
            expiryFlag: params.expiryFlag,
            expiryCode: params.expiryCode || 1,
            strike: params.strike,
            drvOptionType: params.optionType,
            requiredData: ['open', 'high', 'low', 'close', 'iv', 'volume', 'oi', 'spot'],
            fromDate: params.fromDate,
            toDate: params.toDate
        }, {
            headers: {
                'Content-Type': 'application/json',
                'access-token': accessToken,
                'client-id': clientID
            },
            timeout: 10000,
        });
        // Dhan response: { data: { ce: { open, high, low, close, volume, iv, oi, spot, timestamp }, pe: ... } }
        // For CALL requests, data lives under .ce; for PUT requests, under .pe
        const optionKey = params.optionType === 'CALL' ? 'ce' : 'pe';
        const optionData = response.data?.data?.[optionKey];
        if (optionData && Array.isArray(optionData.timestamp) && optionData.timestamp.length > 0) {
            const candles = [];
            for (let i = 0; i < optionData.timestamp.length; i++) {
                candles.push({
                    timestamp: optionData.timestamp[i],
                    open: optionData.open?.[i] ?? 0,
                    high: optionData.high?.[i] ?? 0,
                    low: optionData.low?.[i] ?? 0,
                    close: optionData.close?.[i] ?? 0,
                    volume: optionData.volume?.[i] ?? 0,
                    iv: optionData.iv?.[i] ?? null,
                    oi: optionData.oi?.[i] ?? null,
                    spot: optionData.spot?.[i] ?? null,
                });
            }
            return candles;
        }
        return [];
    }
    catch (error) {
        if (error.response) {
            logger_1.default.error('Dhan Rolling Option API error response:', error.response.data);
            throw new Error(`Dhan API error: ${JSON.stringify(error.response.data)}`);
        }
        logger_1.default.error('Dhan Rolling Option API error:', error.message);
        throw new Error(`Dhan API error: ${error.message}`);
    }
}
/**
 * Place a market order on Dhan
 */
async function placeOrder(params) {
    const accessToken = process.env.DHAN_ACCESS_TOKEN;
    const clientID = process.env.DHAN_CLIENT_ID;
    if (!accessToken || !clientID) {
        throw new Error('DHAN_ACCESS_TOKEN and DHAN_CLIENT_ID are required');
    }
    const orderType = params.orderType || 'LIMIT';
    const price = params.price || 0;
    // For LIMIT orders, price must be > 0
    if (orderType === 'LIMIT' && price <= 0) {
        throw new Error('LIMIT order requires a valid price > 0');
    }
    try {
        logger_1.default.info('Placing order on Dhan API', { ...params, orderType, price });
        const response = await axios_1.default.post('https://api.dhan.co/v2/orders', {
            dhanClientId: clientID,
            correlationId: `backtest-${Date.now()}`,
            transactionType: params.transactionType,
            exchangeSegment: params.exchangeSegment,
            productType: params.productType || 'INTRADAY',
            orderType,
            validity: 'DAY',
            securityId: params.securityId,
            quantity: params.quantity,
            price,
            disclosedQuantity: 0,
            triggerPrice: 0,
            afterMarketOrder: false,
            amoTime: 'OPEN',
            boProfitValue: 0,
            boStopLossValue: 0
        }, {
            headers: {
                'Content-Type': 'application/json',
                'access-token': accessToken,
                'client-id': clientID
            },
            timeout: 10000,
        });
        logger_1.default.info('Dhan Order placement response:', response.data);
        // Dhan sometimes returns HTTP 200 with status:"failure" — treat as an error
        if (response.data?.status === 'failure' || response.data?.status === 'FAILURE') {
            const remarks = response.data?.remarks || JSON.stringify(response.data);
            throw new Error(remarks);
        }
        return response.data;
    }
    catch (error) {
        if (error.response) {
            logger_1.default.error('Dhan Order placement API error response:', error.response.data);
            throw new Error(`Dhan API error: ${JSON.stringify(error.response.data)}`);
        }
        logger_1.default.error('Dhan Order placement API error:', error.message);
        throw new Error(`Dhan API error: ${error.message}`);
    }
}
/**
 * Get Order Status from Dhan
 */
async function getOrderStatus(orderId) {
    const accessToken = process.env.DHAN_ACCESS_TOKEN;
    const clientID = process.env.DHAN_CLIENT_ID;
    if (!accessToken || !clientID) {
        throw new Error('DHAN_ACCESS_TOKEN and DHAN_CLIENT_ID are required');
    }
    try {
        const response = await axios_1.default.get(`https://api.dhan.co/v2/orders/${orderId}`, {
            headers: {
                'access-token': accessToken,
                'client-id': clientID
            },
            timeout: 10000,
        });
        return response.data;
    }
    catch (error) {
        if (error.response) {
            logger_1.default.error(`Dhan Get Order API error response for ${orderId}:`, error.response.data);
            throw new Error(`Dhan API error: ${JSON.stringify(error.response.data)}`);
        }
        logger_1.default.error(`Dhan Get Order API error for ${orderId}:`, error.message);
        throw new Error(`Dhan API error: ${error.message}`);
    }
}
/**
 * Modify a pending order on Dhan
 */
async function modifyOrder(orderId, params) {
    const accessToken = process.env.DHAN_ACCESS_TOKEN;
    const clientID = process.env.DHAN_CLIENT_ID;
    if (!accessToken || !clientID) {
        throw new Error('DHAN_ACCESS_TOKEN and DHAN_CLIENT_ID are required');
    }
    try {
        logger_1.default.info(`Modifying order ${orderId} on Dhan API`, params);
        const response = await axios_1.default.put(`https://api.dhan.co/v2/orders/${orderId}`, {
            orderId: orderId,
            orderType: params.orderType,
            quantity: params.quantity,
            price: params.price || 0,
            exchangeSegment: params.exchangeSegment,
            validity: 'DAY',
            disclosedQuantity: 0,
            triggerPrice: 0
        }, {
            headers: {
                'Content-Type': 'application/json',
                'access-token': accessToken,
                'client-id': clientID
            },
            timeout: 10000,
        });
        logger_1.default.info(`Dhan Order Modify response for ${orderId}:`, response.data);
        if (response.data?.status === 'failure' || response.data?.status === 'FAILURE') {
            const remarks = response.data?.remarks || JSON.stringify(response.data);
            throw new Error(remarks);
        }
        return response.data;
    }
    catch (error) {
        if (error.response) {
            logger_1.default.error(`Dhan Order Modify API error response for ${orderId}:`, error.response.data);
            throw new Error(`Dhan API error: ${JSON.stringify(error.response.data)}`);
        }
        logger_1.default.error(`Dhan Order Modify API error for ${orderId}:`, error.message);
        throw new Error(`Dhan API error: ${error.message}`);
    }
}
/**
 * Get all current positions from Dhan
 */
async function getPositions() {
    const accessToken = process.env.DHAN_ACCESS_TOKEN;
    const clientID = process.env.DHAN_CLIENT_ID;
    if (!accessToken || !clientID) {
        throw new Error('DHAN_ACCESS_TOKEN and DHAN_CLIENT_ID are required');
    }
    try {
        logger_1.default.info('Fetching positions from Dhan API');
        const response = await axios_1.default.get('https://api.dhan.co/v2/positions', {
            headers: {
                'access-token': accessToken,
                'client-id': clientID
            },
            timeout: 10000,
        });
        return response.data;
    }
    catch (error) {
        if (error.response) {
            logger_1.default.error('Dhan Get Positions API error response:', error.response.data);
            throw new Error(`Dhan API error: ${JSON.stringify(error.response.data)}`);
        }
        logger_1.default.error('Dhan Get Positions API error:', error.message);
        throw new Error(`Dhan API error: ${error.message}`);
    }
}
/**
 * Retry wrapper for API calls
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
