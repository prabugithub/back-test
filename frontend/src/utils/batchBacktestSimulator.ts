// @backtest-only — pure simulation, no store access, no side effects.

import type { Candle, Trade, BacktestPosition, ExitReason } from '../types';
import type { TradeJournal } from '../types';
import { type AutoBacktestConfig, type AutoSignal, type RegimeKey, evaluateAutoSignals, evaluateTrailStop, evaluateAutoExitSignal } from './autoBacktestEngine';
import { analyzeManualEntry, calculateBarOverlap, averageBarOverlap, calculateBarRanges, averageBarRanges, calculateEfficiencyRatio, calculateBarBreaks, calculateEMASlope, calculateEMAInteraction } from './pivotAnalysis';

interface SimPosition {
  instrument: string;
  quantity: number;      // + = LONG, - = SHORT
  averagePrice: number;
  realizedPnL: number;
  unrealizedPnL: number;
  stopLoss?: number;
  target?: number;
  // Exit-engine state (every batch position is auto-entered by construction) —
  // mirrors the same optional fields on PositionBase for the interactive path.
  entryRegime?: RegimeKey;
  entryBarIndex?: number;
  exitWithTrendSeen?: boolean;
  exitAgainstBars?: number;
  slTrailed?: boolean;
}

export interface BatchSimResult {
  trades: Trade[];
  finalPosition: BacktestPosition | null;
  tradeCount: number;   // completed round-trips (trades with pnl)
  totalPnL: number;
}

function candleTimeMinutes(timestampSec: number): number {
  const d = new Date(timestampSec * 1000);
  return d.getHours() * 60 + d.getMinutes();
}

function parseHHMM(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
}

export function runBatchSimulation(
  candles: Candle[],
  config: AutoBacktestConfig,
  startIndex: number,
  instrument: string,
  tradeQuantity: number,
  sessionInterval?: string,
  onProgress?: (percent: number) => void
): BatchSimResult {
  const trades: Trade[] = [];
  let position: SimPosition | null = null;
  let tradeCounter = 0;
  const interval = sessionInterval || '5';
  const total = candles.length - startIndex;
  const reportEvery = Math.max(1, Math.floor(total / 20));

  function enterPosition(candle: Candle, signal: AutoSignal, qty: number, candleIndex: number) {
    const entryPrice = candle.close;

    // Blend into an already-open position instead of overwriting it — lets
    // "enter even with a position open" (skipIfPositionOpen: false) pyramid correctly.
    // Mirrors the same-direction averaging / opposite-direction reduce math in
    // sharedActions.ts's executeTrade (the live/step-through path), so batch and
    // interactive runs stay consistent.
    const currentQty = position ? position.quantity : 0;
    const currentAvgPrice = position ? position.averagePrice : 0;
    const currentRealizedPnL = position ? position.realizedPnL : 0;
    const tradeSign = signal.type === 'BUY' ? 1 : -1;
    const isReducing = currentQty !== 0 && Math.sign(currentQty) !== tradeSign;

    let newAvgPrice: number;
    let newRealizedPnL = currentRealizedPnL;
    let tradePnL: number | undefined;
    let newStopLoss: number | undefined;
    let newTarget: number | undefined;

    if (!isReducing) {
      // Fresh entry or same-direction add — blend average price, adopt the newest SL/TP.
      newAvgPrice = currentQty === 0
        ? entryPrice
        : (Math.abs(currentQty) * currentAvgPrice + qty * entryPrice) / (Math.abs(currentQty) + qty);
      newStopLoss = signal.sl;
      newTarget = signal.tp;
    } else {
      // Opposite-direction signal against an open position — realize PnL on the closing
      // portion; if it more than covers the open qty, the remainder flips to the new side.
      const qtyClosing = Math.min(Math.abs(currentQty), qty);
      const pnlPerShare = currentQty > 0 ? entryPrice - currentAvgPrice : currentAvgPrice - entryPrice;
      tradePnL = pnlPerShare * qtyClosing;
      newRealizedPnL += tradePnL;
      const remaining = qty - qtyClosing;
      if (remaining > 0) {
        newAvgPrice = entryPrice;
        newStopLoss = signal.sl;
        newTarget = signal.tp;
      } else {
        newAvgPrice = currentAvgPrice;
        newStopLoss = position?.stopLoss;
        newTarget = position?.target;
      }
    }

    const newQty = currentQty + qty * tradeSign;

    const journal: TradeJournal = {
      ltMarket: signal.ltMarket,
      htMarket: signal.htMarket,
      entryPosition: analyzeManualEntry(candles, candleIndex, signal.type).entryPosition,
      llhhPivot: signal.llhhPivot,
      entrySign: signal.reason,
      notes: `[Batch BT] ${signal.reason}`,
      systemEntryAlign: 'Yes',
      myViewEntryAlign: 'Yes',
      systemMoveAlign: 'Yes',
      myViewMoveAlign: 'Yes',
      tradeCategory: 'System',
    };

    const trade: Trade = {
      id: `batch-${Date.now()}-${tradeCounter++}`,
      timestamp: candle.timestamp,
      type: signal.type,
      price: entryPrice,
      quantity: qty,
      instrument,
      pnl: tradePnL,
      stopLoss: newStopLoss,
      target: newTarget,
      exitReason: 'MANUAL',
      journal,
      interval,
    };

    // Entry-condition instrumentation only makes sense for the leg that opens/adds
    // exposure, not for a pure reduce against an existing position (matches the
    // `!isReducing` gating in sharedActions.ts).
    if (!isReducing) {
      const entryMetrics = signal.entryMetrics;
      const barOverlapAtEntry = calculateBarOverlap(candles, candleIndex, config.barOverlapLookback ?? 8);
      const barRangeSamples = calculateBarRanges(candles, candleIndex, config.barRangeLookback ?? 20);
      const barRangeFallback = averageBarRanges(barRangeSamples);
      const barBreakFallback = calculateBarBreaks(candles, candleIndex, config.barBreakLookback ?? 20);
      const emaInteractionFallback = calculateEMAInteraction(candles, candleIndex, 20, config.emaInteractionLookback ?? 20);
      trade.barOverlapAtEntry = barOverlapAtEntry;
      trade.barOverlapAvgAtEntry = entryMetrics?.barOverlapAvg ?? averageBarOverlap(barOverlapAtEntry);
      trade.barRangeAvgAtEntry = entryMetrics?.barRangeAvg ?? barRangeFallback.barRangeAvg;
      trade.bullBarRangeAvgAtEntry = entryMetrics?.bullBarRangeAvg ?? barRangeFallback.bullBarRangeAvg;
      trade.bearBarRangeAvgAtEntry = entryMetrics?.bearBarRangeAvg ?? barRangeFallback.bearBarRangeAvg;
      trade.efficiencyRatioAtEntry = entryMetrics?.efficiencyRatio ?? calculateEfficiencyRatio(candles, candleIndex, config.efficiencyRatioLookback ?? 10);
      trade.highBreakCountAtEntry = entryMetrics?.highBreakCount ?? barBreakFallback.highBreakCount;
      trade.lowBreakCountAtEntry = entryMetrics?.lowBreakCount ?? barBreakFallback.lowBreakCount;
      trade.barBreakWindowAtEntry = entryMetrics?.barBreakWindow ?? barBreakFallback.barsCompared;
      trade.ema21SlopeAtEntry = entryMetrics?.ema21Slope ?? calculateEMASlope(candles, candleIndex, 21, config.ema21SlopeLookback ?? 10);
      trade.ema50SlopeAtEntry = entryMetrics?.ema50Slope ?? calculateEMASlope(candles, candleIndex, 50, config.ema50SlopeLookback ?? 20);
      trade.ema20GapBarRatioAtEntry = entryMetrics?.ema20GapBarRatio ?? emaInteractionFallback.gapBarRatio;
      trade.ema20CloseAboveRatioAtEntry = entryMetrics?.ema20CloseAboveRatio ?? emaInteractionFallback.closeAboveRatio;
      trade.ema20InteractionWindowAtEntry = entryMetrics?.ema20InteractionWindow ?? emaInteractionFallback.barsCompared;
      // Leg fields have no fallback recompute: undefined simply means the entry
      // was graded with currentIndex windows (PIVOT mode / degenerate leg).
      trade.legStartIndexAtEntry = entryMetrics?.legStartIndex;
      trade.legEndIndexAtEntry = entryMetrics?.legEndIndex;
      trade.legBarCountAtEntry = entryMetrics?.legBarCount;
      trade.maxConsecutiveHighBreaksAtEntry = entryMetrics?.maxConsecutiveHighBreaks;
      trade.maxConsecutiveLowBreaksAtEntry = entryMetrics?.maxConsecutiveLowBreaks;
    }

    trades.push(trade);

    // Exit-engine stamps: fresh opens and flips take the new signal's regime/bar
    // and reset the per-trade exit state; same-side adds and partial reduces keep
    // the opener's stamps so the exit engine keeps managing the original trade.
    const isFlip = isReducing && newQty !== 0 && Math.sign(newQty) === tradeSign;
    const opensNewTrade = currentQty === 0 || isFlip;

    position = newQty !== 0 ? {
      instrument,
      quantity: newQty,
      averagePrice: newAvgPrice,
      realizedPnL: newRealizedPnL,
      unrealizedPnL: 0,
      stopLoss: newStopLoss,
      target: newTarget,
      entryRegime: opensNewTrade ? signal.regime : position?.entryRegime,
      entryBarIndex: opensNewTrade ? candleIndex : position?.entryBarIndex,
      exitWithTrendSeen: opensNewTrade ? undefined : position?.exitWithTrendSeen,
      exitAgainstBars: opensNewTrade ? undefined : position?.exitAgainstBars,
      slTrailed: opensNewTrade ? undefined : position?.slTrailed,
    } : null;
  }

  function exitPosition(candle: Candle, reason: ExitReason, fillPrice?: number) {
    if (!position) return;
    const exitPrice = fillPrice ?? candle.close;
    const isLong = position.quantity > 0;
    const qty = Math.abs(position.quantity);
    const pnlPerShare = isLong
      ? exitPrice - position.averagePrice
      : position.averagePrice - exitPrice;
    trades.push({
      id: `batch-${Date.now()}-${tradeCounter++}`,
      timestamp: candle.timestamp,
      type: isLong ? 'SELL' : 'BUY',
      price: exitPrice,
      quantity: qty,
      instrument,
      pnl: pnlPerShare * qty,
      stopLoss: position.stopLoss,
      target: position.target,
      exitReason: reason,
      slHit: reason === 'SL',
      tpHit: reason === 'TP',
      slTrailed: position.slTrailed || undefined,
      interval,
    });
    position = null;
  }

  for (let i = startIndex; i < candles.length; i++) {
    if (onProgress && (i - startIndex) % reportEvery === 0) {
      onProgress(Math.round(((i - startIndex) / total) * 100));
    }
    const candle = candles[i];

    // ── 1. SL/TP check ───────────────────────────────────────────────────────
    // 'exact' (default): fill at the sl/tp price itself the instant intrabar high/low touches it.
    // 'close': legacy — mirrors checkSLTPHits() backtest path (sharedActions.ts), only fires when
    //          candle.close crosses the level, filled at that close.
    // `position` is a mutable `let` only ever reassigned inside the `enterPosition`/
    // `exitPosition` closures (called later in this same loop body) — TS's control-flow
    // narrowing doesn't see those closured assignments as reachable here, so it narrows
    // the loop-body type of `position` down to `null` and a plain `if (position)` collapses
    // to `never`. Re-widen explicitly to the declared type before narrowing.
    const pos = position as SimPosition | null;
    if (pos) {
      // ── 0. Pivot trailing stop — ratchet the SL before the touch check below
      //      tests it (uses only pivots confirmed through bar i-1; ratchet only).
      const trail = evaluateTrailStop(candles, i, pos, config);
      if (trail) {
        pos.stopLoss = trail.newStopLoss;
        pos.slTrailed = true;
      }
      const isLong = pos.quantity > 0;
      const sl = pos.stopLoss ?? 0;
      const tp = pos.target ?? 0;
      const fillMode = config.slTpFillMode ?? 'exact';

      if (fillMode === 'exact') {
        const { high, low } = candle;
        if (isLong) {
          if (sl > 0 && low <= sl) {
            exitPosition(candle, 'SL', sl);
          } else if (tp > 0 && high >= tp) {
            exitPosition(candle, 'TP', tp);
          }
        } else {
          if (sl > 0 && high >= sl) {
            exitPosition(candle, 'SL', sl);
          } else if (tp > 0 && low <= tp) {
            exitPosition(candle, 'TP', tp);
          }
        }
      } else {
        const close = candle.close;
        if (isLong) {
          if (sl > 0 && close <= sl) {
            exitPosition(candle, 'SL');
          } else if (tp > 0 && close >= tp) {
            exitPosition(candle, 'TP');
          }
        } else {
          if (sl > 0 && close >= sl) {
            exitPosition(candle, 'SL');
          } else if (tp > 0 && close <= tp) {
            exitPosition(candle, 'TP');
          }
        }
      }
    }

    // ── 2. Price-action exit signals (auto exit engine) ─────────────────────
    // Evaluated on bar close, after the SL/TP touch check, before square-off.
    // The reversal state must be persisted even when no exit fires, or the
    // confirm-bars counter would reset every bar.
    const posForExit = position as SimPosition | null;
    if (posForExit) {
      const { exit, state } = evaluateAutoExitSignal(candles, i, posForExit, config);
      posForExit.exitWithTrendSeen = state.exitWithTrendSeen;
      posForExit.exitAgainstBars = state.exitAgainstBars;
      if (exit) exitPosition(candle, exit.reason, candle.close);
    }

    // ── 3. Auto square-off ──────────────────────────────────────────────────
    if (position && config.autoSquareOff) {
      const candleMin = candleTimeMinutes(candle.timestamp);
      if (candleMin >= parseHHMM(config.squareOffTime)) {
        exitPosition(candle, 'TIME_OVER');
      }
    }

    // ── 4. Signal check ─────────────────────────────────────────────────────
    if (!config.enabled) continue;
    if (position !== null && config.skipIfPositionOpen) continue;

    const candleMin = candleTimeMinutes(candle.timestamp);
    if (
      candleMin < parseHHMM(config.tradeStartTime) ||
      candleMin > parseHHMM(config.tradeEndTime)
    ) continue;

    const signal = evaluateAutoSignals(candles, i, config);
    if (!signal) continue;

    // Qty calculation — mirrors runAutoBacktestCheck (autoBacktestActions.ts lines 56-67)
    let qty: number;
    if (config.useAutoQty) {
      const riskPoints = Math.abs(signal.entryPrice - signal.sl);
      qty = riskPoints > 0 ? Math.floor(config.riskPerTrade / riskPoints) : 0;
      if (qty < config.minQuantity) continue;
    } else {
      qty = tradeQuantity;
    }

    enterPosition(candle, signal, qty, i);
  }

  const totalPnL = trades.reduce((sum, t) => sum + (t.pnl ?? 0), 0);

  return {
    trades,
    finalPosition: position as BacktestPosition | null,
    tradeCount: trades.filter(t => t.pnl !== undefined).length,
    totalPnL,
  };
}
