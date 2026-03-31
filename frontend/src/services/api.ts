import axios from 'axios';
import type { GetCandlesParams, CandlesResponse } from '../types';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:3001';

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

/**
 * Fetch candles from backend API
 */
export async function fetchCandles(params: GetCandlesParams): Promise<CandlesResponse> {
  const response = await apiClient.get<CandlesResponse>('/api/data/candles', {
    params,
  });
  return response.data;
}

/**
 * Clear cache
 */
export async function clearCache(params?: Partial<GetCandlesParams>): Promise<void> {
  await apiClient.delete('/api/data/cache', {
    params,
  });
}

/**
 * Health check
 */
export async function healthCheck(): Promise<boolean> {
  try {
    const response = await apiClient.get('/health');
    return response.data.status === 'healthy';
  } catch {
    return false;
  }
}

/**
 * Upload screenshot to Google Drive
 */
export async function uploadScreenshot(image: string, fileName: string): Promise<{ link: string }> {
  const response = await apiClient.post('/api/screenshot/upload', {
    image,
    fileName,
  });
  return response.data;
}

/**
 * Run option backtesting for spot trades
 */
export async function backtestOptions(params: {
  spotTrades: any[];
  offsetSell?: number;
  offsetBuy?: number;
  instrument?: string;
}): Promise<any> {
  const response = await apiClient.post('/api/options/backtest', params);
  return response.data;
}
/**
 * Place a live market order on Dhan
 */
export async function placeLiveOrder(params: {
  securityId: string;
  exchangeSegment: string;
  transactionType: 'BUY' | 'SELL';
  quantity: number;
  price?: number;
  orderType?: 'MARKET' | 'LIMIT';
  productType?: string;
}): Promise<any> {
  const response = await apiClient.post('/api/live/order', params);
  return response.data;
}

/**
 * Fetch ATM Option token for live trading
 */
export async function getATMOption(spotPrice: number, optionType: 'CE' | 'PE', instrument: 'NIFTY' | 'BANKNIFTY' = 'NIFTY'): Promise<any> {
  const response = await apiClient.get('/api/live/atm-option', {
    params: { price: spotPrice, type: optionType, instrument }
  });
  return response.data;
}
