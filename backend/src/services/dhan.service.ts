import { DhanHqClient, DhanEnv } from 'dhanhq';
import logger from '../utils/logger';
import axios from 'axios';

let dhanClient: any = null;

export interface DhanHistoricalParams {
    securityId: string;
    exchangeSegment: string;
    instrument: string;
    interval: string;
    fromDate: string;
    toDate: string;
}

/**
 * Initialize Dhan API client
 */
export function initDhanClient() {
    if (dhanClient) {
        return dhanClient;
    }

    const accessToken = process.env.DHAN_ACCESS_TOKEN;
    if (!accessToken) {
        logger.warn('DHAN_ACCESS_TOKEN not set in environment variables. Dhan features will be disabled.');
        return null;
    }

    try {
        dhanClient = new DhanHqClient({
            accessToken,
            env: DhanEnv.PROD,
        });
        logger.info('Dhan API client initialized successfully');
        return dhanClient;
    } catch (error: any) {
        logger.error('Failed to initialize Dhan client:', error.message);
        return null;
    }
}

/**
 * Fetch historical candles from Dhan API (v2)
 * Supports up to 1000 candles per request
 */
export async function fetchHistoricalCandles(params: DhanHistoricalParams) {
    const accessToken = process.env.DHAN_ACCESS_TOKEN;
    const clientID = process.env.DHAN_CLIENT_ID;
    if (!accessToken || !clientID) {
        throw new Error('DHAN_ACCESS_TOKEN and DHAN_CLIENT_ID are required');
    }

    try {
        logger.info('Fetching historical candles from Dhan API (v2)', params);

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

        const response = await axios.post(endpoint, payload, {
            headers: {
                'Content-Type': 'application/json',
                'access-token': accessToken,
                'client-id': clientID
            }
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
    } catch (error: any) {
        if (error.response) {
            logger.error('Dhan Historical API error response:', error.response.data);
            throw new Error(`Dhan API error: ${JSON.stringify(error.response.data)}`);
        }
        logger.error('Dhan Historical API error:', error.message);
        throw new Error(`Dhan API error: ${error.message}`);
    }
}

/**
 * Fetch intraday candles (today/yesterday) from Dhan API (v2)
 */
export async function fetchIntradayCandles(params: Omit<DhanHistoricalParams, 'fromDate' | 'toDate'>) {
    const accessToken = process.env.DHAN_ACCESS_TOKEN;
    const clientID = process.env.DHAN_CLIENT_ID;
    if (!accessToken || !clientID) {
        throw new Error('DHAN_ACCESS_TOKEN and DHAN_CLIENT_ID are required');
    }

    try {
        logger.info('Fetching intraday candles from Dhan API (v2)', params);

        const response = await axios.post('https://api.dhan.co/v2/charts/intraday', {
            securityId: params.securityId,
            exchangeSegment: params.exchangeSegment,
            instrument: params.instrument,
            interval: params.interval
        }, {
            headers: {
                'Content-Type': 'application/json',
                'access-token': accessToken,
                'client-id': clientID
            }
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
    } catch (error: any) {
        if (error.response) {
            logger.error('Dhan Intraday API error response:', error.response.data);
            throw new Error(`Dhan API error: ${JSON.stringify(error.response.data)}`);
        }
        logger.error('Dhan Intraday API error:', error.message);
        throw new Error(`Dhan API error: ${error.message}`);
    }
}

/**
 * Get Dhan client instance
 */
export function getDhanClient() {
    if (!dhanClient) {
        return initDhanClient();
    }
    return dhanClient;
}

/**
 * Fetch rolling option historical data (Expired options support)
 * This uses a direct HTTP request as the dhanhq-js package might not expose this endpoint yet.
 */
export async function fetchRollingOptionData(params: {
    securityId: string;
    exchangeSegment: string;
    instrument: string;
    expiryFlag: 'MONTH' | 'WEEK' | 'ALL';
    expiryCode?: number;
    strike: 'ATM' | string; // e.g. ATM, ATM+1, ATM-1
    optionType: 'CALL' | 'PUT';
    fromDate: string;
    toDate: string;
    interval: string;
}) {
    const accessToken = process.env.DHAN_ACCESS_TOKEN;
    const clientID = process.env.DHAN_CLIENT_ID;
    if (!accessToken || !clientID) {
        throw new Error('DHAN_ACCESS_TOKEN and DHAN_CLIENT_ID are required');
    }

    try {
        logger.info('Fetching rolling option data from Dhan API (v2)', params);

        const response = await axios.post('https://api.dhan.co/v2/charts/rollingoption', {
            exchangeSegment: params.exchangeSegment,
            interval: params.interval,
            securityId: params.securityId,
            instrument: params.instrument,
            expiryFlag: params.expiryFlag,
            expiryCode: params.expiryCode || 1,
            strike: params.strike,
            drvOptionType: params.optionType,
            requiredData: ['open', 'high', 'low', 'close', 'volume'],
            fromDate: params.fromDate,
            toDate: params.toDate
        }, {
            headers: {
                'Content-Type': 'application/json',
                'access-token': accessToken,
                'client-id': clientID
            }
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
    } catch (error: any) {
        if (error.response) {
            logger.error('Dhan Rolling Option API error response:', error.response.data);
            throw new Error(`Dhan API error: ${JSON.stringify(error.response.data)}`);
        }
        logger.error('Dhan Rolling Option API error:', error.message);
        throw new Error(`Dhan API error: ${error.message}`);
    }
}

/**
 * Place a market order on Dhan
 */
export async function placeOrder(params: {
    securityId: string;
    exchangeSegment: string;
    transactionType: 'BUY' | 'SELL';
    quantity: number;
    price?: number;          // Required for LIMIT orders
    orderType?: 'MARKET' | 'LIMIT';
    productType?: 'CNC' | 'INTRADAY' | 'MARGIN' | 'MTF' | 'CO' | 'BO';
}) {
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
        logger.info('Placing order on Dhan API', { ...params, orderType, price });

        const response = await axios.post('https://api.dhan.co/v2/orders', {
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
            }
        });

        logger.info('Dhan Order placement response:', response.data);
        return response.data;
    } catch (error: any) {
        if (error.response) {
            logger.error('Dhan Order placement API error response:', error.response.data);
            throw new Error(`Dhan API error: ${JSON.stringify(error.response.data)}`);
        }
        logger.error('Dhan Order placement API error:', error.message);
        throw new Error(`Dhan API error: ${error.message}`);
    }
}

/**
 * Retry wrapper for API calls
 */
export async function retryApiCall<T>(fn: () => Promise<T>, maxRetries = 3, baseDelay = 1000): Promise<T> {
    let lastError: any;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error: any) {
            lastError = error;
            const delay = baseDelay * Math.pow(2, attempt);
            logger.warn(`API call failed (attempt ${attempt + 1}/${maxRetries}). Retrying in ${delay}ms...`, {
                error: error.message,
            });
            await new Promise((resolve) => setTimeout(resolve, delay));
        }
    }
    throw lastError || new Error('API call failed after retries');
}
