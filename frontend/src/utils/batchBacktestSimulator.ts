// @backtest-only — pure simulation, no store access, no side effects.

import type { Candle, Trade, BacktestPosition } from '../types';
import type { TradeJournal } from '../types';
import { type AutoBacktestConfig, type AutoSignal, evaluateAutoSignals } from './autoBacktestEngine';
import { analyzeManualEntry, calculateBarOverlap, averageBarOverlap, calculateBarRanges, averageBarRanges } from './pivotAnalysis';

interface SimPosition {
  instrument: string;
  quantity: number;      // + = LONG, - = SHORT
  averagePrice: number;
  realizedPnL: number;
  unrealizedPnL: number;
  stopLoss?: number;
  target?: number;
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
    const maAnalysis = analyzeManualEntry(candles, candleIndex, signal.type);
    const barOverlapAtEntry = calculateBarOverlap(candles, candleIndex, config.barOverlapLookback ?? 8);
    const barOverlapAvgAtEntry = averageBarOverlap(barOverlapAtEntry);
    const barRangeSamples = calculateBarRanges(candles, candleIndex, config.barRangeLookback ?? 20);
    const { barRangeAvg, bullBarRangeAvg, bearBarRangeAvg } = averageBarRanges(barRangeSamples);
    const journal: TradeJournal = {
      ltMarket: signal.ltMarket,
      htMarket: signal.htMarket,
      entryPosition: maAnalysis.entryPosition,
      llhhPivot: signal.llhhPivot,
      entrySign: signal.reason,
      notes: `[Batch BT] ${signal.reason}`,
      systemEntryAlign: 'Yes',
      myViewEntryAlign: 'Yes',
      systemMoveAlign: 'Yes',
      myViewMoveAlign: 'Yes',
      tradeCategory: 'System',
    };
    trades.push({
      id: `batch-${Date.now()}-${tradeCounter++}`,
      timestamp: candle.timestamp,
      type: signal.type,
      price: entryPrice,
      quantity: qty,
      instrument,
      stopLoss: signal.sl,
      target: signal.tp,
      exitReason: 'MANUAL',
      journal,
      barOverlapAtEntry,
      barOverlapAvgAtEntry,
      barRangeAvgAtEntry: barRangeAvg,
      bullBarRangeAvgAtEntry: bullBarRangeAvg,
      bearBarRangeAvgAtEntry: bearBarRangeAvg,
      interval,
    });
    position = {
      instrument,
      quantity: signal.type === 'BUY' ? qty : -qty,
      averagePrice: entryPrice,
      realizedPnL: 0,
      unrealizedPnL: 0,
      stopLoss: signal.sl,
      target: signal.tp,
    };
  }

  function exitPosition(candle: Candle, reason: 'SL' | 'TP' | 'TIME_OVER') {
    if (!position) return;
    const exitPrice = candle.close;
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
      interval,
    });
    position = null;
  }

  for (let i = startIndex; i < candles.length; i++) {
    if (onProgress && (i - startIndex) % reportEvery === 0) {
      onProgress(Math.round(((i - startIndex) / total) * 100));
    }
    const candle = candles[i];

    // ── 1. SL/TP check — exits when candle.close crosses the level ──────────
    // Mirrors checkSLTPHits() backtest path (sharedActions.ts lines 168-188)
    if (position) {
      const isLong = position.quantity > 0;
      const sl = position.stopLoss ?? 0;
      const tp = position.target ?? 0;
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

    // ── 2. Auto square-off ──────────────────────────────────────────────────
    if (position && config.autoSquareOff) {
      const candleMin = candleTimeMinutes(candle.timestamp);
      if (candleMin >= parseHHMM(config.squareOffTime)) {
        exitPosition(candle, 'TIME_OVER');
      }
    }

    // ── 3. Signal check ─────────────────────────────────────────────────────
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
