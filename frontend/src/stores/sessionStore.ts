import { create } from 'zustand';
import type { Candle, Trade, Position, OpenPosition, TradeJournal, Drawing, ExitReason } from '../types';
import type { SessionState } from '../services/firebaseSessionService';
import type { SavedAutoBacktestConfig } from '../services/autoBacktestConfigService';
import { createBacktestActions } from './backtestActions';
import { createLiveActions } from './liveActions';
import { createSharedActions } from './sharedActions';
import { createAutoBacktestActions } from './autoBacktestActions';
import { type AutoBacktestConfig, type AutoSignal, type EntryMetricsSnapshot, type RegimeKey, defaultAutoBacktestConfig } from '../utils/autoBacktestEngine';

export interface SessionConfig {
  securityId: string;
  exchangeSegment: string;
  instrumentType: string;
  interval: string;
  fromDate: string;
  toDate: string;
  dataSource: 'api' | 'local' | 'live';
}

// Shared set/get types imported by all action modules — avoids `set as any` casts.
export type StoreSet = (
  partial: SessionStore | Partial<SessionStore> | ((state: SessionStore) => SessionStore | Partial<SessionStore>),
  replace?: false
) => void;
export type StoreGet = () => SessionStore;

export interface SessionStore {
  // ── Data ────────────────────────────────────────────────────────────────────
  candles: Candle[];
  currentIndex: number;
  trades: Trade[];
  // Single net position — the only model outside multi-trade mode. Inside it,
  // this becomes a DERIVED net mirror of `openPositions` (rebuilt by
  // syncNetPositionMirror) and must never be traded against directly.
  position: Position | null;
  // Multi-trade mode only: the independently-managed open trades. Empty array
  // everywhere else, which is what keeps the legacy path bit-for-bit unchanged.
  openPositions: OpenPosition[];
  // Realized P&L of trades closed in multi-trade mode (the mirror is rebuilt
  // from scratch each time, so it cannot accumulate this itself).
  multiRealizedPnL: number;
  instrument: string;
  sessionConfig: SessionConfig | null;

  // ── Live mode ────────────────────────────────────────────────────────────────
  isLiveMode: boolean;
  livePrice: number | null;

  // ── Playback (backtest only) ─────────────────────────────────────────────────
  isPlaying: boolean;
  speed: number;
  isLoading: boolean;
  pendingExitRequest: { type: 'SL' | 'TP' | 'TIME_OVER'; price: number; spotPrice: number } | null;
  pendingTradeRequest: { type: 'BUY' | 'SELL'; quantity: number; stopLoss?: number; target?: number } | null;

  // ── Risk settings ────────────────────────────────────────────────────────────
  tradeQuantity: number;
  riskPerTrade: number;
  targetRR: number;
  autoExitTarget: boolean;
  manualLevels: { sl: number; target: number; entry?: number } | null;

  // ── UI settings ──────────────────────────────────────────────────────────────
  primaryShowMarkers: boolean;
  secondaryShowMarkers: boolean;
  useAtrForSignals: boolean;
  showPivotRR: boolean;
  showSecondaryChart: boolean;
  secondaryTimeframe: string | null;
  secondaryCandles: Candle[];
  crosshairPosition: { time: number | null; price: number | null; sourceChartId: 'primary' | 'secondary' | null };

  // Set to a candle timestamp to pan the chart's view to it (e.g. "jump to entry" from
  // TradeHistoryDialog) without touching `currentIndex`/playback state. AdvancedChart
  // clears it back to null once the pan has been applied.
  scrollToTimestamp: number | null;

  // Set alongside `scrollToTimestamp` to visually flag the jumped-to candle (amber band +
  // arrow). AdvancedChart auto-clears it back to null a few seconds after rendering it.
  highlightTimestamp: number | null;

  // Set to true when addLiveCandle() updates the last candle price (same timestamp),
  // false when a genuinely new candle is appended. Lets AdvancedChart skip expensive
  // indicator / marker rebuilds on price-only ticks.
  isLivePriceUpdate: boolean;

  // ── Auto backtesting ─────────────────────────────────────────────────────────
  autoBacktestConfig: AutoBacktestConfig;
  autoExitSL: boolean;
  lastAutoSignalReason: string;
  isBatchBacktestRunning: boolean;
  batchBacktestProgress: number; // 0–100

  // ── Saved auto-backtest configurations (named, persisted setups) ────────────
  savedAutoBacktestConfigs: SavedAutoBacktestConfig[];
  activeAutoBacktestConfigId: string | null;
  activeAutoBacktestConfigName: string | null;

  // ── Chart tool / indicator state ─────────────────────────────────────────────
  activeChartId: 'primary' | 'secondary';
  sharedActiveTool: string;
  primaryIndicators: string[];
  secondaryIndicators: string[];
  drawings: Drawing[];
  secondaryDrawings: Drawing[];

  // ── Actions (backtest-only) ──────────────────────────────────────────────────
  loadCandles: (candles: Candle[], instrument: string, config?: SessionConfig) => void;
  play: () => void;
  pause: () => void;
  step: (direction: 'forward' | 'backward') => void;
  jump: (count: number) => void;
  setSpeed: (speed: number) => void;
  setCurrentIndex: (index: number) => void;
  initiateTrade: (type: 'BUY' | 'SELL', quantity: number, stopLoss?: number, target?: number) => void;
  resolveTradeRequest: (journal: TradeJournal | null, exitReason?: ExitReason) => void;
  resolveExitRequest: (confirm: boolean, journal?: TradeJournal) => void;
  resetSession: () => void;

  // ── Actions (live-only) ──────────────────────────────────────────────────────
  setLiveMode: (isLive: boolean) => void;
  syncLivePositions: () => Promise<void>;
  updateLivePrice: (price: number) => void;
  addLiveCandle: (candle: Candle) => void;
  patchLiveCandle: (candle: Candle) => void;
  loadSecondaryCandles: () => Promise<void>;

  // ── Actions (shared) ─────────────────────────────────────────────────────────
  setDrawings: (drawings: Drawing[]) => void;
  setSecondaryDrawings: (drawings: Drawing[]) => void;
  setTargetRR: (rr: number) => void;
  setAutoExitTarget: (auto: boolean) => void;
  setCrosshairPosition: (pos: { time: number | null; price: number | null; sourceChartId: 'primary' | 'secondary' | null }) => void;
  scrollToTime: (timestamp: number | null) => void;
  highlightCandle: (timestamp: number | null) => void;
  checkSLTPHits: (index: number, currentPrice?: number) => void;
  executeTrade: (type: 'BUY' | 'SELL', quantity: number, stopLoss?: number, target?: number, priceOverride?: number, exitReason?: ExitReason, journal?: TradeJournal, entryMetricsOverride?: EntryMetricsSnapshot, autoMeta?: { auto: true; regime: RegimeKey; barIndex: number }) => void;
  checkTrendReversal: (index: number, currentPrice?: number) => void;
  deleteTrade: (tradeId: string) => void;
  deleteTrades: (tradeIds: string[]) => void;
  // Rebuilds position / openPositions / P&L from a mutated trade log.
  applyTradeLogMutation: (trades: Trade[]) => void;
  saveCurrentSession: () => void;
  saveRemoteSession: () => Promise<void>;
  loadRemoteSession: () => Promise<{ config: SessionConfig; data: { trades: Trade[]; position: Position | null; currentIndex: number; uiSettings?: any; openPositions?: OpenPosition[]; multiRealizedPnL?: number } } | null>;
  restoreSessionState: (trades: Trade[], position: Position | null, currentIndex: number, uiSettings?: any, multi?: { openPositions?: OpenPosition[]; multiRealizedPnL?: number }) => void;
  restoreRemoteBackup: (historyId?: string) => Promise<void>;
  saveRemoteSnapshot: (name: string) => Promise<void>;
  deleteRemoteSnapshot: (id: string) => Promise<void>;
  getRemoteSnapshots: () => Promise<SessionState[]>;
  getRemoteHistory: () => Promise<SessionState[]>;
  getCurrentCandle: () => Candle | null;
  getVisibleCandles: () => Candle[];
  getUnrealizedPnL: () => number;
  getRealizedPnL: () => number;
  toggleMarkers: (chartId?: 'primary' | 'secondary') => void;
  setTradeQuantity: (qty: number) => void;
  setRiskPerTrade: (risk: number) => void;
  setManualLevels: (levels: { sl: number; target: number; entry?: number } | null) => void;
  updatePositionTarget: (newTarget: number) => Promise<void>;
  toggleAtrForSignals: () => void;
  togglePivotRR: () => void;
  setSecondaryTimeframe: (timeframe: string | null) => void;
  toggleSecondaryChart: () => void;
  setActiveChartId: (id: 'primary' | 'secondary') => void;
  setSharedActiveTool: (tool: string) => void;
  setSharedActiveIndicators: (indicators: string[]) => void;
  toggleSharedIndicator: (indicator: string, chartId?: 'primary' | 'secondary') => void;

  // ── Actions (auto backtesting) ───────────────────────────────────────────────
  setAutoBacktestConfig: (config: AutoBacktestConfig) => void;
  runAutoBacktestCheck: (index: number) => void;
  runAutoSquareOff: (index: number) => void;
  runAutoTrailStop: (index: number) => void;
  runAutoExitCheck: (index: number) => void;
  runBatchAutoBacktest: () => void;

  // ── Actions (multi-trade mode — "Skip if open" unchecked) ────────────────────
  // Each open trade is managed on its own; `position` is only a derived mirror.
  openIndependentPosition: (signal: AutoSignal, quantity: number, index: number, journal?: TradeJournal) => void;
  closeIndependentPosition: (id: string, reason: ExitReason, fillPrice?: number) => void;
  // Per-bar lifecycle for every open trade: trail → SL/TP → signal exits → square-off.
  // `slTpOnly` mirrors what jump()/setCurrentIndex() do on the single-position path.
  runMultiPositionCycle: (index: number, opts?: { slTpOnly?: boolean }) => void;

  // ── Actions (saved auto-backtest configurations) ─────────────────────────────
  loadSavedAutoBacktestConfigsList: () => Promise<void>;
  saveAutoBacktestConfigAs: (name: string) => Promise<void>;
  updateActiveAutoBacktestConfig: () => Promise<void>;
  applySavedAutoBacktestConfig: (id: string) => void;
  deleteSavedAutoBacktestConfig: (id: string) => Promise<void>;
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  // ── Initial state ────────────────────────────────────────────────────────────
  candles: [],
  currentIndex: 0,
  trades: [],
  position: null,
  openPositions: [],
  multiRealizedPnL: 0,
  instrument: '',
  sessionConfig: null,
  isLiveMode: false,
  livePrice: null,
  isPlaying: false,
  speed: 1,
  isLoading: false,
  pendingExitRequest: null,
  pendingTradeRequest: null,
  primaryShowMarkers: true,
  secondaryShowMarkers: false,
  tradeQuantity: 65,
  riskPerTrade: 10000,
  targetRR: 2,
  autoExitTarget: true,
  manualLevels: null,
  useAtrForSignals: false,
  showPivotRR: false,
  showSecondaryChart: false,
  secondaryTimeframe: '60',
  secondaryCandles: [],
  crosshairPosition: { time: null, price: null, sourceChartId: null },
  scrollToTimestamp: null,
  highlightTimestamp: null,
  activeChartId: 'primary',
  sharedActiveTool: 'none',
  primaryIndicators: ['ema21', 'alBrooks'],
  secondaryIndicators: ['ema21', 'alBrooks'],
  drawings: [],
  secondaryDrawings: [],
  isLivePriceUpdate: false,

  // ── Auto backtesting initial state ───────────────────────────────────────────
  autoBacktestConfig: defaultAutoBacktestConfig,
  autoExitSL: false,
  lastAutoSignalReason: '',
  isBatchBacktestRunning: false,
  batchBacktestProgress: 0,

  // ── Saved auto-backtest configurations initial state ─────────────────────────
  savedAutoBacktestConfigs: [],
  activeAutoBacktestConfigId: null,
  activeAutoBacktestConfigName: null,

  // ── Actions composed from isolated modules ───────────────────────────────────
  ...createBacktestActions(set, get),
  ...createLiveActions(set, get),
  ...createSharedActions(set, get),
  ...createAutoBacktestActions(set, get),
}));
