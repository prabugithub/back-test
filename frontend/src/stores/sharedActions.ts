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
import { calculatePivotPoints } from '../utils/indicators';
import { analyzeMarketStructure } from '../utils/pivotAnalysis';
import { buildEntryInstrumentation } from '../utils/entryInstrumentation';
import { buildNetPositionMirror, rebuildOpenPositionsFromTrades } from '../utils/netPosition';
import {
  executeLiveOrder,
  registerMonitorIfNeeded,
  syncTargetWithMonitor,
  pollOrderFillStatus,
} from '../services/liveExecutionService';
import type { Trade, Position, OpenPosition, TradeJournal, ExitReason } from '../types';
import type { SessionStore, SessionConfig, StoreSet, StoreGet } from './sessionStore';
import { isMultiTradeMode, type EntryMetricsSnapshot, type RegimeKey } from '../utils/autoBacktestEngine';

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
      const state = get();
      const { position, manualLevels } = state;
      if (manualLevels) return;
      // Multi-trade mode: each trade carries the target its own signal computed;
      // there is no single position to re-derive from the new RR.
      if (isMultiTradeMode(state)) return;
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

    scrollToTime: (timestamp: number | null) => set({ scrollToTimestamp: timestamp }),

    highlightCandle: (timestamp: number | null) => set({ highlightTimestamp: timestamp }),

    checkSLTPHits: (index: number, currentPrice?: number) => {
      const state = get();
      const { candles, position } = state;
      // Multi-trade mode: runMultiPositionCycle owns SL/TP per trade. `position`
      // is a derived mirror here — exiting it would flatten every open trade.
      if (isMultiTradeMode(state)) return;
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
      const { isLiveMode } = get();
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
      exitReason: ExitReason = 'MANUAL',
      journal?: TradeJournal,
      entryMetricsOverride?: EntryMetricsSnapshot,
      // Present only when the auto engine opened this trade — stamps the position
      // so the exit engine (runAutoTrailStop/runAutoExitCheck) manages it.
      autoMeta?: { auto: true; regime: RegimeKey; barIndex: number }
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
          // Backend's POST /api/live/monitor rejects registration when both are missing
          // (400 "At least one of stopLoss or target must be provided") — but that request
          // fires only after the broker order is already placed, and registerMonitorIfNeeded
          // swallows the failure in a .catch(), so a real live position could otherwise end up
          // with zero backend SL/TP monitoring. Block before the order is ever sent instead.
          if (stopLoss === undefined && target === undefined) {
            useNotificationStore.getState().notify(
              'Cannot enter a live trade without a Stop Loss or Target. Draw RR levels or wait for a valid pivot before trading.',
              'warning'
            );
            return;
          }
          // Mirrors the isTargetWrong/isSLWrong sanitization further below (which runs
          // AFTER the broker order is placed) — if price drifted between when these levels
          // were computed (off currentCandle.close) and now (live tick), that sanitization
          // can wipe BOTH to undefined for a fresh entry, with no position to fall back on.
          // Catch that here, before the broker order is sent, instead of ending up with a
          // live position with zero backend SL/TP protection.
          const isEntryLong = type === 'BUY';
          const entryTargetUsable =
            target !== undefined && !((isEntryLong && target < currentPrice) || (!isEntryLong && target > currentPrice));
          const entrySLUsable =
            stopLoss !== undefined && !((isEntryLong && stopLoss > currentPrice) || (!isEntryLong && stopLoss < currentPrice));
          if (!entryTargetUsable && !entrySLUsable) {
            useNotificationStore.getState().notify(
              'Stop Loss / Target no longer valid at the current price (market moved). Redraw RR levels or wait for a fresh pivot before trading.',
              'warning'
            );
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

      // Entry-condition instrumentation. Reducing trades stamp none of it, so skip
      // the (expensive) work and derive only the with-trend flag they still need.
      const instrumentation = !isReducing
        ? buildEntryInstrumentation(candles, currentIndex, type, currentPrice, autoBacktestConfig, entryMetricsOverride)
        : null;
      let isInitialWith: boolean;
      if (instrumentation) {
        isInitialWith = instrumentation.isInitialWith;
      } else {
        const visibleCandlesForEntry = candles.slice(0, currentIndex + 1);
        const { ltMarket } = analyzeMarketStructure(visibleCandlesForEntry, calculatePivotPoints(visibleCandlesForEntry));
        isInitialWith =
          (type === 'BUY' && ltMarket.startsWith('Bull')) ||
          (type === 'SELL' && ltMarket.startsWith('Bear'));
      }

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
        slTrailed: isReducing ? position?.slTrailed || undefined : undefined,
        journal: journal || undefined,
        // Every `*AtEntry` field — present only on non-reducing fills.
        ...(instrumentation?.fields ?? {}),
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
        // Exit-engine stamps: a fresh open or flip takes the (auto) opener's
        // regime/bar and resets per-trade exit state; same-side adds and partial
        // reduces keep the original stamps. Manual opens leave them all undefined.
        autoEntry: currentQty === 0 || isFlip ? autoMeta?.auto : position?.autoEntry,
        entryRegime: currentQty === 0 || isFlip ? autoMeta?.regime : position?.entryRegime,
        entryBarIndex: currentQty === 0 || isFlip ? autoMeta?.barIndex : position?.entryBarIndex,
        exitWithTrendSeen: currentQty === 0 || isFlip ? undefined : position?.exitWithTrendSeen,
        exitAgainstBars: currentQty === 0 || isFlip ? undefined : position?.exitAgainstBars,
        slTrailed: currentQty === 0 || isFlip ? undefined : position?.slTrailed,
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
      const state = get();
      const { candles, position, trades } = state;
      // Writes trendReversed onto `position`, which is a rebuilt-every-bar mirror
      // in multi-trade mode — the flag would never survive to be read.
      if (isMultiTradeMode(state)) return;
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

    // Rebuilds every position-shaped bit of state from a mutated trade log.
    // Shared by deleteTrade/deleteTrades so the two cannot drift.
    applyTradeLogMutation: (newTrades: Trade[]) => {
      const { instrument } = get();
      if (newTrades.length === 0) {
        set({ trades: [], position: null, openPositions: [], multiRealizedPnL: 0 });
        return;
      }
      const { processedTrades, finalQty, finalAvgPrice, totalRealizedPnL } = recalculateTradesPnL(newTrades);

      // Independent trades don't blend, so a net qty/avg-price pair cannot describe
      // them — reconstruct the open ones from the log and rebuild the mirror.
      if (processedTrades.some(t => t.positionId)) {
        const { openPositions, multiRealizedPnL } = rebuildOpenPositionsFromTrades(processedTrades, instrument);
        const { candles, currentIndex } = get();
        set({
          trades: processedTrades,
          openPositions,
          multiRealizedPnL,
          position: buildNetPositionMirror(openPositions, multiRealizedPnL, instrument, candles[currentIndex]?.close),
        });
        return;
      }

      set({
        trades: processedTrades,
        openPositions: [],
        multiRealizedPnL: 0,
        position: finalQty !== 0
          ? { instrument, quantity: finalQty, averagePrice: finalAvgPrice, realizedPnL: totalRealizedPnL, unrealizedPnL: 0, stopLoss: undefined, target: undefined, slHit: false, tpHit: false }
          : null,
      });
    },

    deleteTrade: (tradeId: string) => {
      get().applyTradeLogMutation(get().trades.filter((t) => t.id !== tradeId));
    },

    deleteTrades: (tradeIds: string[]) => {
      get().applyTradeLogMutation(get().trades.filter((t) => !tradeIds.includes(t.id)));
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
        instrument, trades, position, openPositions, multiRealizedPnL, currentIndex, sessionConfig,
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
        openPositions,
        multiRealizedPnL,
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
        return {
          config,
          data: {
            trades: state.trades,
            position: state.position,
            currentIndex: state.currentIndex,
            uiSettings: state.uiSettings,
            // Absent on sessions saved before multi-trade mode existed.
            openPositions: state.openPositions ?? [],
            multiRealizedPnL: state.multiRealizedPnL ?? 0,
          },
        };
      } catch (error) {
        console.error(error);
        return null;
      } finally {
        set({ isLoading: false });
      }
    },

    restoreSessionState: (
      trades: Trade[],
      position: Position | null,
      currentIndex: number,
      uiSettings?: any,
      multi?: { openPositions?: OpenPosition[]; multiRealizedPnL?: number }
    ) => {
      const extraState = uiSettings?.autoBacktestConfig
        ? { autoExitSL: uiSettings.autoBacktestConfig.enabled }
        : {};
      set((state) => ({
        ...state,
        trades,
        position,
        currentIndex,
        openPositions: multi?.openPositions ?? [],
        multiRealizedPnL: multi?.multiRealizedPnL ?? 0,
        ...(uiSettings || {}),
        ...extraState,
      }));
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
          set({
            trades: state.trades,
            position: state.position,
            currentIndex: state.currentIndex,
            openPositions: state.openPositions ?? [],
            multiRealizedPnL: state.multiRealizedPnL ?? 0,
          });
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
        instrument, trades, position, openPositions, multiRealizedPnL, currentIndex, sessionConfig,
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
        openPositions,
        multiRealizedPnL,
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
      const state = get();
      const { position, candles, currentIndex, isLiveMode } = state;
      if (!position) return 0;
      // Multi-trade mode: the mirror already sums the per-trade unrealized P&L.
      // Recomputing off the net average would report 0 for an equal-sized
      // long+short pair even though both trades are live.
      if (isMultiTradeMode(state) && state.openPositions.length > 0) return position.unrealizedPnL || 0;
      if (position.quantity === 0) return 0;
      if (isLiveMode) return position.unrealizedPnL || 0;
      const currentCandle = candles[currentIndex];
      if (!currentCandle) return 0;
      return (currentCandle.close - position.averagePrice) * position.quantity;
    },

    getRealizedPnL: () => {
      const state = get();
      // The mirror is rebuilt from scratch on every mutation, so realized P&L
      // from already-closed trades lives in its own field in multi-trade mode.
      if (isMultiTradeMode(state)) return state.multiRealizedPnL;
      return state.position?.realizedPnL || 0;
    },

    toggleMarkers: (chartId?: 'primary' | 'secondary') => {
      const id = chartId || get().activeChartId;
      if (id === 'primary') set((s) => ({ primaryShowMarkers: !s.primaryShowMarkers }));
      else set((s) => ({ secondaryShowMarkers: !s.secondaryShowMarkers }));
    },

    setTradeQuantity: (tradeQuantity: number) => set({ tradeQuantity }),
    setRiskPerTrade: (riskPerTrade: number) => set({ riskPerTrade }),
    setManualLevels: (manualLevels: SessionStore['manualLevels']) => set({ manualLevels }),

    updatePositionTarget: async (newTarget: number) => {
      const state = get();
      const { position, isLiveMode } = state;
      if (!position) return;
      // The mirror is rebuilt on every mutation, so an edit here would be silently
      // discarded. Targets are per-trade in multi-trade mode.
      if (isMultiTradeMode(state)) {
        useNotificationStore.getState().notify(
          'Target is set per trade while "Skip if open" is unchecked — exit the trade from the position panel instead.',
          'info'
        );
        return;
      }
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
        const synced = await syncTargetWithMonitor((position as any).liveOptionToken, newTarget);
        if (!synced) {
          useNotificationStore.getState().notify(
            `Target changed locally to ${newTarget.toFixed(2)}, but the backend monitor sync FAILED — this position may have no server-side SL/TP protection. Verify or close manually.`,
            'error'
          );
          return;
        }
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
