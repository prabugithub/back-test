import { create } from 'zustand';
import type { Candle, Trade, Position, TradeJournal, Drawing } from '../types';
import { saveTradeSession } from '../utils/tradeStorage';
import { groupTradesIntoPositions, calculatePerformanceStats, recalculateTradesPnL } from '../utils/tradeAnalysis';
import { saveSession, loadSession, restoreBackup, saveSnapshot, listSnapshots, listHistory, deleteSnapshot, updateCurrentSessionDrawings, type SessionState } from '../services/firebaseSessionService';
import { useNotificationStore } from './notificationStore';
import { calculatePivotPoints } from '../utils/indicators';
import { analyzeMarketStructure } from '../utils/pivotAnalysis';
import { getLivePositions } from '../services/api';
import {
  executeLiveOrder,
  registerMonitorIfNeeded,
  syncTargetWithMonitor,
  pollOrderFillStatus,
} from '../services/liveExecutionService';

export interface SessionConfig {
  securityId: string;
  exchangeSegment: string;
  instrumentType: string;
  interval: string;
  fromDate: string;
  toDate: string;
  dataSource: 'api' | 'local';
}

interface SessionStore {
  // Data
  candles: Candle[];
  currentIndex: number;
  trades: Trade[];
  position: Position | null;
  instrument: string;
  sessionConfig: SessionConfig | null;

  // Live Mode
  isLiveMode: boolean;
  livePrice: number | null;

  // Playback state
  isPlaying: boolean;
  speed: number;
  isLoading: boolean;
  pendingExitRequest: { type: 'SL' | 'TP' | 'TIME_OVER', price: number, spotPrice: number } | null;
  pendingTradeRequest: { type: 'BUY' | 'SELL', quantity: number, stopLoss?: number, target?: number } | null;
  tradeQuantity: number;
  riskPerTrade: number;
  targetRR: number;
  autoExitTarget: boolean;
  manualLevels: { sl: number, target: number, entry?: number } | null;



  // UI settings
  primaryShowMarkers: boolean;
  secondaryShowMarkers: boolean;
  useAtrForSignals: boolean;
  showPivotRR: boolean;
  showSecondaryChart: boolean;
  secondaryTimeframe: string | null;
  secondaryCandles: Candle[];
  crosshairPosition: { time: number | null; price: number | null; sourceChartId: 'primary' | 'secondary' | null };

  // Set to true when addLiveCandle() updates the last candle price (same timestamp),
  // false when a genuinely new candle is appended. Lets AdvancedChart skip expensive
  // indicator / marker rebuilds on price-only ticks.
  isLivePriceUpdate: boolean;

  // Shared chart tool/indicator state (applies to the active/focused chart)
  activeChartId: 'primary' | 'secondary';
  sharedActiveTool: string;
  primaryIndicators: string[];
  secondaryIndicators: string[];
  drawings: Drawing[];
  secondaryDrawings: Drawing[];

  // Actions
  setDrawings: (drawings: Drawing[]) => void;
  setSecondaryDrawings: (drawings: Drawing[]) => void;
  loadCandles: (candles: Candle[], instrument: string, config?: SessionConfig) => void;
  setLiveMode: (isLive: boolean) => void;
  syncLivePositions: () => Promise<void>;
  updateLivePrice: (price: number) => void;
  addLiveCandle: (candle: Candle) => void;
  play: () => void;
  pause: () => void;
  step: (direction: 'forward' | 'backward') => void;
  jump: (count: number) => void;
  setSpeed: (speed: number) => void;
  setCurrentIndex: (index: number) => void;
  setCrosshairPosition: (pos: { time: number | null; price: number | null; sourceChartId: 'primary' | 'secondary' | null }) => void;
  executeTrade: (type: 'BUY' | 'SELL', quantity: number, stopLoss?: number, target?: number, priceOverride?: number, exitReason?: 'SL' | 'TP' | 'MANUAL' | 'TIME_OVER', journal?: TradeJournal) => void;
  initiateTrade: (type: 'BUY' | 'SELL', quantity: number, stopLoss?: number, target?: number) => void;
  resolveTradeRequest: (journal: TradeJournal | null, exitReason?: 'SL' | 'TP' | 'MANUAL' | 'TIME_OVER') => void;
  saveRemoteSession: () => Promise<void>;
  loadRemoteSession: () => Promise<{ config: SessionConfig, data: { trades: Trade[], position: Position | null, currentIndex: number, uiSettings?: any } } | null>;
  restoreSessionState: (trades: Trade[], position: Position | null, currentIndex: number, uiSettings?: any) => void;
  resetSession: () => void;
  saveCurrentSession: () => void;
  deleteTrade: (tradeId: string) => void;
  deleteTrades: (tradeIds: string[]) => void;
  resolveExitRequest: (confirm: boolean, journal?: TradeJournal) => void;
  checkSLTPHits: (index: number) => void;
  restoreRemoteBackup: (historyId?: string) => Promise<void>;
  saveRemoteSnapshot: (name: string) => Promise<void>;
  deleteRemoteSnapshot: (id: string) => Promise<void>;
  getRemoteSnapshots: () => Promise<SessionState[]>;
  getRemoteHistory: () => Promise<SessionState[]>;
  toggleMarkers: (chartId?: 'primary' | 'secondary') => void;
  setTradeQuantity: (qty: number) => void;
  setRiskPerTrade: (risk: number) => void;
  setTargetRR: (rr: number) => void;
  setAutoExitTarget: (auto: boolean) => void;
  setManualLevels: (levels: { sl: number, target: number, entry?: number } | null) => void;
  updatePositionTarget: (newTarget: number) => Promise<void>;
  checkTrendReversal: (index: number) => void;
  toggleAtrForSignals: () => void;
  togglePivotRR: () => void;
  setSecondaryTimeframe: (timeframe: string | null) => void;
  toggleSecondaryChart: () => void;
  setActiveChartId: (id: 'primary' | 'secondary') => void;
  setSharedActiveTool: (tool: string) => void;
  setSharedActiveIndicators: (indicators: string[]) => void;
  toggleSharedIndicator: (indicator: string, chartId?: 'primary' | 'secondary') => void;



  // Computed getters
  getCurrentCandle: () => Candle | null;
  getVisibleCandles: () => Candle[];
  getUnrealizedPnL: () => number;
  getRealizedPnL: () => number;
}

let syncIntervalId: ReturnType<typeof setInterval> | null = null;
// Temporarily holds the orderId of the most recently placed live order so the position
// builder can attach it for fill-status polling.
let pendingLiveOrderId: string | undefined = undefined;

const generateTradeId = () => {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

// Module-level timers for debounced drawings auto-save (avoids archiving history on every change)
let _drawingsSaveTimer: ReturnType<typeof setTimeout> | null = null;
let _secondaryDrawingsSaveTimer: ReturnType<typeof setTimeout> | null = null;

export const useSessionStore = create<SessionStore>((set, get) => ({
  // Initial state
  candles: [],
  currentIndex: 0,
  trades: [],
  position: null,
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
  activeChartId: 'primary',
  sharedActiveTool: 'none',
  primaryIndicators: ['ema21', 'pivotPoints', 'alBrooks'],
  secondaryIndicators: ['ema21', 'pivotPoints', 'alBrooks'],
  drawings: [],
  secondaryDrawings: [],
  isLivePriceUpdate: false,

  // Actions
  setDrawings: (drawings) => {
    set({ drawings });
    if (_drawingsSaveTimer) clearTimeout(_drawingsSaveTimer);
    _drawingsSaveTimer = setTimeout(() => {
      updateCurrentSessionDrawings(drawings, 'drawings').catch(() => {/* swallow — no session doc yet */});
    }, 2000);
  },
  setSecondaryDrawings: (drawings) => {
    set({ secondaryDrawings: drawings });
    if (_secondaryDrawingsSaveTimer) clearTimeout(_secondaryDrawingsSaveTimer);
    _secondaryDrawingsSaveTimer = setTimeout(() => {
      updateCurrentSessionDrawings(drawings, 'secondaryDrawings').catch(() => {/* swallow */});
    }, 2000);
  },
  loadCandles: (candles, instrument, config) => {
    // Block only when there is an active broker-backed position — loading candles
    // would wipe liveOptionToken and the open position record.
    const activePos = get().position as any;
    if (activePos?.liveOptionToken) {
      console.warn('[Safety] loadCandles blocked — active live option position open');
      useNotificationStore.getState().notify('Cannot load new data while a live option position is open. Close the position first.', 'warning');
      return;
    }
    set({
      candles,
      instrument,
      sessionConfig: config || null,
      currentIndex: candles.length > 0 ? candles.length - 1 : 0, // Default to end for better UX
      trades: [],
      position: null,
      isPlaying: false,
      manualLevels: null,
      pendingExitRequest: null,
      pendingTradeRequest: null,
    });
  },

  setTargetRR: (rr) => {
    set({ targetRR: rr });
    // Skip TP recalculation when manual levels are active — user set SL/TP explicitly via the drawing tool
    const { position, manualLevels } = get();
    if (manualLevels) return;
    // If a position is active with a valid SL, recalculate TP from the new RR
    if (position && position.stopLoss && position.stopLoss > 0 && position.averagePrice) {
      const isLong = position.quantity > 0;
      const slDist = Math.abs(position.averagePrice - position.stopLoss);
      const newTarget = isLong
        ? position.averagePrice + slDist * rr
        : position.averagePrice - slDist * rr;
      get().updatePositionTarget(newTarget);
    }
  },

  setAutoExitTarget: (auto) => set({ autoExitTarget: auto }),

  setLiveMode: (isLive) => {
    set({ isLiveMode: isLive });
    if (isLive) {
      // Move to last candle when going live
      const { candles } = get();
      if (candles.length > 0) {
        set({ currentIndex: candles.length - 1 });
      }
      get().syncLivePositions();
      
      // Always clear any existing interval before starting a new one to prevent stacking
      // when setLiveMode(true) is called more than once without an intervening false.
      if (syncIntervalId) {
        clearInterval(syncIntervalId);
      }
      syncIntervalId = setInterval(() => {
        if (get().isLiveMode) {
           get().syncLivePositions();
        }
      }, 3000);
    } else {
      if (syncIntervalId) {
        clearInterval(syncIntervalId);
        syncIntervalId = null;
      }
    }
  },

  syncLivePositions: async () => {
    try {
      const resp = await getLivePositions();
      if (resp?.success && Array.isArray(resp.data)) {
        // Find the active position.
        // We only care about active options or index positions for the current session.
        // Specifically, ignore equity/stocks and only pick FNO.
        const openFnoPositions = resp.data.filter((p: any) =>
           p.positionType !== 'CLOSED' &&
           (p.buyQty !== p.sellQty) &&
           p.exchangeSegment === 'NSE_FNO'
        );

        const currentStoreToken = get().position?.liveOptionToken;

        // Prefer exact match by securityId to avoid picking up unrelated FNO positions
        // (e.g. futures or a different option that happens to be open).
        let openPosition: any;
        if (currentStoreToken) {
          openPosition = openFnoPositions.find((p: any) =>
            String(p.securityId) === String(currentStoreToken)
          );
        } else {
          openPosition = openFnoPositions[0];
        }
        
        if (openPosition) {
          const qty = openPosition.positionType === 'LONG' 
            ? Math.abs(openPosition.buyQty - openPosition.sellQty)
            : -Math.abs(openPosition.sellQty - openPosition.buyQty);
            
          const avgPrice = openPosition.positionType === 'LONG' ? openPosition.buyAvg : openPosition.sellAvg;

          const currentStorePos = get().position;
          
          set({
            position: {
              instrument: currentStorePos?.instrument || openPosition.tradingSymbol || 'NIFTY',
              quantity: qty,
              averagePrice: avgPrice,
              realizedPnL: openPosition.realizedProfit || 0,
              unrealizedPnL: openPosition.unrealizedProfit || 0,
              liveOptionToken: openPosition.securityId,
              // Retain local stop/target if mapping from an existing tracked position
              stopLoss: currentStorePos?.stopLoss,
              target: currentStorePos?.target,
              slHit: currentStorePos?.slHit,
              tpHit: currentStorePos?.tpHit,
              slDialogShown: currentStorePos?.slDialogShown,
              tpDialogShown: currentStorePos?.tpDialogShown,
              hitFirst: currentStorePos?.hitFirst,
            }
          });
          
          if (!currentStorePos && qty !== 0) {
              useNotificationStore.getState().notify(`Synced Option Position: ${openPosition.tradingSymbol} (Qty ${qty})`, 'info');
          }
        } else {
          // If no active open option positions remotely, but we have one locally, clear it.
          if (get().position) {
            set({ position: null });
            useNotificationStore.getState().notify('No active Option positions on broker. Cleared local position.', 'info');
          }
        }
      }
    } catch (err) {
      console.warn('Failed to sync live positions', err);
    }
  },

  updateLivePrice: (price) => {
    set({ livePrice: price });
    // Check SL/TP hits for current position using live price
    const { isLiveMode, currentIndex } = get();
    if (isLiveMode) {
      get().checkSLTPHits(currentIndex);
    }
  },

  addLiveCandle: (candle) => {
    const { candles, isLiveMode } = get();
    // Replace if a candle with the same timestamp already exists (e.g. last historical == first live bucket)
    const lastCandle = candles[candles.length - 1];
    let newCandles: typeof candles;
    if (lastCandle && lastCandle.timestamp === candle.timestamp) {
      // Update the last candle in-place (merge OHLC)
      newCandles = [
        ...candles.slice(0, -1),
        {
          ...lastCandle,
          close: candle.close,
          high: Math.max(lastCandle.high, candle.high),
          low: Math.min(lastCandle.low, candle.low),
          volume: candle.volume ?? lastCandle.volume ?? 0,
        },
      ];
    } else {
      newCandles = [...candles, candle];
    }
    const isLivePriceUpdate = !!(lastCandle && lastCandle.timestamp === candle.timestamp);
    set({
      candles: newCandles,
      isLivePriceUpdate,
      ...(isLiveMode ? { currentIndex: newCandles.length - 1 } : {}),
    });
  },

  play: () => {
    if (get().isLiveMode) return; // playback is not valid in live mode
    set({ isPlaying: true });
  },

  pause: () => {
    if (get().isLiveMode) return;
    set({ isPlaying: false });
  },

  step: (direction) => {
    if (get().isLiveMode) return; // index is driven by live ticks, not manual stepping
    const { currentIndex, candles } = get();
    if (direction === 'forward' && currentIndex < candles.length - 1) {
      const nextIndex = currentIndex + 1;
      set({ currentIndex: nextIndex });
      get().checkTrendReversal(nextIndex);
      get().checkSLTPHits(nextIndex);
    } else if (direction === 'backward' && currentIndex > 0) {
      set({ currentIndex: currentIndex - 1 });
    }
  },

  checkSLTPHits: (index: number, currentPrice?: number) => {
    const { candles, position } = get();
    if (!position || (!position.stopLoss && !position.target)) return;

    // Use live price if provided, otherwise use current bar's candle data
    const candle = candles[index];
    if (!candle && !currentPrice) return;

    const { stopLoss, target, quantity } = position;
    const isLong = quantity > 0;
    const sl = Number(stopLoss);
    const tp = Number(target);

    const { high, low, close } = candle || { high: currentPrice!, low: currentPrice!, close: currentPrice! };
    const effectiveClose = currentPrice || close;
    const effectiveHigh = currentPrice ? Math.max(currentPrice, high) : high;
    const effectiveLow = currentPrice ? Math.min(currentPrice, low) : low;

    // Track current state to see if update is needed
    let nextSlHit = !!position.slHit;
    let nextTpHit = !!position.tpHit;
    let nextHitFirst = position.hitFirst;
    let nextSlDialogShown = !!position.slDialogShown;
    let nextTpDialogShown = !!position.tpDialogShown;

    // 1. Check for ANY touch (Independent Flags)
    if (isLong) {
      if (sl > 0 && effectiveLow <= sl) nextSlHit = true;
      if (tp > 0 && effectiveHigh >= tp) nextTpHit = true;
    } else {
      if (sl > 0 && effectiveHigh >= sl) nextSlHit = true;
      if (tp > 0 && effectiveLow <= tp) nextTpHit = true;
    }

    // 2. Determine first hit for notification
    if (!nextHitFirst) {
      const hitThisBar = isLong
        ? (sl > 0 && effectiveLow <= sl ? 'SL' : (tp > 0 && effectiveHigh >= tp ? 'TP' : null))
        : (sl > 0 && effectiveHigh >= sl ? 'SL' : (tp > 0 && effectiveLow <= tp ? 'TP' : null));

      if (hitThisBar) {
        nextHitFirst = hitThisBar;
        useNotificationStore.getState().notify(
          `${hitThisBar} Hit at ${(hitThisBar === 'SL' ? sl : tp).toFixed(2)} (High/Low movement)!`,
          hitThisBar === 'TP' ? 'success' : 'warning'
        );
      }
    }

    // ── LIVE OPTION GUARD ────────────────────────────────────────────────────
    // When a live option position is active the backend positionMonitor owns all
    // exits. This block updates hit-flags for display purposes only and returns
    // early so the backtest dialog/auto-exit code below can NEVER fire.
    // exitTriggeredByBackend is a secondary guard: if the backend already fired
    // an exit, skip even the hit-flag update to avoid a race.
    const { isLiveMode, autoExitTarget } = get();
    const isLiveOption = isLiveMode && (position as any).liveOptionToken;

    if (isLiveOption) {
      if ((position as any).exitTriggeredByBackend) return; // backend exit already in flight
      const hasChanged =
        nextSlHit !== position.slHit ||
        nextTpHit !== position.tpHit ||
        nextHitFirst !== position.hitFirst ||
        nextSlDialogShown !== position.slDialogShown ||
        nextTpDialogShown !== position.tpDialogShown;
      if (hasChanged) {
        set({
          position: {
            ...position,
            slHit: nextSlHit,
            tpHit: nextTpHit,
            hitFirst: nextHitFirst,
            slDialogShown: nextSlDialogShown,
            tpDialogShown: nextTpDialogShown,
          },
        });
      }
      return; // backend monitor owns the exit — never fall through to dialog/auto-exit below
    }
    // ── BACKTEST PATH ────────────────────────────────────────────────────────
    // Code below this line never runs when isLiveOption is true.

    let dialogToTrigger: 'SL' | 'TP' | null = null;
    let autoExitTP = false;

    if (isLong) {
      if (sl > 0 && effectiveClose <= sl && !nextSlDialogShown) {
        dialogToTrigger = 'SL';
        nextSlDialogShown = true;
      } else if (tp > 0 && effectiveClose >= tp && !nextTpDialogShown) {
        if (autoExitTarget) autoExitTP = true;
        else dialogToTrigger = 'TP';
        nextTpDialogShown = true;
      }
    } else {
      if (sl > 0 && effectiveClose >= sl && !nextSlDialogShown) {
        dialogToTrigger = 'SL';
        nextSlDialogShown = true;
      } else if (tp > 0 && effectiveClose <= tp && !nextTpDialogShown) {
        if (autoExitTarget) autoExitTP = true;
        else dialogToTrigger = 'TP';
        nextTpDialogShown = true;
      }
    }

    const hasChanged =
      nextSlHit !== position.slHit ||
      nextTpHit !== position.tpHit ||
      nextHitFirst !== position.hitFirst ||
      nextSlDialogShown !== position.slDialogShown ||
      nextTpDialogShown !== position.tpDialogShown;

    if (hasChanged || dialogToTrigger || autoExitTP) {
      const updatedPosition = {
        ...position,
        slHit: nextSlHit,
        tpHit: nextTpHit,
        hitFirst: nextHitFirst,
        slDialogShown: nextSlDialogShown,
        tpDialogShown: nextTpDialogShown,
      };

      if (autoExitTP) {
        set({ position: updatedPosition });
        useNotificationStore.getState().notify(
          `Target Hit at ${tp.toFixed(2)}. Auto Exiting based on Risk settings.`,
          'success'
        );
        get().executeTrade(
          isLong ? 'SELL' : 'BUY',
          Math.abs(position.quantity),
          undefined, undefined, undefined, 'TP'
        );
      } else if (dialogToTrigger) {
        set({
          isPlaying: false,
          pendingExitRequest: { type: dialogToTrigger, price: dialogToTrigger === 'SL' ? sl : tp, spotPrice: close },
          position: updatedPosition,
        });
      } else {
        set({ position: updatedPosition });
      }
    }
  },

  setSpeed: (speed) => set({ speed }),

  setCrosshairPosition: (pos) => set({ crosshairPosition: pos }),

  setCurrentIndex: (index) => {
    const { candles } = get();
    if (index >= 0 && index < candles.length) {
      set({ currentIndex: index });
      get().checkSLTPHits(index);
    }
  },

  resolveExitRequest: (confirm, journal) => {
    const { pendingExitRequest, position, executeTrade } = get();
    if (!pendingExitRequest || !position) return;

    if (confirm) {
      // Execute exit trade
      const exitType = position.quantity > 0 ? 'SELL' : 'BUY';
      executeTrade(
        exitType,
        Math.abs(position.quantity),
        undefined,
        undefined,
        undefined,
        pendingExitRequest.type,
        journal
      );
      set({ pendingExitRequest: null });
    } else {
      // If user cancels, mark as hit so we don't immediately prompt again for the same level
      set({
        position: {
          ...position,
          slDialogShown: pendingExitRequest.type === 'SL' ? true : position.slDialogShown,
          tpDialogShown: pendingExitRequest.type === 'TP' ? true : position.tpDialogShown,
        },
        pendingExitRequest: null
      });
    }
  },

  initiateTrade: (type, quantity, stopLoss, target) => {
    set({
      isPlaying: false,
      pendingTradeRequest: { type, quantity, stopLoss, target }
    });
  },

  resolveTradeRequest: (journal, exitReason = 'MANUAL') => {
    const { pendingTradeRequest, executeTrade } = get();
    if (!pendingTradeRequest) return;

    if (journal) {
      executeTrade(
        pendingTradeRequest.type,
        pendingTradeRequest.quantity,
        pendingTradeRequest.stopLoss,
        pendingTradeRequest.target,
        undefined,
        exitReason,
        journal
      );
    }

    set({ pendingTradeRequest: null });
  },

  executeTrade: async (type, quantity, stopLoss, target, priceOverride, exitReason = 'MANUAL', journal) => {
    const { candles, currentIndex, trades, position, instrument, sessionConfig, isLiveMode, livePrice } = get();
    const currentCandle = candles[currentIndex];

    if (!currentCandle) {
      console.error('No current candle available');
      return;
    }

    const currentPrice = priceOverride || (isLiveMode && livePrice) || currentCandle.close;
    const timestamp = currentCandle.timestamp;

    const tradeSign = type === 'BUY' ? 1 : -1;
    const currentQty = position ? position.quantity : 0;
    const isReducing = (currentQty > 0 && tradeSign < 0) || (currentQty < 0 && tradeSign > 0);
    const isSameDirection = (currentQty > 0 && tradeSign > 0) || (currentQty < 0 && tradeSign < 0);

    let finalQuantity = quantity;
    let atmOptionToken: string | undefined = undefined;
    let tradeOptionType: 'CE' | 'PE' | undefined = undefined;

    // ── LIVE PATH ────────────────────────────────────────────────────────────
    // All broker API calls are delegated to liveExecutionService — no live
    // code exists below this block.
    if (isLiveMode && sessionConfig) {
      try {
        const notify = (msg: string, t: any) => useNotificationStore.getState().notify(msg, t);
        const result = await executeLiveOrder(
          { type, quantity, exitReason, currentPrice, instrument, sessionConfig, position },
          notify
        );
        if (result === null) return; // blocked by guard or order failed
        finalQuantity = result.finalQuantity;
        atmOptionToken = result.atmOptionToken;
        tradeOptionType = result.tradeOptionType;
        if (result.pendingOrderId) pendingLiveOrderId = result.pendingOrderId;
      } catch (error: any) {
        useNotificationStore.getState().notify(`Error placing live option order: ${error.message}`, 'error');
        return;
      }
    }
    // ── BACKTEST PATH (and shared position-building logic) ───────────────────

    const tradeQtySigned = finalQuantity * tradeSign;
    const newQty = currentQty + tradeQtySigned;

    const isSameSide = (currentQty > 0 && newQty > 0) || (currentQty < 0 && newQty < 0);
    const isFlip = isReducing && !isSameSide && newQty !== 0;

    // Determine if initial entry/flip is with trend
    const visibleCandlesForEntry = candles.slice(0, currentIndex + 1);
    const pivotsForEntry = calculatePivotPoints(visibleCandlesForEntry);
    const { ltMarket } = analyzeMarketStructure(visibleCandlesForEntry, pivotsForEntry);
    const isInitialWith = (type === 'BUY' && ltMarket.startsWith('Bull')) || (type === 'SELL' && ltMarket.startsWith('Bear'));

    // Inherit SL/Target from position if not provided, but only if we stay on the same side.
    // If reducing, we prioritize the existing position's levels over any newly calculated ones 
    // (which might be for the wrong direction, e.g. a SELL target for a LONG position).
    let tradeStopLoss = stopLoss;
    let tradeTarget = target;

    // Determine if SL/Target are "wrong-way" for the new quantity
    const isL = newQty > 0;
    const isS = newQty < 0;
    const isTargetWrong = target !== undefined && ((isL && target < currentPrice) || (isS && target > currentPrice));
    const isSLWrong = stopLoss !== undefined && ((isL && stopLoss > currentPrice) || (isS && stopLoss < currentPrice));

    if (isSameSide) {
      if (isReducing) {
        // Priority for reduction: Explicit > Old Position (Ignore new levels if they are wrong-way)
        tradeTarget = (target === undefined || isTargetWrong) ? position?.target : target;
        tradeStopLoss = (stopLoss === undefined || isSLWrong) ? position?.stopLoss : stopLoss;
      } else if (isSameDirection) {
        // Priority for add-on: Explicit > Old Position (ALSO check for wrong-way levels)
        tradeTarget = (target === undefined || isTargetWrong) ? position?.target : target;
        tradeStopLoss = (stopLoss === undefined || isSLWrong) ? position?.stopLoss : stopLoss;
      }
    } else if (newQty !== 0) {
      // Flip or Fresh Entry: Use passed levels if they are valid, otherwise empty (don't inherit from previous side)
      tradeTarget = isTargetWrong ? undefined : target;
      tradeStopLoss = isSLWrong ? undefined : stopLoss;
    }

    // Create trade
    const trade: Trade = {
      id: generateTradeId(),
      timestamp,
      type,
      price: currentPrice,
      quantity: finalQuantity,
      instrument,
      liveOptionToken: atmOptionToken || position?.liveOptionToken,
      optionType: tradeOptionType,
      stopLoss: tradeStopLoss,
      target: tradeTarget,
      exitReason: exitReason,
      slHit: position?.slHit || exitReason === 'SL',
      tpHit: position?.tpHit || exitReason === 'TP',
      slDialogShown: position?.slDialogShown || exitReason === 'SL',
      tpDialogShown: position?.tpDialogShown || exitReason === 'TP',
      hitFirst: position?.hitFirst || (exitReason === 'SL' || exitReason === 'TP' ? exitReason : undefined),
      trendReversed: position?.trendReversed,
      trendReversedPnL: position?.trendReversedPnL,
      withTrendSeen: isSameSide ? (position?.withTrendSeen || isInitialWith) : isInitialWith,
      journal: journal || undefined,
      interval: sessionConfig?.interval || '5', // Default to 5 if not set
    };

    const currentAvgPrice = position ? position.averagePrice : 0;

    let newAvgPrice = currentAvgPrice;
    let newRealizedPnL = position ? position.realizedPnL : 0;
    let tradePnL = undefined;

    if (currentQty === 0) {
      newAvgPrice = currentPrice;
    } else if (isSameDirection) {
      const totalValue = (Math.abs(currentQty) * currentAvgPrice) + (finalQuantity * currentPrice);
      const totalShares = Math.abs(currentQty) + finalQuantity;
      newAvgPrice = totalValue / totalShares;
    } else {
      const qtyClosing = Math.min(Math.abs(currentQty), finalQuantity);
      const pnlPerShare = currentQty > 0 ? (currentPrice - currentAvgPrice) : (currentAvgPrice - currentPrice);
      const realizedParams = pnlPerShare * qtyClosing;

      tradePnL = realizedParams;
      newRealizedPnL += realizedParams;

      const qtyRemaining = finalQuantity - qtyClosing;
      if (qtyRemaining > 0) {
        newAvgPrice = currentPrice;
      }
    }

    trade.pnl = tradePnL;

    const newPositionState: Position = {
      instrument,
      quantity: newQty,
      averagePrice: newAvgPrice,
      realizedPnL: newRealizedPnL,
      unrealizedPnL: 0,
      stopLoss: trade.stopLoss,
      target: trade.target,
      slHit: (isFlip || trade.stopLoss !== position?.stopLoss) ? (exitReason === 'SL' ? true : undefined) : (position?.slHit || exitReason === 'SL'),
      tpHit: (isFlip || trade.target !== position?.target) ? (exitReason === 'TP' ? true : undefined) : (position?.tpHit || exitReason === 'TP'),
      slDialogShown: (isFlip || trade.stopLoss !== position?.stopLoss) ? (exitReason === 'SL' ? true : undefined) : (position?.slDialogShown || exitReason === 'SL'),
      tpDialogShown: (isFlip || trade.target !== position?.target) ? (exitReason === 'TP' ? true : undefined) : (position?.tpDialogShown || exitReason === 'TP'),
      hitFirst: (isFlip || trade.stopLoss !== position?.stopLoss || trade.target !== position?.target) ? (exitReason === 'SL' || exitReason === 'TP' ? exitReason : undefined) : (position?.hitFirst || (exitReason === 'SL' || exitReason === 'TP' ? exitReason : undefined)),
      trendReversed: isFlip ? undefined : position?.trendReversed,
      trendReversedPnL: isFlip ? undefined : position?.trendReversedPnL,
      withTrendSeen: trade.withTrendSeen,
      liveOptionToken: atmOptionToken || position?.liveOptionToken,
      // Attach the most recently placed order ID so PositionOverlay can show fill status.
      // pendingLiveOrderId is cleared below once we hand it off.
      pendingOrderId: pendingLiveOrderId,
    };

    // Reset module-level holder now that it's attached to the position object.
    pendingLiveOrderId = undefined;

    const nextPosition = newQty !== 0 ? newPositionState : null;

    set({
      trades: [...trades, trade],
      position: nextPosition,
      manualLevels: null,
    });

    // ── LIVE: register backend position monitor ──────────────────────────────
    if (get().isLiveMode) {
      const sessionCfg = get().sessionConfig;
      if (nextPosition && sessionCfg) {
        registerMonitorIfNeeded(nextPosition, sessionCfg);
      }
      // Unregister was already called pre-order for live option closes (in liveExecutionService).
    }

    // ── LIVE: poll Dhan for fill status ~2 s after placement ─────────────────
    if (newPositionState.pendingOrderId && get().isLiveMode) {
      const orderIdToCheck = newPositionState.pendingOrderId;
      const notify = (msg: string, t: any) => useNotificationStore.getState().notify(msg, t);
      pollOrderFillStatus(orderIdToCheck, {
        getPosition: () => get().position,
        isLiveMode: () => get().isLiveMode,
        onRejected: () => {
          set((s) => ({
            position: s.position?.pendingOrderId === orderIdToCheck ? null : s.position,
          }));
        },
        onPartialFill: (filled) => {
          set((s) => {
            if (!s.position || s.position.pendingOrderId !== orderIdToCheck) return s;
            return { position: { ...s.position, filledQty: filled, pendingOrderId: undefined } };
          });
        },
        onFilled: (filled) => {
          set((s) => {
            if (!s.position || s.position.pendingOrderId !== orderIdToCheck) return s;
            return { position: { ...s.position, filledQty: filled, pendingOrderId: undefined } };
          });
        },
        notify,
      });
    }
  },

  resetSession: () => {
    // Block in live mode — resetting would clear an active live position and trades
    if (get().isLiveMode) {
      console.warn('[Safety] resetSession blocked while in live mode');
      useNotificationStore.getState().notify('Cannot reset session while in live mode. Disable live mode first.', 'warning');
      return;
    }
    set({
      currentIndex: 0,
      trades: [],
      position: null,
      isPlaying: false,
      manualLevels: null,
      pendingExitRequest: null,
      pendingTradeRequest: null,
    });
  },

  deleteTrade: (tradeId: string) => {
    const { trades, instrument } = get();
    const newTrades = trades.filter(t => t.id !== tradeId);

    if (newTrades.length === 0) {
      set({ trades: [], position: null });
      return;
    }

    const { processedTrades, finalQty, finalAvgPrice, totalRealizedPnL } = recalculateTradesPnL(newTrades);

    set({
      trades: processedTrades,
      position: finalQty !== 0 ? {
        instrument,
        quantity: finalQty,
        averagePrice: finalAvgPrice,
        realizedPnL: totalRealizedPnL,
        unrealizedPnL: 0,
        stopLoss: undefined,
        target: undefined,
        slHit: false,
        tpHit: false
      } : null
    });
  },

  deleteTrades: (tradeIds: string[]) => {
    const { trades, instrument } = get();
    const newTrades = trades.filter(t => !tradeIds.includes(t.id));

    if (newTrades.length === 0) {
      set({ trades: [], position: null });
      return;
    }

    const { processedTrades, finalQty, finalAvgPrice, totalRealizedPnL } = recalculateTradesPnL(newTrades);

    set({
      trades: processedTrades,
      position: finalQty !== 0 ? {
        instrument,
        quantity: finalQty,
        averagePrice: finalAvgPrice,
        realizedPnL: totalRealizedPnL,
        unrealizedPnL: 0,
        stopLoss: undefined,
        target: undefined,
        slHit: false,
        tpHit: false
      } : null
    });
  },

  saveCurrentSession: () => {
    const { instrument, trades } = get();
    if (trades.length === 0) return;

    const positions = groupTradesIntoPositions(trades);
    const stats = calculatePerformanceStats(positions);

    saveTradeSession(
      instrument,
      trades,
      {
        totalPnL: stats.totalPnL,
        winRate: stats.winRate
      }
    );
  },

  saveRemoteSession: async () => {
    const {
      instrument, trades, position, currentIndex, sessionConfig,
      drawings, secondaryDrawings, primaryIndicators, secondaryIndicators, secondaryTimeframe,
      showSecondaryChart, tradeQuantity, riskPerTrade, targetRR,
      autoExitTarget, useAtrForSignals, showPivotRR
    } = get();

    if (!sessionConfig) {
      console.warn("Cannot save session: Missing session configuration");
      useNotificationStore.getState().notify(
        'Cannot save: Missing session configuration. Please reload data.',
        'error'
      );
      return;
    }

    const sanitizedTrades = trades.map(t => {
      const cleanT: any = { ...t };
      if (cleanT.pnl === undefined) {
        cleanT.pnl = null;
      }
      return cleanT as Trade;
    });

    const state: SessionState = {
      name: `Session - ${instrument}`,
      lastUpdated: Date.now(),
      instrument,
      interval: sessionConfig.interval,
      fromDate: sessionConfig.fromDate,
      toDate: sessionConfig.toDate,
      currentIndex,
      trades: sanitizedTrades,
      position,
      uiSettings: {
        drawings,
        secondaryDrawings,
        primaryIndicators,
        secondaryIndicators,
        secondaryTimeframe,
        showSecondaryChart,
        tradeQuantity,
        riskPerTrade,
        targetRR,
        autoExitTarget,
        useAtrForSignals,
        showPivotRR
      }
    };

    const fullState = {
      ...state,
      securityId: sessionConfig.securityId,
      exchangeSegment: sessionConfig.exchangeSegment,
      dataSource: sessionConfig.dataSource,
      instrumentType: sessionConfig.instrumentType || 'EQUITY'
    };

    set({ isLoading: true });
    try {
      await saveSession(fullState as any);
      useNotificationStore.getState().notify('Session saved to cloud successfully!', 'success');
    } catch (e: any) {
      console.error(e);
      useNotificationStore.getState().notify(`Failed to save session: ${e.message}`, 'error');
    } finally {
      set({ isLoading: false });
    }
  },

  loadRemoteSession: async () => {
    set({ isLoading: true });
    try {
      const state = await loadSession();
      if (!state) return null;

      const config: SessionConfig = {
        securityId: (state as any).securityId,
        exchangeSegment: (state as any).exchangeSegment || 'NSE_EQ',
        instrumentType: (state as any).instrumentType || 'EQUITY',
        interval: state.interval,
        fromDate: state.fromDate,
        toDate: state.toDate,
        dataSource: (state as any).dataSource || 'local'
      };

      const data = {
        trades: state.trades,
        position: state.position,
        currentIndex: state.currentIndex,
        uiSettings: state.uiSettings
      };

      return { config, data };
    } catch (error) {
      console.error(error);
      return null;
    } finally {
      set({ isLoading: false });
    }
  },

  restoreSessionState: (trades, position, currentIndex, uiSettings) => {
    // Merge everything into a single set() so React only schedules one re-render.
    // This ensures the chart's useEffect sees the restored indicators AND drawings
    // in the same render cycle that it sees the new candle data.
    set((state) => ({
      ...state,
      trades,
      position,
      currentIndex,
      ...(uiSettings || {})
    }));
  },

  restoreRemoteBackup: async (historyId?: string) => {
    set({ isLoading: true });
    try {
      const state = await restoreBackup(historyId);
      if (state) {
        set({
          trades: state.trades,
          position: state.position,
          currentIndex: state.currentIndex
        });
        if (state.uiSettings) {
          set((s) => ({ ...s, ...state.uiSettings }));
        }
        useNotificationStore.getState().notify('Session version restored successfully!', 'success');
      }
    } catch (e: any) {
      console.error(e);
      useNotificationStore.getState().notify(`Failed to restore backup: ${e.message}`, 'error');
    } finally {
      set({ isLoading: false });
    }
  },

  getRemoteHistory: async () => {
    try {
      return await listHistory();
    } catch (error) {
      console.error(error);
      return [];
    }
  },

  saveRemoteSnapshot: async (name: string) => {
    const {
      instrument, trades, position, currentIndex, sessionConfig,
      drawings, secondaryDrawings, primaryIndicators, secondaryIndicators, secondaryTimeframe,
      showSecondaryChart, tradeQuantity, riskPerTrade, targetRR,
      autoExitTarget, useAtrForSignals, showPivotRR
    } = get();

    if (!sessionConfig) {
      useNotificationStore.getState().notify('Cannot save snapshot: Missing configuration', 'error');
      return;
    }

    const state: SessionState = {
      name: name,
      lastUpdated: Date.now(),
      instrument,
      interval: sessionConfig.interval,
      fromDate: sessionConfig.fromDate,
      toDate: sessionConfig.toDate,
      currentIndex,
      trades,
      position,
      uiSettings: {
        drawings,
        secondaryDrawings,
        primaryIndicators,
        secondaryIndicators,
        secondaryTimeframe,
        showSecondaryChart,
        tradeQuantity,
        riskPerTrade,
        targetRR,
        autoExitTarget,
        useAtrForSignals,
        showPivotRR
      }
    };

    set({ isLoading: true });
    try {
      await saveSnapshot(state, name);
      useNotificationStore.getState().notify(`Snapshot "${name}" saved!`, 'success');
    } catch (e: any) {
      console.error(e);
      useNotificationStore.getState().notify(`Failed to save snapshot: ${e.message}`, 'error');
    } finally {
      set({ isLoading: false });
    }
  },

  deleteRemoteSnapshot: async (id: string) => {
    set({ isLoading: true });
    try {
      await deleteSnapshot(id);
      useNotificationStore.getState().notify('Snapshot deleted successfully', 'success');
    } catch (e: any) {
      console.error(e);
      useNotificationStore.getState().notify(`Failed to delete snapshot: ${e.message}`, 'error');
    } finally {
      set({ isLoading: false });
    }
  },

  getRemoteSnapshots: async () => {
    try {
      return await listSnapshots();
    } catch (error) {
      console.error(error);
      return [];
    }
  },

  getCurrentCandle: () => {
    const { candles, currentIndex } = get();
    return candles[currentIndex] || null;
  },

  getVisibleCandles: () => {
    const { candles, currentIndex } = get();
    return candles.slice(0, currentIndex + 1);
  },

  getUnrealizedPnL: () => {
    const { position, candles, currentIndex, isLiveMode } = get();
    if (!position || position.quantity === 0) {
      return 0;
    }

    if (isLiveMode) {
      // In live mode the frontend only receives spot/index ticks — never the option's own LTP.
      // Computing (spotPrice - optionAvgEntry) * qty gives a wildly wrong P&L.
      // Always use the broker-synced unrealizedPnL (refreshed every 3 s by syncLivePositions).
      return position.unrealizedPnL || 0;
    }

    const currentCandle = candles[currentIndex];
    if (!currentCandle) {
      return 0;
    }

    // Historical replay mode
    return (currentCandle.close - position.averagePrice) * position.quantity;
  },

  jump: (count) => {
    if (get().isLiveMode) return; // index is driven by live ticks, not manual jumps
    const { currentIndex, candles } = get();
    const newIndex = currentIndex + count;
    if (newIndex >= 0 && newIndex < candles.length) {
      set({ currentIndex: newIndex });
      get().checkTrendReversal(newIndex);
      get().checkSLTPHits(newIndex);
    } else if (newIndex < 0) {
      set({ currentIndex: 0 });
    } else {
      set({ currentIndex: candles.length - 1 });
    }
  },

  checkTrendReversal: (index: number, currentPrice?: number) => {
    const { candles, position, trades } = get();
    if (!position || position.quantity === 0 || position.trendReversed) return;

    const visibleCandles = candles.slice(0, index + 1);
    const pivots = calculatePivotPoints(visibleCandles);
    const { ltMarket } = analyzeMarketStructure(visibleCandles, pivots);

    const direction = position.quantity > 0 ? "LONG" : "SHORT";

    // ... (rest of the logic remains mostly the same, but use currentPrice if index is last bar)
    const isAgainst = (direction === 'LONG' && ltMarket.startsWith('Bear')) ||
      (direction === 'SHORT' && ltMarket.startsWith('Bull'));

    const isWith = (direction === 'LONG' && ltMarket.startsWith('Bull')) ||
      (direction === 'SHORT' && ltMarket.startsWith('Bear'));

    // 1. If we are now aligned with the trend, mark the position as having seen alignment
    if (isWith && !position.withTrendSeen) {
      set({
        position: { ...position, withTrendSeen: true }
      });
      return;
    }

    // 2. If we are against the trend, only trigger notification if we were previously aligned
    if (isAgainst && position.withTrendSeen) {
      const currentCandle = candles[index];
      const testPrice = currentPrice || (currentCandle ? currentCandle.close : 0);
      const unrealizedPnL = (testPrice - position.averagePrice) * position.quantity;

      const updatedPosition = {
        ...position,
        trendReversed: true,
        trendReversedPnL: unrealizedPnL
      };

      // Patch existing trades immediately so history/CSV reflects it
      const updatedTrades = trades.map(t => {
        const isEntry = (direction === 'LONG' && t.type === 'BUY') || (direction === 'SHORT' && t.type === 'SELL');
        if (isEntry && !t.trendReversed) {
          return { ...t, trendReversed: true, trendReversedPnL: unrealizedPnL };
        }
        return t;
      });

      set({
        position: updatedPosition,
        trades: updatedTrades
      });

      useNotificationStore.getState().notify(
        `Trend Reversal Detected! P&L at reversal: ${unrealizedPnL.toFixed(2)}`,
        'warning'
      );
    }
  },

  getRealizedPnL: () => {
    const { position } = get();
    return position?.realizedPnL || 0;
  },

  toggleMarkers: (chartId) => {
    const id = chartId || get().activeChartId;
    if (id === 'primary') {
      set((state) => ({ primaryShowMarkers: !state.primaryShowMarkers }));
    } else {
      set((state) => ({ secondaryShowMarkers: !state.secondaryShowMarkers }));
    }
  },
  setTradeQuantity: (tradeQuantity) => set({ tradeQuantity }),
  setRiskPerTrade: (riskPerTrade) => set({ riskPerTrade }),
  setManualLevels: (manualLevels) => set({ manualLevels }),

  updatePositionTarget: async (newTarget: number) => {
    const { position, isLiveMode } = get();
    if (!position) return;
    const isLong = position.quantity > 0;
    if (isLong && newTarget <= position.averagePrice) {
      useNotificationStore.getState().notify('Target must be above entry price for a LONG position', 'warning');
      return;
    }
    if (!isLong && newTarget >= position.averagePrice) {
      useNotificationStore.getState().notify('Target must be below entry price for a SHORT position', 'warning');
      return;
    }
    // Update frontend state — reset tpHit/tpDialogShown so the new level can trigger
    set({ position: { ...position, target: newTarget, tpHit: false, tpDialogShown: false } });
    // Sync to backend monitor if live
    if (isLiveMode && position.liveOptionToken) {
      await syncTargetWithMonitor(position.liveOptionToken, newTarget);
    }
    useNotificationStore.getState().notify(`Target updated to ${newTarget.toFixed(2)}`, 'success');
  },

  toggleAtrForSignals: () => set((state) => ({ useAtrForSignals: !state.useAtrForSignals })),
  togglePivotRR: () => set((state) => ({ showPivotRR: !state.showPivotRR })),

  setSecondaryTimeframe: (timeframe) => {
    const { candles } = get();
    if (!timeframe || candles.length === 0) {
      set({ secondaryTimeframe: timeframe, secondaryCandles: [] });
      return;
    }
    set({ secondaryTimeframe: timeframe });
  },

  toggleSecondaryChart: () => set((state) => ({ showSecondaryChart: !state.showSecondaryChart })),

  setActiveChartId: (activeChartId) => set({ activeChartId }),
  setSharedActiveTool: (sharedActiveTool) => set({ sharedActiveTool }),
  setSharedActiveIndicators: (indicators) => {
    const { activeChartId } = get();
    if (activeChartId === 'primary') set({ primaryIndicators: indicators });
    else set({ secondaryIndicators: indicators });
  },
  toggleSharedIndicator: (indicator, chartId) => {
    const id = chartId || get().activeChartId;
    if (id === 'primary') {
      set((state) => ({
        primaryIndicators: state.primaryIndicators.includes(indicator)
          ? state.primaryIndicators.filter((i) => i !== indicator)
          : [...state.primaryIndicators, indicator],
      }));
    } else {
      set((state) => ({
        secondaryIndicators: state.secondaryIndicators.includes(indicator)
          ? state.secondaryIndicators.filter((i) => i !== indicator)
          : [...state.secondaryIndicators, indicator],
      }));
    }
  },
}));

