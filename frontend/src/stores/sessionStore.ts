import { create } from 'zustand';
import type { Candle, Trade, Position } from '../types';

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
  setSpeed: (speed: number) => void;
  setCurrentIndex: (index: number) => void;
  executeTrade: (type: 'BUY' | 'SELL', quantity: number) => void;
  resetSession: () => void;

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

    // Update position using FIFO logic
    let newPosition = position ? { ...position } : {
      instrument,
      quantity: 0,
      averagePrice: 0,
      realizedPnL: 0,
      unrealizedPnL: 0,
    };

    if (type === 'BUY') {
      // Add to position
      const totalCost = newPosition.quantity * newPosition.averagePrice + quantity * currentPrice;
      const totalQuantity = newPosition.quantity + quantity;
      newPosition.averagePrice = totalCost / totalQuantity;
      newPosition.quantity = totalQuantity;
    } else {
      // SELL - reduce position
      if (newPosition.quantity >= quantity) {
        // Calculate realized P&L
        const pnl = (currentPrice - newPosition.averagePrice) * quantity;
        trade.pnl = pnl;
        newPosition.realizedPnL += pnl;
        newPosition.quantity -= quantity;

        // Reset average price if position closed
        if (newPosition.quantity === 0) {
          newPosition.averagePrice = 0;
        }
      } else {
        console.error(`Cannot sell ${quantity} shares. Current position: ${newPosition.quantity}`);
        return;
      }
    }

    set({
      trades: [...trades, trade],
      position: newPosition.quantity > 0 ? newPosition : null,
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

  getRealizedPnL: () => {
    const { position } = get();
    return position?.realizedPnL || 0;
  },
}));
