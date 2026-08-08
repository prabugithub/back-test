// @backtest-only — pure simulation, no store access, no side effects.

import type { Candle, Trade, BacktestPosition, OpenPosition, ExitReason } from '../types';
import type { TradeJournal } from '../types';
import { type AutoBacktestConfig, type AutoSignal, type RegimeKey, MULTI_TRADE_DEFAULT_CAP, evaluateAutoSignals, evaluateTrailStop, evaluateAutoExitSignal } from './autoBacktestEngine';
import { buildNetPositionMirror } from './netPosition';
import { calculateMAPosition, calculateBarQuality, averageBarQuality, averageBarQualityIQR, calculateEMASlope, calculateEMAInteraction } from './pivotAnalysis';
import { buildLegSequence } from './legSequence';
import { buildSessionOpenFields } from './sessionDay';

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
  // Multi-trade mode only — pairs this trade's entry and exit fills. Absent in
  // single-position mode, where there is only ever one position to talk about.
  id?: string;
  entryTimestamp?: number;
}

export interface BatchSimResult {
  trades: Trade[];
  // Net view of whatever is still open — one position in single-position mode,
  // the aggregate mirror of `finalPositions` in multi-trade mode.
  finalPosition: BacktestPosition | null;
  // Multi-trade mode: the independent trades left open at the end. Empty otherwise.
  finalPositions: OpenPosition[];
  finalRealizedPnL: number;
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
  // Single-position mode keeps at most one element here (the same blended position
  // it always had); multi-trade mode holds one entry per independent trade.
  let openPositions: SimPosition[] = [];
  let multiRealizedPnL = 0;
  let tradeCounter = 0;
  const interval = sessionInterval || '5';
  const total = candles.length - startIndex;
  const reportEvery = Math.max(1, Math.floor(total / 20));
  // Mirrors isMultiTradeMode() in the store — the batch worker has no isLiveMode.
  const multi = config.enabled && config.skipIfPositionOpen === false;

  function enterPosition(candle: Candle, signal: AutoSignal, qty: number, candleIndex: number) {
    const entryPrice = candle.close;
    // Multi-trade mode: a new signal sees no existing exposure — it opens its own
    // trade rather than blending. Single-position mode blends into the open one.
    const position: SimPosition | null = multi ? null : (openPositions[0] ?? null);
    const positionId = multi ? `bpos-${tradeCounter}` : undefined;

    // Single-position mode: blend into an already-open position rather than
    // overwriting it — the same-direction averaging / opposite-direction reduce math
    // from sharedActions.ts's executeTrade, so batch and interactive runs stay
    // consistent. Multi-trade mode never reaches this: it takes the branch below,
    // where each signal becomes its own trade with its own SL/TP.
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
      entryPosition: calculateMAPosition(candles, candleIndex, signal.type),
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
      positionId,
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
      const emaInteractionFallback = calculateEMAInteraction(candles, candleIndex, 20, config.emaInteractionLookback ?? 20);
      const barQualitySamples = calculateBarQuality(candles, candleIndex, config.barQualityLookback ?? 20);
      trade.brrAvgAtEntry = entryMetrics?.brrAvg ?? averageBarQuality(barQualitySamples).brrAvg;
      trade.brrAvgIQRAtEntry = entryMetrics?.brrAvgIQR ?? averageBarQualityIQR(barQualitySamples).brrAvgIQR;
      trade.ema21SlopeAtEntry = entryMetrics?.ema21Slope ?? calculateEMASlope(candles, candleIndex, 21, config.ema21SlopeLookback ?? 10);
      trade.ema50SlopeAtEntry = entryMetrics?.ema50Slope ?? calculateEMASlope(candles, candleIndex, 50, config.ema50SlopeLookback ?? 20);
      trade.ema20GapBarRatioAtEntry = entryMetrics?.ema20GapBarRatio ?? emaInteractionFallback.gapBarRatio;
      trade.ema20CloseAboveRatioAtEntry = entryMetrics?.ema20CloseAboveRatio ?? emaInteractionFallback.closeAboveRatio;
      trade.ema20InteractionWindowAtEntry = entryMetrics?.ema20InteractionWindow ?? emaInteractionFallback.barsCompared;
      // Recent-price-action context: last N Al Brooks impulse legs + the pullbacks
      // between them, contiguous back from the entry bar (same H/L machinery, no pivots).
      const legSequence = buildLegSequence(
        candles,
        candleIndex,
        config.legSequenceCount ?? 10,
        config.legSequenceDetail ?? 'full'
      );
      if (legSequence.length) trade.legSequenceAtEntry = legSequence;
      // Session-open context (open bar + gap up/down + bars into the session).
      // Same helper the store-side path spreads, so both stamp identical values.
      Object.assign(trade, buildSessionOpenFields(candles, candleIndex));
    }

    trades.push(trade);

    // Exit-engine stamps: fresh opens and flips take the new signal's regime/bar
    // and reset the per-trade exit state; same-side adds and partial reduces keep
    // the opener's stamps so the exit engine keeps managing the original trade.
    const isFlip = isReducing && newQty !== 0 && Math.sign(newQty) === tradeSign;
    const opensNewTrade = currentQty === 0 || isFlip;

    const next: SimPosition | null = newQty !== 0 ? {
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
      id: positionId,
      entryTimestamp: candle.timestamp,
    } : null;

    // Multi-trade mode appends; single-position mode replaces the one position.
    if (multi) {
      if (next) openPositions = [...openPositions, next];
    } else {
      openPositions = next ? [next] : [];
    }
  }

  function exitPosition(pos: SimPosition, candle: Candle, reason: ExitReason, fillPrice?: number) {
    const exitPrice = fillPrice ?? candle.close;
    const isLong = pos.quantity > 0;
    const qty = Math.abs(pos.quantity);
    const pnlPerShare = isLong
      ? exitPrice - pos.averagePrice
      : pos.averagePrice - exitPrice;
    const pnl = pnlPerShare * qty;
    trades.push({
      id: `batch-${Date.now()}-${tradeCounter++}`,
      timestamp: candle.timestamp,
      type: isLong ? 'SELL' : 'BUY',
      price: exitPrice,
      quantity: qty,
      instrument,
      positionId: pos.id,
      pnl,
      stopLoss: pos.stopLoss,
      target: pos.target,
      exitReason: reason,
      slHit: reason === 'SL',
      tpHit: reason === 'TP',
      slTrailed: pos.slTrailed || undefined,
      interval,
    });
    if (multi) multiRealizedPnL += pnl;
    openPositions = openPositions.filter(p => p !== pos);
  }

  // The per-bar lifecycle for ONE position: trail → SL/TP touch → signal exits →
  // square-off. Extracted so single-position and multi-trade runs execute the exact
  // same sequence — the former calls it once, the latter once per open trade.
  // Mutates `pos` (trail + reversal state) and returns the exit it decided on.
  function evaluateBarForPosition(
    pos: SimPosition, i: number, candle: Candle
  ): { reason: ExitReason; fillPrice?: number } | null {
    // ── 0. Pivot trailing stop — ratchet the SL before the touch check below
    //      tests it (uses only pivots confirmed through bar i-1; ratchet only).
    const trail = evaluateTrailStop(candles, i, pos, config);
    if (trail) {
      pos.stopLoss = trail.newStopLoss;
      pos.slTrailed = true;
    }

    // ── 1. SL/TP check ───────────────────────────────────────────────────────
    // 'exact' (default): fill at the sl/tp price itself the instant intrabar high/low touches it.
    // 'close': legacy — mirrors checkSLTPHits() backtest path (sharedActions.ts), only fires when
    //          candle.close crosses the level, filled at that close.
    const isLong = pos.quantity > 0;
    const sl = pos.stopLoss ?? 0;
    const tp = pos.target ?? 0;
    const fillMode = config.slTpFillMode ?? 'exact';

    if (fillMode === 'exact') {
      const { high, low } = candle;
      if (isLong) {
        if (sl > 0 && low <= sl) return { reason: 'SL', fillPrice: sl };
        if (tp > 0 && high >= tp) return { reason: 'TP', fillPrice: tp };
      } else {
        if (sl > 0 && high >= sl) return { reason: 'SL', fillPrice: sl };
        if (tp > 0 && low <= tp) return { reason: 'TP', fillPrice: tp };
      }
    } else {
      const close = candle.close;
      if (isLong) {
        if (sl > 0 && close <= sl) return { reason: 'SL' };
        if (tp > 0 && close >= tp) return { reason: 'TP' };
      } else {
        if (sl > 0 && close >= sl) return { reason: 'SL' };
        if (tp > 0 && close <= tp) return { reason: 'TP' };
      }
    }

    // ── 2. Price-action exit signals (auto exit engine) ─────────────────────
    // Evaluated on bar close, after the SL/TP touch check, before square-off.
    // The reversal state must be persisted even when no exit fires, or the
    // confirm-bars counter would reset every bar.
    const { exit, state } = evaluateAutoExitSignal(candles, i, pos, config);
    pos.exitWithTrendSeen = state.exitWithTrendSeen;
    pos.exitAgainstBars = state.exitAgainstBars;
    if (exit) return { reason: exit.reason, fillPrice: candle.close };

    // ── 3. Auto square-off ──────────────────────────────────────────────────
    if (config.autoSquareOff && candleTimeMinutes(candle.timestamp) >= parseHHMM(config.squareOffTime)) {
      return { reason: 'TIME_OVER' };
    }
    return null;
  }

  for (let i = startIndex; i < candles.length; i++) {
    if (onProgress && (i - startIndex) % reportEvery === 0) {
      onProgress(Math.round(((i - startIndex) / total) * 100));
    }
    const candle = candles[i];

    // ── 1-3. Per-position lifecycle: trail → SL/TP → signal exits → square-off.
    // Snapshot the array first — exitPosition mutates it as we go.
    for (const pos of [...openPositions]) {
      const decision = evaluateBarForPosition(pos, i, candle);
      if (decision) exitPosition(pos, candle, decision.reason, decision.fillPrice);
    }

    // ── 4. Signal check ─────────────────────────────────────────────────────
    if (!config.enabled) continue;
    if (!multi && openPositions.length > 0) continue;
    if (multi) {
      const cap = config.maxOpenPositions ?? MULTI_TRADE_DEFAULT_CAP;
      if (cap > 0 && openPositions.length >= cap) continue;
    }

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

  const finalPositions: OpenPosition[] = multi
    ? openPositions.map(p => ({
        ...p,
        id: p.id!,
        entryTimestamp: p.entryTimestamp!,
        autoEntry: true,
      }))
    : [];

  return {
    trades,
    finalPosition: multi
      ? buildNetPositionMirror(finalPositions, multiRealizedPnL, instrument, candles[candles.length - 1]?.close)
      : ((openPositions[0] ?? null) as BacktestPosition | null),
    finalPositions,
    finalRealizedPnL: multiRealizedPnL,
    tradeCount: trades.filter(t => t.pnl !== undefined).length,
    totalPnL,
  };
}
