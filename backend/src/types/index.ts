// Candle data structure
export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// Instrument information
export interface Instrument {
  securityId: string;
  exchangeSegment: string;
  instrumentType: string;
  symbol: string;
  name?: string;
  lotSize?: number;
}

// Trade record
export interface Trade {
  id: string;
  timestamp: number;
  type: 'BUY' | 'SELL';
  price: number;
  quantity: number;
  instrument: string;
  pnl?: number;
}

// Position tracking
export interface Position {
  instrument: string;
  quantity: number;
  averagePrice: number;
  realizedPnL: number;
  unrealizedPnL: number;
}

// Session state
export interface SessionState {
  trades: Trade[];
  position: Position | null;
  currentCandleIndex: number;
  totalRealizedPnL: number;
  accountBalance: number;
}

// API request types
export interface GetCandlesRequest {
  securityId: string;
  exchangeSegment: string;
  instrument: string;
  interval: string;
  fromDate: string;
  toDate: string;
}

// Dhan API response types
export interface DhanCandleResponse {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
