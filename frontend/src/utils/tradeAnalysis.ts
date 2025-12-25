import type { Trade } from '../types';

export interface GroupedPosition {
    id: string;
    direction: 'LONG' | 'SHORT';
    status: 'OPEN' | 'CLOSED';
    instrument: string;
    entryTime: number;
    exitTime?: number;
    avgEntryPrice: number;
    avgExitPrice?: number;
    totalQuantity: number; // Total quantity accumulated in this position
    remainingQuantity: number;
    realizedPnL: number;
    unrealizedPnL?: number; // Calculated only for OPEN positions
    executions: Trade[];
    durationMinutes?: number;
}

export interface TradePerformanceSummary {
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    winRate: number;
    totalPnL: number;
    avgWin: number;
    avgLoss: number;
    profitFactor: number;
    maxDrawdown: number;
    longs: { count: number; pnl: number };
    shorts: { count: number; pnl: number };
}

export function groupTradesIntoPositions(trades: Trade[]): GroupedPosition[] {
    const positions: GroupedPosition[] = [];
    let currentPos: GroupedPosition | null = null;
    let runningQty = 0; // Tracks the net signed quantity (+ for Long, - for Short)

    for (const trade of trades) {
        const tradeSign = trade.type === 'BUY' ? 1 : -1;
        const tradeQtySigned = trade.quantity * tradeSign;

        // Determine if we are opening/adding or reducing/closing
        // If runningQty is 0, we are Opening.
        // If signs match (e.g. running +10 and trade +5), we are Adding.
        // If signs differ (e.g. running +10 and trade -5), we are Reducing.

        // Case 0: No open position -> Open new
        if (runningQty === 0) {
            runningQty = tradeQtySigned;
            currentPos = {
                id: `pos-${trade.id}`,
                direction: trade.type === 'BUY' ? 'LONG' : 'SHORT',
                status: 'OPEN',
                instrument: trade.instrument,
                entryTime: trade.timestamp,
                avgEntryPrice: trade.price,
                totalQuantity: trade.quantity,
                remainingQuantity: trade.quantity, // Absolute
                realizedPnL: 0,
                executions: [trade],
            };
            // Note: We don't push to 'positions' yet, we keep it in 'currentPos' until closed or loop ends?
            // Actually easier to push reference and modify it, or manage separate list.
            // Let's manage separate list, but remember we might close and open in same iteration (flip).
        }
        else {
            // We have an open position.
            const isSameDir = (runningQty > 0 && tradeSign > 0) || (runningQty < 0 && tradeSign < 0);

            if (isSameDir) {
                // INCREASING POSITION (Scaling In)
                if (!currentPos) continue; // Should not happen if logic is correct

                // Update avg entry
                const oldTotalVal = currentPos.avgEntryPrice * currentPos.remainingQuantity;
                const addVal = trade.price * trade.quantity;
                const newRemQty = currentPos.remainingQuantity + trade.quantity;
                currentPos.avgEntryPrice = (oldTotalVal + addVal) / newRemQty;

                currentPos.totalQuantity += trade.quantity;
                currentPos.remainingQuantity = newRemQty;
                currentPos.executions.push(trade);

                runningQty += tradeQtySigned;
            }
            else {
                // REDUCING or FLIPPING
                if (!currentPos) continue;

                // How much are we closing?
                // trade.quantity is absolute. runningQty is signed.
                // If Long 10 (running +10) and Sell 15 (tradeQty 15, sign -1):
                // We close 10. We flip 5.

                const absRunning = Math.abs(runningQty);
                const qtyToClose = Math.min(absRunning, trade.quantity);
                const qtyToFlip = trade.quantity - qtyToClose;

                // 1. Process Closing Portion
                // Calculate PnL on closed portion
                // Long: (Exit - Entry)
                // Short: (Entry - Exit)
                const priceDiff = currentPos.direction === 'LONG'
                    ? (trade.price - currentPos.avgEntryPrice)
                    : (currentPos.avgEntryPrice - trade.price);

                const closedPnL = priceDiff * qtyToClose;

                currentPos.realizedPnL += closedPnL;
                currentPos.remainingQuantity -= qtyToClose;

                // Update avg exit price?
                // We can track total exit value to compute avg exit at end
                // For simplicity, let's just push execution.

                // We need to inject the "Closed PnL" into the execution record for display??
                // The raw trade might already have PnL from the store, but recalculating ensures consistency.
                // Let's attach a 'partial' execution record to the group?
                // Or just attach the raw trade.

                // Note: The raw trade might represent a Flip (part close, part open).
                // If it's a flip, we should ideally split the execution visually in the grouping, 
                // OR add the trade to both the closing position (as exit) and new position (as entry).

                if (qtyToFlip > 0) {
                    // It's a FLIP.
                    // 1. Finish current position
                    const closingTrade = { ...trade, quantity: qtyToClose, pnl: closedPnL };
                    currentPos.executions.push(closingTrade);
                    currentPos.status = 'CLOSED';
                    currentPos.exitTime = trade.timestamp;
                    // approx avg exit
                    currentPos.avgExitPrice = trade.price; // Simplified if single exit, otherwise needs weighting

                    positions.push(currentPos);

                    // 2. Start new position
                    runningQty = (tradeSign * qtyToFlip);
                    currentPos = {
                        id: `pos-${trade.id}-flip`,
                        direction: trade.type === 'BUY' ? 'LONG' : 'SHORT', // The trade direction is the new direction
                        status: 'OPEN',
                        instrument: trade.instrument,
                        entryTime: trade.timestamp,
                        avgEntryPrice: trade.price,
                        totalQuantity: qtyToFlip,
                        remainingQuantity: qtyToFlip,
                        realizedPnL: 0,
                        executions: [{ ...trade, quantity: qtyToFlip, pnl: undefined }]
                    };
                } else {
                    // Just reducing or Flat
                    const reduceTrade = { ...trade, quantity: qtyToClose, pnl: closedPnL };
                    currentPos.executions.push(reduceTrade);
                    currentPos.remainingQuantity = Math.abs(runningQty) - qtyToClose; // Should be 0 if flat
                    runningQty += tradeQtySigned; // Update running (+10 - 5 = +5)

                    if (runningQty === 0) {
                        // Closed Flat
                        currentPos.status = 'CLOSED';
                        currentPos.exitTime = trade.timestamp;
                        currentPos.avgExitPrice = trade.price; // Simplified
                        positions.push(currentPos);
                        currentPos = null;
                    }
                }
            }
        }
    }

    // Push the final open position if exists
    if (currentPos) {
        positions.push(currentPos);
    }

    // Calculate durations and refine details
    return positions.map(p => {
        if (p.entryTime && p.exitTime) {
            p.durationMinutes = (p.exitTime - p.entryTime) / 60;
        }
        return p;
    }).reverse(); // Most recent first
}

export function calculatePerformanceStats(positions: GroupedPosition[]): TradePerformanceSummary {
    const closedPositions = positions.filter(p => p.status === 'CLOSED');

    let totalPnL = 0;
    let winCount = 0;
    let lossCount = 0;
    let totalWinVal = 0;
    let totalLossVal = 0;
    let longCount = 0;
    let longPnL = 0;
    let shortCount = 0;
    let shortPnL = 0;

    closedPositions.forEach(p => {
        totalPnL += p.realizedPnL;
        if (p.realizedPnL > 0) {
            winCount++;
            totalWinVal += p.realizedPnL;
        } else if (p.realizedPnL < 0) {
            lossCount++;
            totalLossVal += Math.abs(p.realizedPnL);
        }

        if (p.direction === 'LONG') {
            longCount++;
            longPnL += p.realizedPnL;
        } else {
            shortCount++;
            shortPnL += p.realizedPnL;
        }
    });

    return {
        totalTrades: closedPositions.length,
        winningTrades: winCount,
        losingTrades: lossCount,
        winRate: closedPositions.length > 0 ? (winCount / closedPositions.length) * 100 : 0,
        totalPnL,
        avgWin: winCount > 0 ? totalWinVal / winCount : 0,
        avgLoss: lossCount > 0 ? totalLossVal / lossCount : 0,
        profitFactor: totalLossVal > 0 ? totalWinVal / totalLossVal : totalWinVal > 0 ? Infinity : 0,
        maxDrawdown: 0, // Need equity curve for this, skipping for now
        longs: { count: longCount, pnl: longPnL },
        shorts: { count: shortCount, pnl: shortPnL }
    };
}
