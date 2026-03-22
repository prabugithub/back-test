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

        if (response.data && response.data.start_time) {
            const candles = [];
            for (let i = 0; i < response.data.start_time.length; i++) {
                candles.push({
                    timestamp: response.data.start_time[i],
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
