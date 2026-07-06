// Candle data structure
export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TradeJournal {
  ltMarket: string;
  htMarket: string;
  entryPosition: string;
  llhhPivot: string;
  entrySign: string;
  notes: string;
  systemEntryAlign: 'Yes' | 'No';
  myViewEntryAlign: 'Yes' | 'No';
  systemMoveAlign: 'Yes' | 'No';
  myViewMoveAlign: 'Yes' | 'No';
  tradeCategory: 'System' | 'Discretionary';
  screenshotUrl?: string;
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
  stopLoss?: number;
  target?: number;
  exitReason?: 'SL' | 'TP' | 'MANUAL' | 'TIME_OVER';
  slHit?: boolean;
  tpHit?: boolean;
  slDialogShown?: boolean;
  tpDialogShown?: boolean;
  hitFirst?: 'SL' | 'TP';
  trendReversed?: boolean;
  trendReversedPnL?: number;
  withTrendSeen?: boolean;
  journal?: TradeJournal;
  atrDepthAtEntry?: number;
  barOverlapAtEntry?: number[]; // raw per-bar overlap ratio, up to N bars ending at entry candle (most recent last), unclamped — used for later range/regime labeling
  barOverlapAvgAtEntry?: number; // mean of barOverlapAtEntry — convenience summary of the same window
  barRangeAvgAtEntry?: number;      // mean (high-low) over last N bars ending at entry, direction-agnostic
  bullBarRangeAvgAtEntry?: number;  // mean (high-low) of only bull bars (close>open) in the same window
  bearBarRangeAvgAtEntry?: number;  // mean (high-low) of only bear bars (close<open) in the same window
  interval?: string;
  liveOptionToken?: string;
  optionType?: 'CE' | 'PE';
}

// Position tracking — shared base fields present in both modes
interface PositionBase {
  instrument: string;
  quantity: number;
  averagePrice: number;
  realizedPnL: number;
  unrealizedPnL: number;
  stopLoss?: number;
  target?: number;
  slHit?: boolean;
  tpHit?: boolean;
  slDialogShown?: boolean;
  tpDialogShown?: boolean;
  hitFirst?: 'SL' | 'TP';
  trendReversed?: boolean;
  trendReversedPnL?: number;
  withTrendSeen?: boolean;
}

// Backtest position: broker fields must never be present
export interface BacktestPosition extends PositionBase {
  liveOptionToken?: never;
  pendingOrderId?: never;
  filledQty?: never;
  exitTriggeredByBackend?: never;
}

// Live position: may carry broker-specific fields
export interface LivePosition extends PositionBase {
  liveOptionToken?: string;
  // Set immediately after order placement; cleared once fill is confirmed or order rejected
  pendingOrderId?: string;
  // Qty confirmed filled by broker (from order status poll); undefined means not yet verified
  filledQty?: number;
  // Set when the backend monitor emits position:exit-triggered — prevents checkSLTPHits from
  // placing a duplicate exit order while the backend's MARKET order is already in flight
  exitTriggeredByBackend?: boolean;
}

// Position is the union used throughout the app (store, components, etc.)
export type Position = BacktestPosition | LivePosition;

// API request/response types
export interface GetCandlesParams {
  securityId: string;
  exchangeSegment: string;
  instrument: string;
  interval: string;
  fromDate: string;
  toDate: string;
}

export interface CandlesResponse {
  success: boolean;
  data: Candle[];
  count: number;
  cached: boolean;
}

export type DrawingTool = 'none' | 'select' | 'trendline' | 'horizontal' | 'rectangle' | 'fibonacci' | 'riskReward' | 'freehand' | 'text' | 'callout' | 'channel';

export interface Point {
  x: number;
  y: number;
  price?: number;
  time?: number;    // logical bar index — kept for backward compat & cIdx gating
  barTime?: number; // actual candle Unix timestamp — stable across reloads
}

export interface Drawing {
  id: string;
  type: DrawingTool;
  points: Point[];
  color?: string;
  text?: string;
}
