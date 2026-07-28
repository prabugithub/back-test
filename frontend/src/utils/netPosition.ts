// Derived net view over the independently-managed trades of multi-trade mode.
//
// In multi-trade mode `store.position` is no longer the source of truth — it is
// rebuilt from `openPositions` after every mutation so the ~10 components and
// selectors that read `position` (SessionStats, TradeExitDialog, persistence,
// getUnrealizedPnL, …) keep working untouched. Nothing may trade against the
// mirror; exits go through closeIndependentPosition, one trade at a time.

import type { BacktestPosition, OpenPosition, Trade } from '../types';

export function buildNetPositionMirror(
  openPositions: OpenPosition[],
  multiRealizedPnL: number,
  instrument: string,
  currentClose?: number
): BacktestPosition | null {
  if (openPositions.length === 0) return null;

  const quantity = openPositions.reduce((sum, p) => sum + p.quantity, 0);
  const absTotal = openPositions.reduce((sum, p) => sum + Math.abs(p.quantity), 0);
  const averagePrice = absTotal > 0
    ? openPositions.reduce((sum, p) => sum + Math.abs(p.quantity) * p.averagePrice, 0) / absTotal
    : 0;
  const unrealizedPnL = currentClose === undefined
    ? 0
    : openPositions.reduce((sum, p) => sum + (currentClose - p.averagePrice) * p.quantity, 0);

  // A single open trade can show its own levels; a blended SL/TP across several
  // trades would be meaningless, so leave them undefined and let the overlay's
  // per-trade rows carry them.
  const single = openPositions.length === 1 ? openPositions[0] : null;

  return {
    instrument,
    quantity,
    averagePrice,
    realizedPnL: multiRealizedPnL,
    unrealizedPnL,
    stopLoss: single?.stopLoss,
    target: single?.target,
    slHit: single?.slHit,
    tpHit: single?.tpHit,
    slDialogShown: single?.slDialogShown,
    tpDialogShown: single?.tpDialogShown,
    hitFirst: single?.hitFirst,
    autoEntry: openPositions.every(p => p.autoEntry) || undefined,
    entryRegime: single?.entryRegime,
    entryBarIndex: single?.entryBarIndex,
    exitWithTrendSeen: single?.exitWithTrendSeen,
    exitAgainstBars: single?.exitAgainstBars,
    slTrailed: single?.slTrailed,
  };
}

/**
 * Reconstructs the still-open independent trades (and their settled P&L) from the
 * trade log alone. Used after a destructive trade-log edit — deleting a fill — where
 * the live `openPositions` array no longer matches what the log says happened.
 * Exit-engine state (slTrailed, the reversal counters) is not recoverable from the
 * log and resets; SL/TP come from the entry fill.
 */
export function rebuildOpenPositionsFromTrades(
  trades: Trade[],
  instrument: string
): { openPositions: OpenPosition[]; multiRealizedPnL: number } {
  const byId = new Map<string, Trade[]>();
  let multiRealizedPnL = 0;
  for (const t of trades) {
    if (!t.positionId) continue;
    const bucket = byId.get(t.positionId);
    if (bucket) bucket.push(t);
    else byId.set(t.positionId, [t]);
  }

  const openPositions: OpenPosition[] = [];
  for (const [id, fills] of byId) {
    const entry = fills[0];
    if (!entry) continue;
    const exit = fills.find(t => t.type !== entry.type);
    if (exit) {
      multiRealizedPnL += exit.pnl ?? 0;
      continue;
    }
    openPositions.push({
      id,
      entryTimestamp: entry.timestamp,
      instrument: entry.instrument || instrument,
      quantity: entry.type === 'BUY' ? entry.quantity : -entry.quantity,
      averagePrice: entry.price,
      realizedPnL: 0,
      unrealizedPnL: 0,
      stopLoss: entry.stopLoss,
      target: entry.target,
      withTrendSeen: entry.withTrendSeen,
      autoEntry: true,
    });
  }
  return { openPositions, multiRealizedPnL };
}
