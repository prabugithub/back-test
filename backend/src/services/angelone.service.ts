const { SmartAPI } = require('smartapi-javascript');
import { authenticator } from 'otplib';
import logger from '../utils/logger';
import { DhanCandleResponse } from '../types';

let smartApi: any = null;

/**
 * Initialize Angel One SmartAPI client
 */
export function initAngelOneClient(): any {
  if (smartApi) {
    return smartApi;
  }

  const apiKey = process.env.ANGELONE_API_KEY;
  const clientCode = process.env.ANGELONE_CLIENT_CODE;
  const password = process.env.ANGELONE_PASSWORD;
  const totp = process.env.ANGELONE_TOTP;

  if (!apiKey || !clientCode || !password) {
    throw new Error(
      'ANGELONE_API_KEY, ANGELONE_CLIENT_CODE, and ANGELONE_PASSWORD must be set in environment variables'
    );
  }

  smartApi = new SmartAPI({
    api_key: apiKey,
  });

  logger.info('Angel One SmartAPI client initialized successfully');

  return smartApi;
}

/**
 * Login to Angel One and generate session
 */
export async function loginAngelOne(): Promise<void> {
  const client = initAngelOneClient();

  const clientCode = process.env.ANGELONE_CLIENT_CODE;
  const password = process.env.ANGELONE_PASSWORD;
  const totpSecret = process.env.ANGELONE_TOTP;

  if (!clientCode || !password || !totpSecret) {
    throw new Error('ANGELONE_API_KEY, ANGELONE_CLIENT_CODE, ANGELONE_PASSWORD, and ANGELONE_TOTP must be set in environment variables');
  }

  // Generate TOTP code from the secret
  const totpCode = authenticator.generate(totpSecret);

  logger.info('Attempting Angel One login', {
    clientCode,
    totpCode: totpCode.substring(0, 2) + '****', // Log partial for debugging
  });

  try {
    logger.info('Calling generateSession with client code and TOTP');
    const loginResponse = await client.generateSession(clientCode, password, totpCode);

    logger.info('Login response received', {
      hasData: !!loginResponse.data,
      status: loginResponse.status,
      message: loginResponse.message,
      fullResponse: JSON.stringify(loginResponse).substring(0, 500), // Log first 500 chars
    });

    if (loginResponse && loginResponse.data) {
      logger.info('Angel One login successful', {
        jwtToken: loginResponse.data.jwtToken ? 'present' : 'missing',
      });

      // Set the access token
      client.setAccessToken(loginResponse.data.jwtToken);

      // Set refresh token if the method exists
      if (typeof client.setRefreshToken === 'function' && loginResponse.data.refreshToken) {
        client.setRefreshToken(loginResponse.data.refreshToken);
      }
    } else {
      throw new Error(`Login failed: ${loginResponse.message || 'No data in response'}`);
    }
  } catch (error: any) {
    logger.error('Angel One login failed:', error.message || error);
    logger.error('Full error:', JSON.stringify(error).substring(0, 500));
    throw new Error(`Angel One login error: ${error.message || error}`);
  }
}

/**
 * Get Angel One client instance
 */
export function getAngelOneClient(): any {
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
export async function fetchHistoricalCandles(params: {
  symbolToken: string;
  exchange: string;
  interval: string;
  fromDate: string;
  toDate: string;
}): Promise<DhanCandleResponse[]> {
  const client = getAngelOneClient();

  try {
    logger.info('Fetching historical data from Angel One API', {
      symbolToken: params.symbolToken,
      interval: params.interval,
      fromDate: params.fromDate,
      toDate: params.toDate,
    });

    // Map interval to Angel One format
    const intervalMap: Record<string, string> = {
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
      fromdate: params.fromDate,  // Format: "YYYY-MM-DD HH:MM"
      todate: params.toDate,
    });

    // Transform Angel One response to our candle format
    const candles: DhanCandleResponse[] = [];

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

    logger.info(`Fetched ${candles.length} candles from Angel One API`);

    return candles;
  } catch (error: any) {
    logger.error('Failed to fetch historical data from Angel One API:', {
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
export async function searchInstrument(symbol: string, exchange: string = 'NSE'): Promise<any> {
  // This would typically search through a cached instrument master file
  // For now, returning a placeholder
  logger.warn('Instrument search not yet fully implemented');

  // You can download the instrument list from:
  // https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json

  return null;
}

/**
 * Retry wrapper for API calls with exponential backoff
 */
export async function retryApiCall<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: Error | undefined;

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
