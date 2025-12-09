import { Trade, Position } from '../types';
import { v4 as uuidv4 } from 'uuid';

/**
 * Backtesting Engine
 * Handles trade execution, position tracking, and P&L calculation
 */
export class BacktestEngine {
  private trades: Trade[] = [];
  private position: Position | null = null;
  private instrument: string;

  constructor(instrument: string, initialBalance: number = 100000) {
    this.instrument = instrument;
  }

  /**
   * Execute a buy or sell trade
   */
  executeTrade(
    type: 'BUY' | 'SELL',
    quantity: number,
    currentPrice: number,
    timestamp: number
  ): Trade {
    const trade: Trade = {
      id: uuidv4(),
      timestamp,
      type,
      price: currentPrice,
      quantity,
      instrument: this.instrument,
    };

    // Update position
    this.updatePosition(trade);

    // Add to trade history
    this.trades.push(trade);

    return trade;
  }

  /**
   * Update position based on trade (FIFO method)
   */
  private updatePosition(trade: Trade): void {
    if (!this.position) {
      // Initialize position
      this.position = {
        instrument: this.instrument,
        quantity: 0,
        averagePrice: 0,
        realizedPnL: 0,
        unrealizedPnL: 0,
      };
    }

    if (trade.type === 'BUY') {
      // Add to position
      const totalCost =
        this.position.quantity * this.position.averagePrice +
        trade.quantity * trade.price;
      const totalQuantity = this.position.quantity + trade.quantity;

      this.position.averagePrice = totalCost / totalQuantity;
      this.position.quantity = totalQuantity;
    } else {
      // SELL - reduce position
      if (this.position.quantity >= trade.quantity) {
        // Calculate realized P&L for this trade
        const pnl = (trade.price - this.position.averagePrice) * trade.quantity;
        trade.pnl = pnl;
        this.position.realizedPnL += pnl;
        this.position.quantity -= trade.quantity;

        // If position is closed, reset average price
        if (this.position.quantity === 0) {
          this.position.averagePrice = 0;
        }
      } else {
        // Short selling (if allowed) or error
        throw new Error(
          `Cannot sell ${trade.quantity} shares. Current position: ${this.position.quantity}`
        );
      }
    }
  }

  /**
   * Calculate unrealized P&L based on current market price
   */
  calculateUnrealizedPnL(currentPrice: number): number {
    if (!this.position || this.position.quantity === 0) {
      return 0;
    }

    return (currentPrice - this.position.averagePrice) * this.position.quantity;
  }

  /**
   * Get current position
   */
  getPosition(currentPrice?: number): Position | null {
    if (!this.position) {
      return null;
    }

    return {
      ...this.position,
      unrealizedPnL: currentPrice
        ? this.calculateUnrealizedPnL(currentPrice)
        : this.position.unrealizedPnL,
    };
  }

  /**
   * Get all trades
   */
  getTrades(): Trade[] {
    return this.trades;
  }

  /**
   * Get total realized P&L
   */
  getRealizedPnL(): number {
    return this.position?.realizedPnL || 0;
  }

  /**
   * Get session summary
   */
  getSessionSummary(currentPrice?: number): {
    trades: Trade[];
    position: Position | null;
    totalRealizedPnL: number;
    totalUnrealizedPnL: number;
    totalPnL: number;
    winningTrades: number;
    losingTrades: number;
    winRate: number;
  } {
    const realizedPnL = this.getRealizedPnL();
    const unrealizedPnL = currentPrice ? this.calculateUnrealizedPnL(currentPrice) : 0;

    const closedTrades = this.trades.filter((t) => t.type === 'SELL' && t.pnl !== undefined);
    const winningTrades = closedTrades.filter((t) => (t.pnl || 0) > 0).length;
    const losingTrades = closedTrades.filter((t) => (t.pnl || 0) < 0).length;
    const totalClosedTrades = closedTrades.length;

    return {
      trades: this.trades,
      position: this.getPosition(currentPrice),
      totalRealizedPnL: realizedPnL,
      totalUnrealizedPnL: unrealizedPnL,
      totalPnL: realizedPnL + unrealizedPnL,
      winningTrades,
      losingTrades,
      winRate: totalClosedTrades > 0 ? (winningTrades / totalClosedTrades) * 100 : 0,
    };
  }

  /**
   * Reset session (clear all trades and positions)
   */
  reset(): void {
    this.trades = [];
    this.position = null;
  }
}
