// Shared actions used by both backtest and live modes.
// This file may import from liveExecutionService for the live dispatch path,
// but backtest-only code files must never import from here directly —
// they access these actions via get() at runtime.

import { saveTradeSession } from '../utils/tradeStorage';
import { groupTradesIntoPositions, calculatePerformanceStats, recalculateTradesPnL } from '../utils/tradeAnalysis';
import {
  saveSession, loadSession, restoreBackup, saveSnapshot,
  listSnapshots, listHistory, deleteSnapshot, updateCurrentSessionDrawings,
  type SessionState,
} from '../services/firebaseSessionService';
import { useNotificationStore } from './notificationStore';
import { calculatePivotPoints, calculateATR, calculateEMA } from '../utils/indicators';
import { analyzeMarketStructure, calculateBarOverlap, averageBarOverlap, calculateBarRanges, averageBarRanges, calculateEfficiencyRatio, calculateBarBreaks, calculateEMASlope, calculateEMAInteraction, getPivotSequenceStats, averagePivotGapBars } from '../utils/pivotAnalysis';
import {
  executeLiveOrder,
  registerMonitorIfNeeded,
  syncTargetWithMonitor,
  pollOrderFillStatus,
} from '../services/liveExecutionService';
import type { Trade, Position, TradeJournal } from '../types';
import type { SessionStore, SessionConfig, StoreSet, StoreGet } from './sessionStore';
import type { EntryMetricsSnapshot } from '../utils/autoBacktestEngine';

const generateTradeId = () =>
  `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

export function createSharedActions(set: StoreSet, get: StoreGet) {
  // Scoped to this closure — avoids shared state across hot-reloads or multiple instances
  let pendingLiveOrderId: string | undefined = undefined;
  let _drawingsSaveTimer: ReturnType<typeof setTimeout> | null = null;
  let _secondaryDrawingsSaveTimer: ReturnType<typeof setTimeout> | null = null;
  return {
    setDrawings: (drawings: SessionStore['drawings']) => {
      set({ drawings });
      if (_drawingsSaveTimer) clearTimeout(_drawingsSaveTimer);
      _drawingsSaveTimer = setTimeout(() => {
        updateCurrentSessionDrawings(drawings, 'drawings').catch(() => {});
      }, 2000);
    },

    setSecondaryDrawings: (drawings: SessionStore['secondaryDrawings']) => {
      set({ secondaryDrawings: drawings });
      if (_secondaryDrawingsSaveTimer) clearTimeout(_secondaryDrawingsSaveTimer);
      _secondaryDrawingsSaveTimer = setTimeout(() => {
        updateCurrentSessionDrawings(drawings, 'secondaryDrawings').catch(() => {});
      }, 2000);
    },

    setTargetRR: (rr: number) => {
      set({ targetRR: rr });
      const { position, manualLevels } = get();
      if (manualLevels) return;
      if (position && position.stopLoss && position.stopLoss > 0 && position.averagePrice) {
        const isLong = position.quantity > 0;
        const slDist = Math.abs(position.averagePrice - position.stopLoss);
        const newTarget = isLong
          ? position.averagePrice + slDist * rr
          : position.averagePrice - slDist * rr;
        get().updatePositionTarget(newTarget);
      }
    },

    setAutoExitTarget: (auto: boolean) => set({ autoExitTarget: auto }),

    setCrosshairPosition: (pos: SessionStore['crosshairPosition']) =>
      set({ crosshairPosition: pos }),

    checkSLTPHits: (index: number, currentPrice?: number) => {
      const { candles, position } = get();
      if (!position || (!position.stopLoss && !position.target)) return;
      // Entry order not yet confirmed filled — exits must not fire on a phantom position
      if ((position as any).pendingOrderId) return;

      const candle = candles[index];
      if (!candle && !currentPrice) return;

      const { stopLoss, target, quantity } = position;
      const isLong = quantity > 0;
      const sl = Number(stopLoss);
      const tp = Number(target);

      const { high, low, close } = candle || {
        high: currentPrice!,
        low: currentPrice!,
        close: currentPrice!,
      };
      const effectiveClose = currentPrice || close;
      const effectiveHigh = currentPrice ? Math.max(currentPrice, high) : high;
      const effectiveLow = currentPrice ? Math.min(currentPrice, low) : low;

      let nextSlHit = !!position.slHit;
      let nextTpHit = !!position.tpHit;
      let nextHitFirst = position.hitFirst;
      let nextSlDialogShown = !!position.slDialogShown;
      let nextTpDialogShown = !!position.tpDialogShown;

      // Touch detection (same in both modes)
      if (isLong) {
        if (sl > 0 && effectiveLow <= sl) nextSlHit = true;
        if (tp > 0 && effectiveHigh >= tp) nextTpHit = true;
      } else {
        if (sl > 0 && effectiveHigh >= sl) nextSlHit = true;
        if (tp > 0 && effectiveLow <= tp) nextTpHit = true;
      }

      if (!nextHitFirst) {
        const hitThisBar = isLong
          ? sl > 0 && effectiveLow <= sl
            ? 'SL'
            : tp > 0 && effectiveHigh >= tp
            ? 'TP'
            : null
          : sl > 0 && effectiveHigh >= sl
          ? 'SL'
          : tp > 0 && effectiveLow <= tp
          ? 'TP'
          : null;

        if (hitThisBar) {
          nextHitFirst = hitThisBar as 'SL' | 'TP';
          useNotificationStore
            .getState()
            .notify(
              `${hitThisBar} Hit at ${(hitThisBar === 'SL' ? sl : tp).toFixed(2)} (High/Low movement)!`,
              hitThisBar === 'TP' ? 'success' : 'warning'
            );
        }
      }

      // ── LIVE OPTION GUARD ────────────────────────────────────────────────────
      // Backend positionMonitor owns all exits. Update hit-flags for display only
      // and return so the backtest dialog/auto-exit code below cannot fire.
      // exitTriggeredByBackend is a secondary guard against races.
      const { isLiveMode, autoExitTarget } = get();
      const isLiveOption = isLiveMode && (position as any).liveOptionToken;

      if (isLiveOption) {
        if ((position as any).exitTriggeredByBackend) return;
        const hasChanged =
          nextSlHit !== position.slHit ||
          nextTpHit !== position.tpHit ||
          nextHitFirst !== position.hitFirst ||
          nextSlDialogShown !== position.slDialogShown ||
          nextTpDialogShown !== position.tpDialogShown;
        if (hasChanged) {
          set({
            position: {
              ...position,
              slHit: nextSlHit,
              tpHit: nextTpHit,
              hitFirst: nextHitFirst,
              slDialogShown: nextSlDialogShown,
              tpDialogShown: nextTpDialogShown,
            },
          });
        }
        return; // backend monitor owns the exit — never fall through
      }
      // ── BACKTEST PATH ────────────────────────────────────────────────────────
      // Code below never runs when isLiveOption is true.

      let dialogToTrigger: 'SL' | 'TP' | null = null;
      let autoExitTP = false;
      let autoExitSL = false;
      let fillPriceForTrigger = 0;
      const { autoExitSL: autoExitSLEnabled, autoBacktestConfig } = get();
      const fillMode = autoBacktestConfig.slTpFillMode ?? 'exact';

      const slFires = fillMode === 'exact'
        ? (isLong ? (sl > 0 && effectiveLow <= sl) : (sl > 0 && effectiveHigh >= sl))
        : (isLong ? (sl > 0 && effectiveClose <= sl) : (sl > 0 && effectiveClose >= sl));
      const tpFires = fillMode === 'exact'
        ? (isLong ? (tp > 0 && effectiveHigh >= tp) : (tp > 0 && effectiveLow <= tp))
        : (isLong ? (tp > 0 && effectiveClose >= tp) : (tp > 0 && effectiveClose <= tp));

      if (slFires && !nextSlDialogShown) {
        if (autoExitSLEnabled) autoExitSL = true;
        else dialogToTrigger = 'SL';
        nextSlDialogShown = true;
        fillPriceForTrigger = fillMode === 'exact' ? sl : effectiveClose;
      } else if (tpFires && !nextTpDialogShown) {
        dialogToTrigger = 'TP';
        nextTpDialogShown = true;
        fillPriceForTrigger = fillMode === 'exact' ? tp : effectiveClose;
      }

      const hasChanged =
        nextSlHit !== position.slHit ||
        nextTpHit !== position.tpHit ||
        nextHitFirst !== position.hitFirst ||
        nextSlDialogShown !== position.slDialogShown ||
        nextTpDialogShown !== position.tpDialogShown;

      if (hasChanged || dialogToTrigger || autoExitTP || autoExitSL) {
        const updatedPosition = {
          ...position,
          slHit: nextSlHit,
          tpHit: nextTpHit,
          hitFirst: nextHitFirst,
          slDialogShown: nextSlDialogShown,
          tpDialogShown: nextTpDialogShown,
        };

        if (autoExitSL) {
          set({ position: updatedPosition });
          useNotificationStore
            .getState()
            .notify(`Stop Loss Hit at ${sl.toFixed(2)}. Auto Exiting.`, 'warning');
          get().executeTrade(isLong ? 'SELL' : 'BUY', Math.abs(position.quantity), undefined, undefined, fillPriceForTrigger, 'SL');
        } else if (autoExitTP) {
          set({ position: updatedPosition });
          useNotificationStore
            .getState()
            .notify(`Target Hit at ${tp.toFixed(2)}. Auto Exiting based on Risk settings.`, 'success');
          get().executeTrade(isLong ? 'SELL' : 'BUY', Math.abs(position.quantity), undefined, undefined, fillPriceForTrigger, 'TP');
        } else if (dialogToTrigger) {
          set({
            isPlaying: false,
            pendingExitRequest: {
              type: dialogToTrigger,
              price: fillPriceForTrigger,
              spotPrice: close,
            },
            position: updatedPosition,
          });
        } else {
          set({ position: updatedPosition });
        }
      }
    },

    executeTrade: async (
      type: 'BUY' | 'SELL',
      quantity: number,
      stopLoss?: number,
      target?: number,
      priceOverride?: number,
      exitReason: 'SL' | 'TP' | 'MANUAL' | 'TIME_OVER' = 'MANUAL',
      journal?: TradeJournal,
      entryMetricsOverride?: EntryMetricsSnapshot
    ) => {
      const { candles, currentIndex, trades, position, instrument, sessionConfig, isLiveMode, livePrice, autoBacktestConfig } = get();
      const currentCandle = candles[currentIndex];

      if (!currentCandle) {
        console.error('No current candle available');
        return;
      }

      const currentPrice = priceOverride || (isLiveMode && livePrice) || currentCandle.close;
      const timestamp = currentCandle.timestamp;
      const tradeSign = type === 'BUY' ? 1 : -1;
      const currentQty = position ? position.quantity : 0;
      const isReducing = (currentQty > 0 && tradeSign < 0) || (currentQty < 0 && tradeSign > 0);
      const isSameDirection = (currentQty > 0 && tradeSign > 0) || (currentQty < 0 && tradeSign < 0);

      let finalQuantity = quantity;
      let atmOptionToken: string | undefined = undefined;
      let tradeOptionType: 'CE' | 'PE' | undefined = undefined;

      // ── LIVE PATH ────────────────────────────────────────────────────────────
      if (isLiveMode && sessionConfig) {
        // Block fresh entries after 2:36 PM IST; exits (currentQty !== 0) are always allowed
        if (currentQty === 0) {
          const istNow = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
          const totalMinutes = istNow.getUTCHours() * 60 + istNow.getUTCMinutes();
          if (totalMinutes >= 14 * 60 + 36) {
            useNotificationStore.getState().notify('Fresh entries blocked after 2:36 PM', 'warning');
            return;
          }
        }
        try {
          const notify = (msg: string, t: any) => useNotificationStore.getState().notify(msg, t);
          const result = await executeLiveOrder(
            { type, quantity, exitReason, currentPrice, instrument, sessionConfig, position },
            notify
          );
          if (result === null) return;
          finalQuantity = result.finalQuantity;
          atmOptionToken = result.atmOptionToken;
          tradeOptionType = result.tradeOptionType;
          if (result.pendingOrderId) pendingLiveOrderId = result.pendingOrderId;
        } catch (error: any) {
          useNotificationStore.getState().notify(`Error placing live option order: ${error.message}`, 'error');
          return;
        }
      }
      // ── SHARED POSITION-BUILDING (both modes) ────────────────────────────────

      const tradeQtySigned = finalQuantity * tradeSign;
      const newQty = currentQty + tradeQtySigned;
      const isSameSide = (currentQty > 0 && newQty > 0) || (currentQty < 0 && newQty < 0);
      const isFlip = isReducing && !isSameSide && newQty !== 0;

      const visibleCandlesForEntry = candles.slice(0, currentIndex + 1);
      const pivotsForEntry = calculatePivotPoints(visibleCandlesForEntry);
      const { ltMarket } = analyzeMarketStructure(visibleCandlesForEntry, pivotsForEntry);

      const atrSeries = calculateATR(visibleCandlesForEntry, 14);
      const emaSeries = calculateEMA(visibleCandlesForEntry, 21);
      const atrVal = atrSeries[atrSeries.length - 1]?.value ?? 0;
      const emaVal = emaSeries[emaSeries.length - 1]?.value ?? 0;
      const atrDepthAtEntry = atrVal > 0 ? Math.abs(currentPrice - emaVal) / atrVal : 0;
      const barOverlapAtEntry = calculateBarOverlap(candles, currentIndex, autoBacktestConfig.barOverlapLookback ?? 8);
      const barOverlapAvgAtEntry = entryMetricsOverride?.barOverlapAvg ?? averageBarOverlap(barOverlapAtEntry);
      const barRangeSamples = calculateBarRanges(candles, currentIndex, autoBacktestConfig.barRangeLookback ?? 20);
      const barRangeFallback = averageBarRanges(barRangeSamples);
      const barRangeAvg = entryMetricsOverride?.barRangeAvg ?? barRangeFallback.barRangeAvg;
      const bullBarRangeAvg = entryMetricsOverride?.bullBarRangeAvg ?? barRangeFallback.bullBarRangeAvg;
      const bearBarRangeAvg = entryMetricsOverride?.bearBarRangeAvg ?? barRangeFallback.bearBarRangeAvg;
      const efficiencyRatioAtEntry = entryMetricsOverride?.efficiencyRatio ?? calculateEfficiencyRatio(candles, currentIndex, autoBacktestConfig.efficiencyRatioLookback ?? 10);
      const barBreakFallback = calculateBarBreaks(candles, currentIndex, autoBacktestConfig.barBreakLookback ?? 20);
      const highBreakCount = entryMetricsOverride?.highBreakCount ?? barBreakFallback.highBreakCount;
      const lowBreakCount = entryMetricsOverride?.lowBreakCount ?? barBreakFallback.lowBreakCount;
      const barsCompared = entryMetricsOverride?.barBreakWindow ?? barBreakFallback.barsCompared;
      const ema21SlopeAtEntry = entryMetricsOverride?.ema21Slope ?? calculateEMASlope(candles, currentIndex, 21, autoBacktestConfig.ema21SlopeLookback ?? 10);
      const ema50SlopeAtEntry = entryMetricsOverride?.ema50Slope ?? calculateEMASlope(candles, currentIndex, 50, autoBacktestConfig.ema50SlopeLookback ?? 20);
      const emaInteractionFallback = calculateEMAInteraction(candles, currentIndex, 20, autoBacktestConfig.emaInteractionLookback ?? 20);
      const gapBarRatio = entryMetricsOverride?.ema20GapBarRatio ?? emaInteractionFallback.gapBarRatio;
      const closeAboveRatio = entryMetricsOverride?.ema20CloseAboveRatio ?? emaInteractionFallback.closeAboveRatio;
      const emaInteractionWindow = entryMetricsOverride?.ema20InteractionWindow ?? emaInteractionFallback.barsCompared;
      const pivotSeqStatsFallback = getPivotSequenceStats(pivotsForEntry, 4);
      const pivotHighSeq = entryMetricsOverride?.pivotHighSeq ?? pivotSeqStatsFallback.highSeq;
      const pivotLowSeq = entryMetricsOverride?.pivotLowSeq ?? pivotSeqStatsFallback.lowSeq;
      const pivotGapAvgBarsAtEntry = entryMetricsOverride?.pivotGapAvgBars ?? averagePivotGapBars(pivotSeqStatsFallback);
      const isInitialWith =
        (type === 'BUY' && ltMarket.startsWith('Bull')) ||
        (type === 'SELL' && ltMarket.startsWith('Bear'));

      let tradeStopLoss = stopLoss;
      let tradeTarget = target;

      const isL = newQty > 0;
      const isS = newQty < 0;
      const isTargetWrong =
        target !== undefined && ((isL && target < currentPrice) || (isS && target > currentPrice));
      const isSLWrong =
        stopLoss !== undefined && ((isL && stopLoss > currentPrice) || (isS && stopLoss < currentPrice));

      if (isSameSide) {
        if (isReducing) {
          tradeTarget = target === undefined || isTargetWrong ? position?.target : target;
          tradeStopLoss = stopLoss === undefined || isSLWrong ? position?.stopLoss : stopLoss;
        } else if (isSameDirection) {
          tradeTarget = target === undefined || isTargetWrong ? position?.target : target;
          tradeStopLoss = stopLoss === undefined || isSLWrong ? position?.stopLoss : stopLoss;
        }
      } else if (newQty !== 0) {
        tradeTarget = isTargetWrong ? undefined : target;
        tradeStopLoss = isSLWrong ? undefined : stopLoss;
      }

      const trade: Trade = {
        id: generateTradeId(),
        timestamp,
        type,
        price: currentPrice,
        quantity: finalQuantity,
        instrument,
        liveOptionToken: atmOptionToken || (position as any)?.liveOptionToken,
        optionType: tradeOptionType,
        stopLoss: tradeStopLoss,
        target: tradeTarget,
        exitReason,
        slHit: position?.slHit || exitReason === 'SL',
        tpHit: position?.tpHit || exitReason === 'TP',
        slDialogShown: position?.slDialogShown || exitReason === 'SL',
        tpDialogShown: position?.tpDialogShown || exitReason === 'TP',
        hitFirst: position?.hitFirst || (exitReason === 'SL' || exitReason === 'TP' ? exitReason : undefined),
        trendReversed: position?.trendReversed,
        trendReversedPnL: position?.trendReversedPnL,
        withTrendSeen: isSameSide ? position?.withTrendSeen || isInitialWith : isInitialWith,
        journal: journal || undefined,
        atrDepthAtEntry: !isReducing ? atrDepthAtEntry : undefined,
        barOverlapAtEntry: !isReducing ? barOverlapAtEntry : undefined,
        barOverlapAvgAtEntry: !isReducing ? barOverlapAvgAtEntry : undefined,
        barRangeAvgAtEntry: !isReducing ? barRangeAvg : undefined,
        bullBarRangeAvgAtEntry: !isReducing ? bullBarRangeAvg : undefined,
        bearBarRangeAvgAtEntry: !isReducing ? bearBarRangeAvg : undefined,
        efficiencyRatioAtEntry: !isReducing ? efficiencyRatioAtEntry : undefined,
        highBreakCountAtEntry: !isReducing ? highBreakCount : undefined,
        lowBreakCountAtEntry: !isReducing ? lowBreakCount : undefined,
        barBreakWindowAtEntry: !isReducing ? barsCompared : undefined,
        ema21SlopeAtEntry: !isReducing ? ema21SlopeAtEntry : undefined,
        ema50SlopeAtEntry: !isReducing ? ema50SlopeAtEntry : undefined,
        ema20GapBarRatioAtEntry: !isReducing ? gapBarRatio : undefined,
        ema20CloseAboveRatioAtEntry: !isReducing ? closeAboveRatio : undefined,
        ema20InteractionWindowAtEntry: !isReducing ? emaInteractionWindow : undefined,
        pivotHighSeqAtEntry: !isReducing ? (pivotHighSeq.length ? pivotHighSeq.join('-') : undefined) : undefined,
        pivotLowSeqAtEntry: !isReducing ? (pivotLowSeq.length ? pivotLowSeq.join('-') : undefined) : undefined,
        pivotGapAvgBarsAtEntry: !isReducing ? pivotGapAvgBarsAtEntry : undefined,
        interval: sessionConfig?.interval || '5',
      };

      const currentAvgPrice = position ? position.averagePrice : 0;
      let newAvgPrice = currentAvgPrice;
      let newRealizedPnL = position ? position.realizedPnL : 0;
      let tradePnL: number | undefined = undefined;

      if (currentQty === 0) {
        newAvgPrice = currentPrice;
      } else if (isSameDirection) {
        const totalValue = Math.abs(currentQty) * currentAvgPrice + finalQuantity * currentPrice;
        newAvgPrice = totalValue / (Math.abs(currentQty) + finalQuantity);
      } else {
        const qtyClosing = Math.min(Math.abs(currentQty), finalQuantity);
        const pnlPerShare =
          currentQty > 0 ? currentPrice - currentAvgPrice : currentAvgPrice - currentPrice;
        tradePnL = pnlPerShare * qtyClosing;
        newRealizedPnL += tradePnL;
        if (finalQuantity - qtyClosing > 0) newAvgPrice = currentPrice;
      }

      trade.pnl = tradePnL;

      const newPositionState: Position = {
        instrument,
        quantity: newQty,
        averagePrice: newAvgPrice,
        realizedPnL: newRealizedPnL,
        unrealizedPnL: 0,
        stopLoss: trade.stopLoss,
        target: trade.target,
        slHit: (isFlip || trade.stopLoss !== position?.stopLoss)
          ? exitReason === 'SL' ? true : undefined
          : position?.slHit || exitReason === 'SL',
        tpHit: (isFlip || trade.target !== position?.target)
          ? exitReason === 'TP' ? true : undefined
          : position?.tpHit || exitReason === 'TP',
        slDialogShown: (isFlip || trade.stopLoss !== position?.stopLoss)
          ? exitReason === 'SL' ? true : undefined
          : position?.slDialogShown || exitReason === 'SL',
        tpDialogShown: (isFlip || trade.target !== position?.target)
          ? exitReason === 'TP' ? true : undefined
          : position?.tpDialogShown || exitReason === 'TP',
        hitFirst:
          isFlip || trade.stopLoss !== position?.stopLoss || trade.target !== position?.target
            ? exitReason === 'SL' || exitReason === 'TP' ? exitReason : undefined
            : position?.hitFirst || (exitReason === 'SL' || exitReason === 'TP' ? exitReason : undefined),
        trendReversed: isFlip ? undefined : position?.trendReversed,
        trendReversedPnL: isFlip ? undefined : position?.trendReversedPnL,
        withTrendSeen: trade.withTrendSeen,
        liveOptionToken: atmOptionToken || (position as any)?.liveOptionToken,
        pendingOrderId: pendingLiveOrderId,
      } as Position;

      pendingLiveOrderId = undefined;

      const nextPosition = newQty !== 0 ? newPositionState : null;
      set({ trades: [...trades, trade], position: nextPosition, manualLevels: null });

      // ── LIVE: register backend position monitor ───────────────────────────────
      // Only register immediately when order is NOT awaiting fill confirmation.
      // If pendingOrderId is set, registration is deferred to onFilled/onPartialFill
      // below to prevent the backend monitor from firing exits on an unfilled entry.
      if (get().isLiveMode) {
        const sessionCfg = get().sessionConfig;
        if (nextPosition && sessionCfg && !(newPositionState as any).pendingOrderId) {
          registerMonitorIfNeeded(nextPosition, sessionCfg);
        }
      }

      // ── LIVE: poll Dhan for fill status ~2 s after placement ─────────────────
      if ((newPositionState as any).pendingOrderId && get().isLiveMode) {
        const orderIdToCheck = (newPositionState as any).pendingOrderId as string;
        const notify = (msg: string, t: any) => useNotificationStore.getState().notify(msg, t);
        pollOrderFillStatus(orderIdToCheck, {
          getPosition: () => get().position,
          isLiveMode: () => get().isLiveMode,
          onRejected: () => {
            set((s) => ({
              position: (s.position as any)?.pendingOrderId === orderIdToCheck ? null : s.position,
            }));
          },
          onPartialFill: (filled) => {
            set((s) => {
              if (!s.position || (s.position as any).pendingOrderId !== orderIdToCheck) return s;
              return { position: { ...s.position, filledQty: filled, pendingOrderId: undefined, fillConfirmedAt: Date.now() } };
            });
            // Register backend monitor now that partial fill is confirmed
            const currentPos = get().position;
            const sessionCfg = get().sessionConfig;
            if (currentPos && sessionCfg) registerMonitorIfNeeded(currentPos, sessionCfg);
          },
          onFilled: (filled) => {
            set((s) => {
              if (!s.position || (s.position as any).pendingOrderId !== orderIdToCheck) return s;
              return { position: { ...s.position, filledQty: filled, pendingOrderId: undefined, fillConfirmedAt: Date.now() } };
            });
            // Register backend monitor now that fill is confirmed
            const currentPos = get().position;
            const sessionCfg = get().sessionConfig;
            if (currentPos && sessionCfg) registerMonitorIfNeeded(currentPos, sessionCfg);
          },
          notify,
        });
      }
    },

    checkTrendReversal: (index: number, currentPrice?: number) => {
      const { candles, position, trades } = get();
      if (!position || position.quantity === 0 || position.trendReversed) return;

      const visibleCandles = candles.slice(0, index + 1);
      const pivots = calculatePivotPoints(visibleCandles);
      const { ltMarket } = analyzeMarketStructure(visibleCandles, pivots);
      const direction = position.quantity > 0 ? 'LONG' : 'SHORT';

      const isAgainst =
        (direction === 'LONG' && ltMarket.startsWith('Bear')) ||
        (direction === 'SHORT' && ltMarket.startsWith('Bull'));
      const isWith =
        (direction === 'LONG' && ltMarket.startsWith('Bull')) ||
        (direction === 'SHORT' && ltMarket.startsWith('Bear'));

      if (isWith && !position.withTrendSeen) {
        set({ position: { ...position, withTrendSeen: true } });
        return;
      }

      if (isAgainst && position.withTrendSeen) {
        const currentCandle = candles[index];
        const testPrice = currentPrice || (currentCandle ? currentCandle.close : 0);
        const unrealizedPnL = (testPrice - position.averagePrice) * position.quantity;
        const updatedPosition = { ...position, trendReversed: true, trendReversedPnL: unrealizedPnL };
        const updatedTrades = trades.map((t) => {
          const isEntry =
            (direction === 'LONG' && t.type === 'BUY') ||
            (direction === 'SHORT' && t.type === 'SELL');
          return isEntry && !t.trendReversed
            ? { ...t, trendReversed: true, trendReversedPnL: unrealizedPnL }
            : t;
        });
        set({ position: updatedPosition, trades: updatedTrades });
        useNotificationStore
          .getState()
          .notify(`Trend Reversal Detected! P&L at reversal: ${unrealizedPnL.toFixed(2)}`, 'warning');
      }
    },

    deleteTrade: (tradeId: string) => {
      const { trades, instrument } = get();
      const newTrades = trades.filter((t) => t.id !== tradeId);
      if (newTrades.length === 0) { set({ trades: [], position: null }); return; }
      const { processedTrades, finalQty, finalAvgPrice, totalRealizedPnL } = recalculateTradesPnL(newTrades);
      set({
        trades: processedTrades,
        position: finalQty !== 0
          ? { instrument, quantity: finalQty, averagePrice: finalAvgPrice, realizedPnL: totalRealizedPnL, unrealizedPnL: 0, stopLoss: undefined, target: undefined, slHit: false, tpHit: false }
          : null,
      });
    },

    deleteTrades: (tradeIds: string[]) => {
      const { trades, instrument } = get();
      const newTrades = trades.filter((t) => !tradeIds.includes(t.id));
      if (newTrades.length === 0) { set({ trades: [], position: null }); return; }
      const { processedTrades, finalQty, finalAvgPrice, totalRealizedPnL } = recalculateTradesPnL(newTrades);
      set({
        trades: processedTrades,
        position: finalQty !== 0
          ? { instrument, quantity: finalQty, averagePrice: finalAvgPrice, realizedPnL: totalRealizedPnL, unrealizedPnL: 0, stopLoss: undefined, target: undefined, slHit: false, tpHit: false }
          : null,
      });
    },

    saveCurrentSession: () => {
      const { instrument, trades } = get();
      if (trades.length === 0) return;
      const positions = groupTradesIntoPositions(trades);
      const stats = calculatePerformanceStats(positions);
      saveTradeSession(instrument, trades, { totalPnL: stats.totalPnL, winRate: stats.winRate });
    },

    saveRemoteSession: async () => {
      const {
        instrument, trades, position, currentIndex, sessionConfig,
        drawings, secondaryDrawings, primaryIndicators, secondaryIndicators, secondaryTimeframe,
        showSecondaryChart, tradeQuantity, riskPerTrade, targetRR, autoExitTarget, useAtrForSignals, showPivotRR,
        autoBacktestConfig,
      } = get();
      if (!sessionConfig) {
        useNotificationStore.getState().notify('Cannot save: Missing session configuration. Please reload data.', 'error');
        return;
      }
      const sanitizedTrades = trades.map((t) => {
        const cleanT: any = { ...t };
        if (cleanT.pnl === undefined) cleanT.pnl = null;
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
        uiSettings: { drawings, secondaryDrawings, primaryIndicators, secondaryIndicators, secondaryTimeframe, showSecondaryChart, tradeQuantity, riskPerTrade, targetRR, autoExitTarget, useAtrForSignals, showPivotRR, autoBacktestConfig },
      };
      set({ isLoading: true });
      try {
        await saveSession({ ...state, securityId: sessionConfig.securityId, exchangeSegment: sessionConfig.exchangeSegment, dataSource: sessionConfig.dataSource, instrumentType: sessionConfig.instrumentType || 'EQUITY' } as any);
        useNotificationStore.getState().notify('Session saved to cloud successfully!', 'success');
      } catch (e: any) {
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
          dataSource: (state as any).dataSource || 'local',
        };
        return { config, data: { trades: state.trades, position: state.position, currentIndex: state.currentIndex, uiSettings: state.uiSettings } };
      } catch (error) {
        console.error(error);
        return null;
      } finally {
        set({ isLoading: false });
      }
    },

    restoreSessionState: (trades: Trade[], position: Position | null, currentIndex: number, uiSettings?: any) => {
      const extraState = uiSettings?.autoBacktestConfig
        ? { autoExitSL: uiSettings.autoBacktestConfig.enabled }
        : {};
      set((state) => ({ ...state, trades, position, currentIndex, ...(uiSettings || {}), ...extraState }));
      // Re-register backend monitor if restoring a filled live position (covers page-refresh path).
      // Skip if pendingOrderId is set — fill not yet confirmed, monitor will be registered in onFilled.
      if (position && (position as any).liveOptionToken && !(position as any).pendingOrderId && get().isLiveMode) {
        const sessionCfg = get().sessionConfig;
        if (sessionCfg) registerMonitorIfNeeded(position, sessionCfg);
      }
    },

    restoreRemoteBackup: async (historyId?: string) => {
      set({ isLoading: true });
      try {
        const state = await restoreBackup(historyId);
        if (state) {
          set({ trades: state.trades, position: state.position, currentIndex: state.currentIndex });
          if (state.uiSettings) set((s) => ({ ...s, ...state.uiSettings }));
          useNotificationStore.getState().notify('Session version restored successfully!', 'success');
        }
      } catch (e: any) {
        useNotificationStore.getState().notify(`Failed to restore backup: ${e.message}`, 'error');
      } finally {
        set({ isLoading: false });
      }
    },

    getRemoteHistory: async () => {
      try { return await listHistory(); } catch { return []; }
    },

    saveRemoteSnapshot: async (name: string) => {
      const {
        instrument, trades, position, currentIndex, sessionConfig,
        drawings, secondaryDrawings, primaryIndicators, secondaryIndicators, secondaryTimeframe,
        showSecondaryChart, tradeQuantity, riskPerTrade, targetRR, autoExitTarget, useAtrForSignals, showPivotRR,
        autoBacktestConfig,
      } = get();
      if (!sessionConfig) {
        useNotificationStore.getState().notify('Cannot save snapshot: Missing configuration', 'error');
        return;
      }
      const state: SessionState = {
        name,
        lastUpdated: Date.now(),
        instrument,
        interval: sessionConfig.interval,
        fromDate: sessionConfig.fromDate,
        toDate: sessionConfig.toDate,
        currentIndex,
        trades,
        position,
        uiSettings: { drawings, secondaryDrawings, primaryIndicators, secondaryIndicators, secondaryTimeframe, showSecondaryChart, tradeQuantity, riskPerTrade, targetRR, autoExitTarget, useAtrForSignals, showPivotRR, autoBacktestConfig },
      };
      set({ isLoading: true });
      try {
        await saveSnapshot(state, name);
        useNotificationStore.getState().notify(`Snapshot "${name}" saved!`, 'success');
      } catch (e: any) {
        useNotificationStore.getState().notify(`Failed to save snapshot: ${e.message}`, 'error');
      } finally {
        set({ isLoading: false });
      }
    },

    deleteRemoteSnapshot: async (id: string) => {
      set({ isLoading: true });
      try {
        await deleteSnapshot(id);
        useNotificationStore.getState().notify('Snapshot deleted successfully', 'success');
      } catch (e: any) {
        useNotificationStore.getState().notify(`Failed to delete snapshot: ${e.message}`, 'error');
      } finally {
        set({ isLoading: false });
      }
    },

    getRemoteSnapshots: async () => {
      try { return await listSnapshots(); } catch { return []; }
    },

    getCurrentCandle: () => {
      const { candles, currentIndex } = get();
      return candles[currentIndex] || null;
    },

    getVisibleCandles: () => {
      const { candles, currentIndex } = get();
      return candles.slice(0, currentIndex + 1);
    },

    getUnrealizedPnL: () => {
      const { position, candles, currentIndex, isLiveMode } = get();
      if (!position || position.quantity === 0) return 0;
      if (isLiveMode) return position.unrealizedPnL || 0;
      const currentCandle = candles[currentIndex];
      if (!currentCandle) return 0;
      return (currentCandle.close - position.averagePrice) * position.quantity;
    },

    getRealizedPnL: () => get().position?.realizedPnL || 0,

    toggleMarkers: (chartId?: 'primary' | 'secondary') => {
      const id = chartId || get().activeChartId;
      if (id === 'primary') set((s) => ({ primaryShowMarkers: !s.primaryShowMarkers }));
      else set((s) => ({ secondaryShowMarkers: !s.secondaryShowMarkers }));
    },

    setTradeQuantity: (tradeQuantity: number) => set({ tradeQuantity }),
    setRiskPerTrade: (riskPerTrade: number) => set({ riskPerTrade }),
    setManualLevels: (manualLevels: SessionStore['manualLevels']) => set({ manualLevels }),

    updatePositionTarget: async (newTarget: number) => {
      const { position, isLiveMode } = get();
      if (!position) return;
      const isLong = position.quantity > 0;
      if (isLong && newTarget <= position.averagePrice) {
        useNotificationStore.getState().notify('Target must be above entry price for a LONG position', 'warning');
        return;
      }
      if (!isLong && newTarget >= position.averagePrice) {
        useNotificationStore.getState().notify('Target must be below entry price for a SHORT position', 'warning');
        return;
      }
      set({ position: { ...position, target: newTarget, tpHit: false, tpDialogShown: false } });
      if (isLiveMode && (position as any).liveOptionToken) {
        await syncTargetWithMonitor((position as any).liveOptionToken, newTarget);
      }
      useNotificationStore.getState().notify(`Target updated to ${newTarget.toFixed(2)}`, 'success');
    },

    toggleAtrForSignals: () => set((s) => ({ useAtrForSignals: !s.useAtrForSignals })),
    togglePivotRR: () => set((s) => ({ showPivotRR: !s.showPivotRR })),

    setSecondaryTimeframe: (timeframe: string | null) => {
      const { candles, isLiveMode } = get();
      if (!timeframe || candles.length === 0) {
        set({ secondaryTimeframe: timeframe, secondaryCandles: [] });
        return;
      }
      set({ secondaryTimeframe: timeframe });
      if (isLiveMode) get().loadSecondaryCandles();
    },

    toggleSecondaryChart: () => set((s) => ({ showSecondaryChart: !s.showSecondaryChart })),

    setActiveChartId: (activeChartId: 'primary' | 'secondary') => set({ activeChartId }),
    setSharedActiveTool: (sharedActiveTool: string) => set({ sharedActiveTool }),

    setSharedActiveIndicators: (indicators: string[]) => {
      const { activeChartId } = get();
      if (activeChartId === 'primary') set({ primaryIndicators: indicators });
      else set({ secondaryIndicators: indicators });
    },

    toggleSharedIndicator: (indicator: string, chartId?: 'primary' | 'secondary') => {
      const id = chartId || get().activeChartId;
      if (id === 'primary') {
        set((s) => ({
          primaryIndicators: s.primaryIndicators.includes(indicator)
            ? s.primaryIndicators.filter((i) => i !== indicator)
            : [...s.primaryIndicators, indicator],
        }));
      } else {
        set((s) => ({
          secondaryIndicators: s.secondaryIndicators.includes(indicator)
            ? s.secondaryIndicators.filter((i) => i !== indicator)
            : [...s.secondaryIndicators, indicator],
        }));
      }
    },
  };
}
