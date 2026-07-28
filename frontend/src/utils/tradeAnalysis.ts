import type { Trade, ExitReason } from '../types';

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
    stopLoss?: number;
    target?: number;
    exitReason?: ExitReason;
    slHit?: boolean;
    tpHit?: boolean;
    hitFirst?: 'SL' | 'TP';
    trendReversed?: boolean;
    trendReversedPnL?: number;
}

// Badge color + label per exit reason — shared by TradeHistoryDialog and
// TradeReportDialog so the auto-exit-engine reasons render consistently.
export function exitReasonBadge(reason: ExitReason): { cls: string; label: string } {
  switch (reason) {
    case 'TP': return { cls: 'bg-green-100 text-green-700', label: 'TP' };
    case 'SL': return { cls: 'bg-red-100 text-red-700', label: 'SL' };
    case 'TIME_OVER': return { cls: 'bg-orange-100 text-orange-700', label: 'TIME OVER' };
    case 'REVERSAL': return { cls: 'bg-amber-100 text-amber-700', label: 'REVERSAL' };
    case 'OPP_SIGNAL': return { cls: 'bg-purple-100 text-purple-700', label: 'OPP SIGNAL' };
    case 'LEG_DECAY': return { cls: 'bg-sky-100 text-sky-700', label: 'LEG DECAY' };
    default: return { cls: 'bg-gray-100 text-gray-600', label: reason };
  }
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
    maxDrawdownPercent: number;
    longs: { count: number; pnl: number };
    shorts: { count: number; pnl: number };
    equityCurve: { timestamp: number; equity: number }[];
    expectancy: number;
}

/**
 * Trades opened in multi-trade mode carry a `positionId` pairing each exit fill with
 * the exact entry fill it closes. They run concurrently and interleave, so the
 * sequential net-quantity walk below cannot reconstruct them — it would read a
 * second entry as "scaling in" and an opposite-side entry as a flip. Group those
 * by id instead, and leave every other trade to the original walk.
 */
function groupTradesByPositionId(trades: Trade[]): GroupedPosition[] {
    const byId = new Map<string, Trade[]>();
    for (const trade of trades) {
        const id = trade.positionId!;
        const bucket = byId.get(id);
        if (bucket) bucket.push(trade);
        else byId.set(id, [trade]);
    }

    const positions: GroupedPosition[] = [];
    for (const [id, fills] of byId) {
        const [entry, ...rest] = fills;
        if (!entry) continue;
        const direction = entry.type === 'BUY' ? 'LONG' : 'SHORT';
        // At most one exit — an independent trade is always closed in full.
        const exit = rest.find(t => t.type !== entry.type);

        const pos: GroupedPosition = {
            id: `pos-${id}`,
            direction,
            status: exit ? 'CLOSED' : 'OPEN',
            instrument: entry.instrument,
            entryTime: entry.timestamp,
            avgEntryPrice: entry.price,
            totalQuantity: entry.quantity,
            remainingQuantity: exit ? 0 : entry.quantity,
            realizedPnL: exit?.pnl ?? 0,
            target: entry.target,
            stopLoss: entry.stopLoss,
            slHit: exit?.slHit ?? entry.slHit,
            tpHit: exit?.tpHit ?? entry.tpHit,
            hitFirst: exit?.hitFirst ?? entry.hitFirst,
            trendReversed: exit?.trendReversed ?? entry.trendReversed,
            trendReversedPnL: exit?.trendReversedPnL ?? entry.trendReversedPnL,
            executions: fills,
        };
        if (exit) {
            pos.exitTime = exit.timestamp;
            pos.avgExitPrice = exit.price;
            pos.exitReason = exit.exitReason;
        }
        positions.push(pos);
    }
    return positions;
}

export function groupTradesIntoPositions(allTrades: Trade[]): GroupedPosition[] {
    // Split first: independent trades are grouped by id, everything else keeps the
    // original sequential walk untouched. A session can legitimately contain both.
    const trades = allTrades.filter(t => !t.positionId);
    const independent = allTrades.filter(t => t.positionId);

    const positions: GroupedPosition[] = independent.length ? groupTradesByPositionId(independent) : [];
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
                target: trade.target,
                stopLoss: trade.stopLoss,
                slHit: trade.slHit,
                tpHit: trade.tpHit,
                hitFirst: trade.hitFirst,
                trendReversed: trade.trendReversed,
                trendReversedPnL: trade.trendReversedPnL,
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

                // Aggregrate hits
                if (trade.slHit) currentPos.slHit = true;
                if (trade.tpHit) currentPos.tpHit = true;
                if (trade.hitFirst) currentPos.hitFirst = trade.hitFirst;
                if (trade.trendReversed) {
                    currentPos.trendReversed = true;
                    currentPos.trendReversedPnL = trade.trendReversedPnL;
                }

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
                    currentPos.avgExitPrice = trade.price;
                    currentPos.exitReason = trade.exitReason;
                    if (trade.slHit) currentPos.slHit = true;
                    if (trade.tpHit) currentPos.tpHit = true;
                    if (trade.hitFirst) currentPos.hitFirst = trade.hitFirst;
                    if (trade.trendReversed) {
                        currentPos.trendReversed = true;
                        currentPos.trendReversedPnL = trade.trendReversedPnL;
                    }

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
                        currentPos.exitReason = trade.exitReason;
                        if (trade.slHit) currentPos.slHit = true;
                        if (trade.tpHit) currentPos.tpHit = true;
                        if (trade.hitFirst) currentPos.hitFirst = trade.hitFirst;
                        if (trade.trendReversed) {
                            currentPos.trendReversed = true;
                            currentPos.trendReversedPnL = trade.trendReversedPnL;
                        }
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

    const normalizeTs = (ts: number) => ts > 1e11 ? ts : ts * 1000;

    // Calculate durations and refine details
    const refined = positions.map(p => {
        // Normalize position boundaries
        p.entryTime = normalizeTs(p.entryTime);
        if (p.exitTime) {
            p.exitTime = normalizeTs(p.exitTime);
        }
        
        // Normalize individual executions
        p.executions = p.executions.map(ex => ({
            ...ex,
            timestamp: normalizeTs(ex.timestamp)
        }));
        
        if (p.entryTime && p.exitTime) {
            p.durationMinutes = (p.exitTime - p.entryTime) / (1000 * 60);
        }
        return p;
    });

    // The walk pushes in close order, so reversing it yields most-recent-first.
    // Once id-grouped positions are mixed in, that ordering no longer holds —
    // sort explicitly, but only then, so legacy sessions keep their exact order.
    return independent.length
        ? refined.sort((a, b) => b.entryTime - a.entryTime)
        : refined.reverse();
}

export function calculatePerformanceStats(positions: GroupedPosition[]): TradePerformanceSummary {
    const closedPositions = [...positions]
        .filter(p => p.status === 'CLOSED')
        .sort((a, b) => (a.exitTime || 0) - (b.exitTime || 0));

    let totalPnL = 0;
    let winCount = 0;
    let lossCount = 0;
    let totalWinVal = 0;
    let totalLossVal = 0;
    let longCount = 0;
    let longPnL = 0;
    let shortCount = 0;
    let shortPnL = 0;

    const equityCurve = [{ timestamp: closedPositions[0]?.entryTime || Date.now(), equity: 0 }];
    let currentEquity = 0;
    let peakEquity = 0;
    let maxDD = 0;

    closedPositions.forEach(p => {
        currentEquity += p.realizedPnL;
        totalPnL += p.realizedPnL;
        
        equityCurve.push({ 
            timestamp: p.exitTime || Date.now(), 
            equity: currentEquity 
        });

        if (currentEquity > peakEquity) {
            peakEquity = currentEquity;
        } else {
            const dd = peakEquity - currentEquity;
            if (dd > maxDD) {
                maxDD = dd;
            }
        }

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

    const totalTrades = closedPositions.length;
    const winRate = totalTrades > 0 ? (winCount / totalTrades) * 100 : 0;
    const avgWin = winCount > 0 ? totalWinVal / winCount : 0;
    const avgLoss = lossCount > 0 ? totalLossVal / lossCount : 0;
    const profitFactor = totalLossVal > 0 ? totalWinVal / totalLossVal : totalWinVal > 0 ? Infinity : 0;
    const expectancy = totalTrades > 0 ? ( (winRate/100 * avgWin) - ((1 - winRate/100) * avgLoss) ) : 0;

    return {
        totalTrades,
        winningTrades: winCount,
        losingTrades: lossCount,
        winRate,
        totalPnL,
        avgWin,
        avgLoss,
        profitFactor,
        maxDrawdown: maxDD,
        maxDrawdownPercent: peakEquity !== 0 ? (maxDD / peakEquity) * 100 : 0,
        longs: { count: longCount, pnl: longPnL },
        shorts: { count: shortCount, pnl: shortPnL },
        equityCurve,
        expectancy
    };
}

/**
 * Re-plays a list of trades to calculate correct P&L for each trade and the final position state
 */
export function recalculateTradesPnL(trades: Trade[]): { processedTrades: Trade[], finalQty: number, finalAvgPrice: number, totalRealizedPnL: number } {
    let currentQty = 0;
    let currentAvgPrice = 0;
    let realizedPnL = 0;

    // Independent trades (multi-trade mode) never blend, so the running-average
    // walk below does not apply to them — each exit's P&L is settled against its
    // own entry via positionId. They still contribute to the totals.
    const independentEntries = new Map<string, Trade>();
    for (const t of trades) {
        if (t.positionId && !independentEntries.has(t.positionId)) independentEntries.set(t.positionId, t);
    }

    const processedTrades = trades.map(t => {
        if (t.positionId) {
            const entry = independentEntries.get(t.positionId)!;
            if (t === entry) {
                currentQty += t.type === 'BUY' ? t.quantity : -t.quantity;
                return { ...t, pnl: undefined };
            }
            const pnlPerShare = entry.type === 'BUY' ? t.price - entry.price : entry.price - t.price;
            const pnl = pnlPerShare * t.quantity;
            realizedPnL += pnl;
            currentQty += t.type === 'BUY' ? t.quantity : -t.quantity;
            return { ...t, pnl };
        }

        const tradeQty = t.quantity;
        const tradePrice = t.price;
        const tradeSign = t.type === 'BUY' ? 1 : -1;
        const tradeQtySigned = tradeQty * tradeSign;

        const isSameDirection = (currentQty >= 0 && tradeSign > 0) || (currentQty <= 0 && tradeSign < 0);
        let tradePnL = undefined;

        if (currentQty === 0) {
            currentAvgPrice = tradePrice;
            currentQty = tradeQtySigned;
        } else if (isSameDirection) {
            const totalValue = (Math.abs(currentQty) * currentAvgPrice) + (tradeQty * tradePrice);
            const totalShares = Math.abs(currentQty) + tradeQty;
            currentAvgPrice = totalValue / totalShares;
            currentQty += tradeQtySigned;
        } else {
            const qtyClosing = Math.min(Math.abs(currentQty), tradeQty);
            const pnlPerShare = currentQty > 0 ? (tradePrice - currentAvgPrice) : (currentAvgPrice - tradePrice);
            const realizedParams = pnlPerShare * qtyClosing;
            tradePnL = realizedParams;
            realizedPnL += realizedParams;

            const qtyRemaining = tradeQty - qtyClosing;
            currentQty += tradeQtySigned;

            if (qtyRemaining > 0) {
                currentAvgPrice = tradePrice;
            }
        }

        return { ...t, pnl: tradePnL };
    });

    return {
        processedTrades,
        finalQty: currentQty,
        finalAvgPrice: currentAvgPrice,
        totalRealizedPnL: realizedPnL
    };
}
