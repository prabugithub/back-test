import { create } from 'zustand';
import type { Candle, Trade, Position, TradeJournal } from '../types';
import { saveTradeSession } from '../utils/tradeStorage';
import { groupTradesIntoPositions, calculatePerformanceStats, recalculateTradesPnL } from '../utils/tradeAnalysis';
import { saveSession, loadSession, restoreBackup, saveSnapshot, listSnapshots, listHistory, deleteSnapshot, type SessionState } from '../services/firebaseSessionService';
import { useNotificationStore } from './notificationStore';
import { calculatePivotPoints } from '../utils/indicators';
import { analyzeMarketStructure } from '../utils/pivotAnalysis';

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
  showMarkers: boolean;
  useAtrForSignals: boolean;

  // Actions
  loadCandles: (candles: Candle[], instrument: string, config?: SessionConfig) => void;
  play: () => void;
  pause: () => void;
  step: (direction: 'forward' | 'backward') => void;
  jump: (count: number) => void;
  setSpeed: (speed: number) => void;
  setCurrentIndex: (index: number) => void;
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
  toggleMarkers: () => void;
  setTradeQuantity: (qty: number) => void;
  setRiskPerTrade: (risk: number) => void;
  setManualLevels: (levels: { sl: number, target: number } | null) => void;
  checkTrendReversal: (index: number) => void;
  toggleAtrForSignals: () => void;



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
  isPlaying: false,
  speed: 1,
  isLoading: false,
  pendingExitRequest: null,
  pendingTradeRequest: null,
  showMarkers: true,
  tradeQuantity: 65,
  riskPerTrade: 10000,
  manualLevels: null,
  useAtrForSignals: true,



  // Actions
  loadCandles: (candles, instrument, config) => {
    set({
      candles,
      instrument,
      sessionConfig: config || null,
      currentIndex: 0,
      trades: [],
      position: null,
      isPlaying: false,
    });
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

  checkSLTPHits: (index: number) => {
    const { candles, position } = get();
    if (!position || (!position.stopLoss && !position.target)) return;

    const candle = candles[index];
    if (!candle) return;

    const { stopLoss, target, quantity } = position;
    const isLong = quantity > 0;

    const sl = Number(stopLoss);
    const tp = Number(target);
    const close = Number(candle.close);
    const low = Number(candle.low);
    const high = Number(candle.high);
    const eps = 0.01; // Slightly larger epsilon to ensure it's "truly" hit

    let hitType: 'SL' | 'TP' | null = null;
    let hitPrice: number = 0;

    // 1. Check Close Hit (Dialog Trigger)
    if (isLong) {
      if (sl > 0 && close < (sl - eps)) {
        hitType = 'SL';
        hitPrice = sl;
      } else if (tp > 0 && close > (tp + eps)) {
        hitType = 'TP';
        hitPrice = tp;
      }
    } else {
      if (sl > 0 && close > (sl + eps)) {
        hitType = 'SL';
        hitPrice = sl;
      } else if (tp > 0 && close < (tp - eps)) {
        hitType = 'TP';
        hitPrice = tp;
      }
    }

    if (hitType) {
      // Pause playback and show dialog
      set({ isPlaying: false, pendingExitRequest: { type: hitType, price: hitPrice, spotPrice: close } });
      return;
    }

    // 2. Check Wick Hit (Advanced Tracking - only notify if close hasn't hit)
    hitType = null;
    if (isLong) {
      if (sl > 0 && low < (sl - eps) && close >= (sl - eps)) {
        hitType = 'SL';
        hitPrice = sl;
      } else if (tp > 0 && high > (tp + eps) && close <= (tp + eps)) {
        hitType = 'TP';
        hitPrice = tp;
      }
    } else {
      if (sl > 0 && high > (sl + eps) && close <= (sl + eps)) {
        hitType = 'SL';
        hitPrice = sl;
      } else if (tp > 0 && low < (tp - eps) && close >= (tp - eps)) {
        hitType = 'TP';
        hitPrice = tp;
      }
    }

    if (hitType) {
      if ((hitType === 'SL' && position.slHit) || (hitType === 'TP' && position.tpHit)) return;

      useNotificationStore.getState().notify(
        `${hitType} Hit at ${hitPrice.toFixed(2)} (High/Low movement)!`,
        hitType === 'TP' ? 'success' : 'warning'
      );

      set({
        position: {
          ...position,
          slHit: hitType === 'SL' ? true : (position.slHit || false),
          tpHit: hitType === 'TP' ? true : (position.tpHit || false),
          hitFirst: position.hitFirst || hitType,
        }
      });
    }
  },

  setSpeed: (speed) => set({ speed }),

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
    }

    set({ pendingExitRequest: null });
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

  executeTrade: (type, quantity, stopLoss, target, priceOverride, exitReason = 'MANUAL', journal) => {
    const { candles, currentIndex, trades, position, instrument } = get();
    const currentCandle = candles[currentIndex];

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

    if (isSameSide) {
      if (isReducing) {
        // Priority for reduction: Explicit > Old Position (Ignore new levels if they are wrong-way)
        const isL = newQty > 0;
        const isTargetWrong = target !== undefined && ((isL && target < currentPrice) || (!isL && target > currentPrice));
        const isSLWrong = stopLoss !== undefined && ((isL && stopLoss > currentPrice) || (!isL && stopLoss < currentPrice));

        tradeTarget = (target === undefined || isTargetWrong) ? position?.target : target;
        tradeStopLoss = (stopLoss === undefined || isSLWrong) ? position?.stopLoss : stopLoss;
      } else if (isSameDirection) {
        // Priority for add-on: Explicit > Old Position
        tradeTarget = target ?? position?.target;
        tradeStopLoss = stopLoss ?? position?.stopLoss;
      }
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
      slHit: position?.slHit,
      tpHit: position?.tpHit,
      hitFirst: position?.hitFirst,
      trendReversed: position?.trendReversed,
      trendReversedPnL: position?.trendReversedPnL,
      withTrendSeen: isSameSide ? (position?.withTrendSeen || isInitialWith) : isInitialWith,
      journal: journal || undefined,
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
      slHit: isFlip ? undefined : position?.slHit,
      tpHit: isFlip ? undefined : position?.tpHit,
      hitFirst: isFlip ? undefined : position?.hitFirst,
      trendReversed: isFlip ? undefined : position?.trendReversed,
      trendReversedPnL: isFlip ? undefined : position?.trendReversedPnL,
      withTrendSeen: trade.withTrendSeen,
    };

    set({
      trades: [...trades, trade],
      position: newQty !== 0 ? newPositionState : null,
    });
  },

  resetSession: () => {
    set({
      currentIndex: 0,
      trades: [],
      position: null,
      isPlaying: false,
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
    const { position, candles, currentIndex } = get();
    if (!position || position.quantity === 0) {
      return 0;
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

  checkTrendReversal: (index: number) => {
    const { candles, position, trades } = get();
    if (!position || position.quantity === 0 || position.trendReversed) return;

    const visibleCandles = candles.slice(0, index + 1);
    const pivots = calculatePivotPoints(visibleCandles);
    const { ltMarket } = analyzeMarketStructure(visibleCandles, pivots);

    const direction = position.quantity > 0 ? "LONG" : "SHORT";

    // Check if trend is aligned or against the position
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
    // This prevents notifications for trades intentionally entered counter-trend
    if (isAgainst && position.withTrendSeen) {
      const currentCandle = candles[index];
      const unrealizedPnL = (currentCandle.close - position.averagePrice) * position.quantity;

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

  toggleMarkers: () => set((state) => ({ showMarkers: !state.showMarkers })),
  setTradeQuantity: (tradeQuantity) => set({ tradeQuantity }),
  setRiskPerTrade: (riskPerTrade) => set({ riskPerTrade }),
  setManualLevels: (manualLevels) => set({ manualLevels }),
  toggleAtrForSignals: () => set((state) => ({ useAtrForSignals: !state.useAtrForSignals })),
}));
