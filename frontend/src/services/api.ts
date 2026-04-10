import axios from 'axios';
import type { GetCandlesParams, CandlesResponse } from '../types';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://168.144.78.61';

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
 * Get lot size for an instrument from the Dhan scrip master on the server.
 */
export async function getOptionLotSize(instrument: 'NIFTY' | 'BANKNIFTY'): Promise<{ instrument: string; lotSize: number }> {
  const response = await apiClient.get('/api/options/lot-size', { params: { instrument } });
  return response.data;
}

/**
 * Run naked buy options backtest against spot trades.
 */
export async function nakedBuyBacktest(params: {
  spotTrades: any[];
  instrument: 'NIFTY' | 'BANKNIFTY';
  expiryFlag: 'WEEK' | 'MONTH';
  strikeMode: 'ATM' | 'OTM1' | 'OTM2' | 'ITM1' | 'ITM2';
  exitMode: 'actual' | 'rr';
  rrValues?: number[];
  riskPerTrade?: number;
  niftyCandles?: any[];
}): Promise<any> {
  const response = await apiClient.post('/api/options/naked-backtest', params);
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
 * Execute Smart Exit Loop for Options
 */
export async function executeSmartExit(params: {
  securityId: string;
  exchangeSegment: string;
  transactionType: 'BUY' | 'SELL';
  quantity: number;
  slPrice: number;
}): Promise<any> {
  const response = await apiClient.post('/api/live/smart-exit', params);
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

/**
 * Fetch real account positions
 */
export async function getLivePositions(): Promise<any> {
    const response = await apiClient.get('/api/live/positions');
    return response.data;
}

/**
 * Fetch status of a specific order by ID.
 * Used after order placement to verify fill status.
 * Dhan response includes: orderStatus, tradedQuantity, remainingQuantity, rejectedReason, etc.
 */
export async function getOrderStatus(orderId: string): Promise<any> {
    const response = await apiClient.get(`/api/live/order/${orderId}`);
    return response.data;
}

/**
 * Register a live option position with the backend position monitor.
 * Once registered, the backend fires the exit order independently of the frontend —
 * so SL/TP will trigger even if the browser is closed.
 */
export async function registerPositionMonitor(params: {
    id: string;
    spotToken: string;
    spotSegment: string;
    direction: 'LONG' | 'SHORT';
    stopLoss: number;
    target: number;
    optionSecurityId: string;
    optionExchangeSegment: string;
    quantity: number;
    entryPrice: number;
}): Promise<any> {
    const response = await apiClient.post('/api/live/monitor', params);
    return response.data;
}

/**
 * Remove a position from backend monitoring (call after manual close).
 */
export async function unregisterPositionMonitor(id: string): Promise<any> {
    const response = await apiClient.delete(`/api/live/monitor/${id}`);
    return response.data;
}

/**
 * Update the target level for a monitored position.
 * Only target can be changed — stop loss is strict and immutable.
 */
export async function updatePositionMonitor(id: string, params: { target: number }): Promise<any> {
    const response = await apiClient.patch(`/api/live/monitor/${id}`, params);
    return response.data;
}

/**
 * Fetch all positions currently being monitored by the backend.
 * Used on frontend reconnect to re-sync local state with backend.
 */
export async function getMonitoredPositions(): Promise<any> {
    const response = await apiClient.get('/api/live/monitor');
    return response.data;
}
