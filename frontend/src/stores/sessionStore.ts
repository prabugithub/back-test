import { create } from 'zustand';
import type { Candle, Trade, Position, TradeJournal } from '../types';
import { saveTradeSession } from '../utils/tradeStorage';
import { groupTradesIntoPositions, calculatePerformanceStats, recalculateTradesPnL } from '../utils/tradeAnalysis';
import { saveSession, loadSession, restoreBackup, saveSnapshot, listSnapshots, listHistory, deleteSnapshot, type SessionState } from '../services/firebaseSessionService';
import { useNotificationStore } from './notificationStore';
import { calculatePivotPoints } from '../utils/indicators';
import { analyzeMarketStructure } from '../utils/pivotAnalysis';
import { placeLiveOrder } from '../services/api';

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
  manualLevels: { sl: number, target: number } | null;



  // UI settings
  primaryShowMarkers: boolean;
  secondaryShowMarkers: boolean;
  useAtrForSignals: boolean;
  showPivotRR: boolean;
  showSecondaryChart: boolean;
  secondaryTimeframe: string | null;
  secondaryCandles: Candle[];
  crosshairPosition: { time: number | null; price: number | null; sourceChartId: 'primary' | 'secondary' | null };

  // Shared chart tool/indicator state (applies to the active/focused chart)
  activeChartId: 'primary' | 'secondary';
  sharedActiveTool: string;
  primaryIndicators: string[];
  secondaryIndicators: string[];

  // Actions
  loadCandles: (candles: Candle[], instrument: string, config?: SessionConfig) => void;
  setLiveMode: (isLive: boolean) => void;
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
  loadRemoteSession: () => Promise<{ config: SessionConfig, data: { trades: Trade[], position: Position | null, currentIndex: number } } | null>;
  restoreSessionState: (trades: Trade[], position: Position | null, currentIndex: number) => void;
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
  setManualLevels: (levels: { sl: number, target: number } | null) => void;
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

const generateTradeId = () => {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

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



  // Actions
  loadCandles: (candles, instrument, config) => {
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

  setLiveMode: (isLive) => {
    set({ isLiveMode: isLive });
    if (isLive) {
      // Move to last candle when going live
      const { candles } = get();
      if (candles.length > 0) {
        set({ currentIndex: candles.length - 1 });
      }
    }
  },

  updateLivePrice: (price) => {
    set({ livePrice: price });
    // Check SL/TP hits for current position using live price
    const { isLiveMode, currentIndex } = get();
    if (isLiveMode) {
      get().checkSLTPHits(currentIndex, price);
    }
  },

  addLiveCandle: (candle) => {
    const { candles, isLiveMode } = get();
    const newCandles = [...candles, candle];
    set({ candles: newCandles });
    if (isLiveMode) {
      set({ currentIndex: newCandles.length - 1 });
    }
  },

  play: () => set({ isPlaying: true }),

  pause: () => set({ isPlaying: false }),

  step: (direction) => {
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

    // 3. Check for Close-based Trigger (Dialog)
    let dialogToTrigger: 'SL' | 'TP' | null = null;
    if (isLong) {
      if (sl > 0 && effectiveClose <= sl && !nextSlDialogShown) {
        dialogToTrigger = 'SL';
        nextSlDialogShown = true;
      } else if (tp > 0 && effectiveClose >= tp && !nextTpDialogShown) {
        dialogToTrigger = 'TP';
        nextTpDialogShown = true;
      }
    } else {
      if (sl > 0 && effectiveClose >= sl && !nextSlDialogShown) {
        dialogToTrigger = 'SL';
        nextSlDialogShown = true;
      } else if (tp > 0 && effectiveClose <= tp && !nextTpDialogShown) {
        dialogToTrigger = 'TP';
        nextTpDialogShown = true;
      }
    }

    // Sync state if any change occurred
    const hasChanged =
      nextSlHit !== position.slHit ||
      nextTpHit !== position.tpHit ||
      nextHitFirst !== position.hitFirst ||
      nextSlDialogShown !== position.slDialogShown ||
      nextTpDialogShown !== position.tpDialogShown;

    if (hasChanged || dialogToTrigger) {
      const updatedPosition = {
        ...position,
        slHit: nextSlHit,
        tpHit: nextTpHit,
        hitFirst: nextHitFirst,
        slDialogShown: nextSlDialogShown,
        tpDialogShown: nextTpDialogShown,
      };

      if (dialogToTrigger) {
        set({
          isPlaying: false,
          pendingExitRequest: { type: dialogToTrigger, price: dialogToTrigger === 'SL' ? sl : tp, spotPrice: close },
          position: updatedPosition
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
    const { candles, currentIndex, trades, position, instrument, sessionConfig, isLiveMode } = get();
    const currentCandle = candles[currentIndex];

    // Handle Live Order Placement
    if (isLiveMode && sessionConfig) {
      try {
        const orderResult = await placeLiveOrder({
          securityId: sessionConfig.securityId,
          exchangeSegment: sessionConfig.exchangeSegment,
          transactionType: type,
          quantity: quantity,
          productType: 'INTRADAY' // Defaulting to intraday for now
        });

        if (orderResult.success) {
           useNotificationStore.getState().notify(`Live Order Placed: ${type} ${quantity} (ID: ${orderResult.data?.orderId || 'N/A'})`, 'info');
        } else {
           useNotificationStore.getState().notify(`Live Order Failed: ${orderResult.message || 'Unknown error'}`, 'error');
           return; // Stop local execution if live order failed? 
           // User might want to keep local in sync, but if order failed, local shouldn't proceed.
        }
      } catch (error: any) {
        useNotificationStore.getState().notify(`Error placing live order: ${error.message}`, 'error');
        return;
      }
    }

    if (!currentCandle) {
      console.error('No current candle available');
      return;
    }

    const currentPrice = priceOverride || currentCandle.close;
    const timestamp = currentCandle.timestamp;

    const tradeSign = type === 'BUY' ? 1 : -1;
    const currentQty = position ? position.quantity : 0;
    const tradeQtySigned = quantity * tradeSign;
    const newQty = currentQty + tradeQtySigned;

    const isSameDirection = (currentQty > 0 && tradeSign > 0) || (currentQty < 0 && tradeSign < 0);
    const isReducing = (currentQty > 0 && tradeSign < 0) || (currentQty < 0 && tradeSign > 0);
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
      quantity,
      instrument,
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
      const totalValue = (Math.abs(currentQty) * currentAvgPrice) + (quantity * currentPrice);
      const totalShares = Math.abs(currentQty) + quantity;
      newAvgPrice = totalValue / totalShares;
    } else {
      const qtyClosing = Math.min(Math.abs(currentQty), quantity);
      const pnlPerShare = currentQty > 0 ? (currentPrice - currentAvgPrice) : (currentAvgPrice - currentPrice);
      const realizedParams = pnlPerShare * qtyClosing;

      tradePnL = realizedParams;
      newRealizedPnL += realizedParams;

      const qtyRemaining = quantity - qtyClosing;
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
    };

    set({
      trades: [...trades, trade],
      position: newQty !== 0 ? newPositionState : null,
      manualLevels: null, // Clear manual levels after executing a trade
    });
  },

  resetSession: () => {
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
    const { instrument, trades, position, currentIndex, sessionConfig } = get();

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
        currentIndex: state.currentIndex
      };

      return { config, data };
    } catch (error) {
      console.error(error);
      return null;
    } finally {
      set({ isLoading: false });
    }
  },

  restoreSessionState: (trades, position, currentIndex) => {
    set({
      trades,
      position,
      currentIndex
    });
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
    const { instrument, trades, position, currentIndex, sessionConfig } = get();

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
    const { position, candles, currentIndex, isLiveMode, livePrice } = get();
    if (!position || position.quantity === 0) {
      return 0;
    }

    if (isLiveMode && livePrice !== null) {
      return (livePrice - position.averagePrice) * position.quantity;
    }

    const currentCandle = candles[currentIndex];
    if (!currentCandle) {
      return 0;
    }

    return (currentCandle.close - position.averagePrice) * position.quantity;
  },

  jump: (count) => {
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
