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

// Why a trade was closed. REVERSAL/OPP_SIGNAL/LEG_DECAY come from the auto-BT
// exit engine (autoBacktestEngine.ts evaluateAutoExitSignal) and only ever apply
// to auto-entered backtest positions.
export type ExitReason = 'SL' | 'TP' | 'MANUAL' | 'TIME_OVER' | 'REVERSAL' | 'OPP_SIGNAL' | 'LEG_DECAY';

// One segment of the recent-price-action leg sequence captured at entry — either a
// completed Al Brooks impulse leg or the pullback (retrace) between two legs. Segments
// are contiguous, so every candle from the oldest tracked leg up to the entry bar sits
// in exactly one segment.
export interface LegSegment {
  kind: 'leg' | 'pullback';        // impulse leg vs the retrace between legs
  direction: 'bull' | 'bear';      // leg = its impulse direction; pullback = counter direction (the leg it retraces)
  startIndex: number;              // inclusive first candle index
  endIndex: number;                // inclusive last candle index
  startTime: number;               // timestamp of the startIndex candle — robust chart mapping (index-alignment-free)
  endTime: number;                 // timestamp of the endIndex candle
  barCount: number;                // endIndex - startIndex + 1
  startPrice: number;              // open of the startIndex candle
  endPrice: number;                // close of the endIndex candle
  high: number;                    // highest high across the segment's candles
  low: number;                     // lowest low across the segment's candles
  movePct: number;                 // signed % move across the segment ((endPrice-startPrice)/startPrice*100)
  brrAvg: number;                  // mean body-to-range ratio over the segment's candles
  clvAvg: number;                  // mean close-location value
  uwrAvg: number;                  // mean upper-wick ratio
  lwrAvg: number;                  // mean lower-wick ratio
  highBreakCount: number;          // bars whose high broke the prior bar's high, within the segment
  lowBreakCount: number;           // bars whose low broke the prior bar's low, within the segment
  // Per-candle quality series (oldest→newest), present only in 'full' detail mode —
  // stripped before Firestore persistence, retained in exports.
  brr?: number[];
  clv?: number[];
  uwr?: number[];
  lwr?: number[];
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
  // Ties an exit fill to the exact entry fill it closes. Present only on trades
  // opened in multi-trade mode (auto-BT with "Skip if open" unchecked), where
  // several independent trades run concurrently and the sequential net-quantity
  // walk in groupTradesIntoPositions cannot pair them up. Absent everywhere else.
  positionId?: string;
  stopLoss?: number;
  target?: number;
  exitReason?: ExitReason;
  slTrailed?: boolean; // SL had been ratcheted by the pivot trail before this exit
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
  efficiencyRatioAtEntry?: number; // Kaufman ER over last N bars ending at entry — net displacement / total path, bounded [0,1]; near 1 = efficient trend, near 0 = chop
  highBreakCountAtEntry?: number; // count of bars whose high broke the immediately preceding bar's high, within the window
  lowBreakCountAtEntry?: number;  // count of bars whose low broke the immediately preceding bar's low, within the same window
  barBreakWindowAtEntry?: number; // actual bar-to-bar comparisons made for the two counts above (<= configured lookback)
  ema21SlopeAtEntry?: number; // EMA21 points-per-bar slope over the configured lookback ending at entry
  ema50SlopeAtEntry?: number; // EMA50 points-per-bar slope over the configured lookback ending at entry
  ema20GapBarRatioAtEntry?: number;      // fraction of bars in window not touching EMA20 (Brooks gap bar — strong trend)
  ema20CloseAboveRatioAtEntry?: number;  // fraction of closes above EMA20 in window (always-in bias; below = 1 - this)
  ema20InteractionWindowAtEntry?: number; // actual window size used for the two ratios above
  pivotHighSeqAtEntry?: string;    // last up-to-4 bearish trend labels (HH/LH), oldest→newest, joined with '-'
  pivotLowSeqAtEntry?: string;     // last up-to-4 bullish trend labels (HL/LL), oldest→newest, joined with '-'
  pivotGapAvgBarsAtEntry?: number; // mean bar-count gap between consecutive same-type pivots across both sequences
  legStartIndexAtEntry?: number;  // bar index where the frozen impulse leg began (undefined = leg window not used; metrics windowed at entry bar)
  legEndIndexAtEntry?: number;    // bar index of the leg's swing extreme (frozen at pullback start)
  legBarCountAtEntry?: number;    // bars in the frozen leg, inclusive of both ends
  maxConsecutiveHighBreaksAtEntry?: number; // longest run of bars each breaking prior high without breaking prior low, within the leg/window
  maxConsecutiveLowBreaksAtEntry?: number;  // mirror: prior-low breaks without prior-high breaks
  // Recent-price-action context: the last up-to-N Al Brooks impulse legs plus the
  // pullback candles between them, contiguous back from the entry bar, newest→oldest
  // (index 0 = closest to entry, walking back in time). Per-candle arrays are present
  // only in 'full' detail mode and are stripped before Firestore persistence (averages
  // retained). See LegSegment.
  legSequenceAtEntry?: LegSegment[];
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
  // ── Auto-BT exit engine (all optional — absent on manual positions and old sessions) ──
  autoEntry?: boolean; // position was OPENED by the auto engine; adds/reduces don't change it
  // inline literal union (not RegimeKey) to avoid a types→utils import cycle
  entryRegime?: 'uptrend' | 'downtrend' | 'range' | 'reversal';
  entryBarIndex?: number; // candle index of the opening bar
  // exit engine's own reversal state — deliberately separate from withTrendSeen,
  // which checkTrendReversal owns for instrumentation
  exitWithTrendSeen?: boolean;
  exitAgainstBars?: number;
  slTrailed?: boolean;
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

// One independently-managed backtest trade. Used only in multi-trade mode
// (auto-BT with "Skip if open" unchecked): each entry signal opens its own
// OpenPosition with its own SL/TP and exits on its own, never blending with
// the others. `store.position` is a derived net mirror of these — see
// syncNetPositionMirror in sharedActions.ts. Backtest-only by construction.
export interface OpenPosition extends BacktestPosition {
  id: string;              // also stamped onto this trade's entry + exit fills as Trade.positionId
  entryTimestamp: number;  // candle timestamp of the opening bar (seconds, same unit as Candle)
}

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
