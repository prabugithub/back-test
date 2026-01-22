import { create } from 'zustand';
import type { Candle, Trade, Position } from '../types';
import { saveTradeSession } from '../utils/tradeStorage';
import { groupTradesIntoPositions, calculatePerformanceStats } from '../utils/tradeAnalysis';

interface SessionStore {
  // Data
  candles: Candle[];
  currentIndex: number;
  trades: Trade[];
  position: Position | null;
  instrument: string;

  // Playback state
  isPlaying: boolean;
  speed: number;

  // Actions
  loadCandles: (candles: Candle[], instrument: string) => void;
  play: () => void;
  pause: () => void;
  step: (direction: 'forward' | 'backward') => void;
  jump: (count: number) => void;
  setSpeed: (speed: number) => void;
  setCurrentIndex: (index: number) => void;
  executeTrade: (type: 'BUY' | 'SELL', quantity: number) => void;
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
  isPlaying: false,
  speed: 1,

  // Actions
  loadCandles: (candles, instrument) => {
    set({
      candles,
      instrument,
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
