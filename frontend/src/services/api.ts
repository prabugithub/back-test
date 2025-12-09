import axios from 'axios';
import type { GetCandlesParams, CandlesResponse } from '../types';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

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
