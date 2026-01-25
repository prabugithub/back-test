import { create } from 'zustand';
import type { Candle, Trade, Position } from '../types';
import { saveTradeSession } from '../utils/tradeStorage';
import { groupTradesIntoPositions, calculatePerformanceStats } from '../utils/tradeAnalysis';
import { saveSession, loadSession, type SessionState } from '../services/firebaseSessionService';
import { useNotificationStore } from './notificationStore';

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

  // Actions
  loadCandles: (candles: Candle[], instrument: string, config?: SessionConfig) => void;
  play: () => void;
  pause: () => void;
  step: (direction: 'forward' | 'backward') => void;
  jump: (count: number) => void;
  setSpeed: (speed: number) => void;
  setCurrentIndex: (index: number) => void;
  executeTrade: (type: 'BUY' | 'SELL', quantity: number) => void;
  saveRemoteSession: () => Promise<void>;
  loadRemoteSession: () => Promise<{ config: SessionConfig, data: { trades: Trade[], position: Position | null, currentIndex: number } } | null>;
  restoreSessionState: (trades: Trade[], position: Position | null, currentIndex: number) => void;
  resetSession: () => void;
  saveCurrentSession: () => void;

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
      set({ currentIndex: currentIndex + 1 });
    } else if (direction === 'backward' && currentIndex > 0) {
      set({ currentIndex: currentIndex - 1 });
    }
  },

  setSpeed: (speed) => set({ speed }),

  setCurrentIndex: (index) => {
    const { candles } = get();
    if (index >= 0 && index < candles.length) {
      set({ currentIndex: index });
    }
  },

  executeTrade: (type, quantity) => {
    const { candles, currentIndex, trades, position, instrument } = get();
    const currentCandle = candles[currentIndex];

    if (!currentCandle) {
      console.error('No current candle available');
      return;
    }

    const currentPrice = currentCandle.close;
    const timestamp = currentCandle.timestamp;

    // Create trade
    const trade: Trade = {
      id: generateTradeId(),
      timestamp,
      type,
      price: currentPrice,
      quantity,
      instrument,
    };

    // Simplified Position Management allowing Long and Short
    const currentQty = position ? position.quantity : 0;
    const currentAvgPrice = position ? position.averagePrice : 0;

    // Determine trade direction sign: Buy = +1, Sell = -1
    const tradeSign = type === 'BUY' ? 1 : -1;
    const tradeQtySigned = quantity * tradeSign;

    let newQty = currentQty + tradeQtySigned;
    let newAvgPrice = currentAvgPrice;
    let newRealizedPnL = position ? position.realizedPnL : 0;
    let tradePnL = undefined;

    // Logic:
    // 1. Increasing position (Long->More Long OR Short->More Short OR Flat->Open)
    // 2. Decreasing position (Long->Less Long OR Short->Less Short) -> Realize P&L
    // 3. Flipping position (Long->Short OR Short->Long) -> Realize P&L on closed portion, Open new remaining

    const isSameDirection = (currentQty >= 0 && tradeSign > 0) || (currentQty <= 0 && tradeSign < 0);

    // Case 0: Opening from flat
    if (currentQty === 0) {
      newAvgPrice = currentPrice;
    }
    // Case 1: Increasing Position (Adding to winner/loser)
    else if (isSameDirection) {
      const totalValue = (Math.abs(currentQty) * currentAvgPrice) + (quantity * currentPrice);
      const totalShares = Math.abs(currentQty) + quantity;
      newAvgPrice = totalValue / totalShares;
    }
    // Case 2 & 3: Reducing or Flipping
    else {
      // We are reducing the current position. 
      // How much are we closing? 
      // If current is +10 and we Sell 5 (qty=5, sign=-1), we close 5.
      // If current is +10 and we Sell 20, we close 10, and open -10.

      const qtyClosing = Math.min(Math.abs(currentQty), quantity);

      // Calculate P&L on the closed portion
      // Long Close: (Exit - Entry) * Qty
      // Short Close: (Entry - Exit) * Qty
      const pnlPerShare = currentQty > 0 ? (currentPrice - currentAvgPrice) : (currentAvgPrice - currentPrice);
      const realizedParams = pnlPerShare * qtyClosing;

      tradePnL = realizedParams; // P&L for this specific trade (or the closing portion of it)
      newRealizedPnL += realizedParams;

      // Check if we flipped
      // remaining trade quantity after closing
      const qtyRemaining = quantity - qtyClosing;

      if (qtyRemaining > 0) {
        // We flipped direction. New position is formed by the remainder.
        // New Entry Price is current price.
        newAvgPrice = currentPrice;
      }
      // If we didn't flip, we just reduced size. Avg Price stays same.
      // (unless we closed fully, but then qty is 0, handled by generic check)
    }

    // Assign P&L to the trade record for display
    trade.pnl = tradePnL;

    const newPositionState: Position = {
      instrument,
      quantity: newQty,
      averagePrice: newAvgPrice,
      realizedPnL: newRealizedPnL,
      unrealizedPnL: 0, // Recalculated by getter
    };

    set({
      trades: [...trades, trade],
      position: newQty !== 0 ? newPositionState : null, // If qty is 0, position is null/closed
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

  saveCurrentSession: () => {
    const { instrument, trades } = get();
    if (trades.length === 0) return;

    // Calculate stats ensuring we have at least defaults
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

    // We need sessionConfig to be able to restore the data context
    if (!sessionConfig) {
      console.warn("Cannot save session: Missing session configuration");
      useNotificationStore.getState().notify(
        'Cannot save: Missing session configuration. Please reload data.',
        'error'
      );
      return;
    }

    // Sanitize trades to remove undefined fields which Firebase setDoc rejects
    const sanitizedTrades = trades.map(t => {
      // Create a shallow copy
      const cleanT: any = { ...t };
      // If pnl is undefined, set it to null (valid JSON/Firestore)
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

    // Extend with full config
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

  // Computed getters
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
    } else if (newIndex < 0) {
      set({ currentIndex: 0 });
    } else {
      set({ currentIndex: candles.length - 1 });
    }
  },

  getRealizedPnL: () => {
    const { position } = get();
    return position?.realizedPnL || 0;
  },
}));
