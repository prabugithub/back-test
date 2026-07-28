// @backtest-only — no live imports allowed.

import type { StoreSet, StoreGet } from './sessionStore';
import {
  type AutoBacktestConfig, type AutoSignal,
  MULTI_TRADE_DEFAULT_CAP, isMultiTradeMode,
  evaluateAutoSignals, evaluateTrailStop, evaluateAutoExitSignal,
} from '../utils/autoBacktestEngine';
import { useNotificationStore } from './notificationStore';
import type { ExitReason, OpenPosition, Trade, TradeJournal } from '../types';
import { analyzeManualEntry } from '../utils/pivotAnalysis';
import { buildEntryInstrumentation } from '../utils/entryInstrumentation';
import { buildNetPositionMirror } from '../utils/netPosition';
import {
  saveAutoBacktestConfigAs as saveAutoBacktestConfigAsRemote,
  updateAutoBacktestConfig as updateAutoBacktestConfigRemote,
  listAutoBacktestConfigs,
  deleteAutoBacktestConfig as deleteAutoBacktestConfigRemote,
} from '../services/autoBacktestConfigService';

function candleTimeMinutes(timestampSec: number): number {
  const d = new Date(timestampSec * 1000);
  return d.getHours() * 60 + d.getMinutes(); // local time = IST (browser timezone)
}

function parseHHMM(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
}

let _openPositionSeq = 0;
const nextOpenPositionId = () =>
  `op-${Date.now().toString(36)}-${(_openPositionSeq++).toString(36)}`;

export function createAutoBacktestActions(set: StoreSet, get: StoreGet) {
  // Rebuilds `position` from `openPositions`. Every multi-trade mutation must end
  // with this, or the components reading `position` go stale.
  const syncNetPositionMirror = (patch?: { openPositions?: OpenPosition[]; multiRealizedPnL?: number }) => {
    const s = get();
    const openPositions = patch?.openPositions ?? s.openPositions;
    const multiRealizedPnL = patch?.multiRealizedPnL ?? s.multiRealizedPnL;
    set({
      openPositions,
      multiRealizedPnL,
      position: buildNetPositionMirror(
        openPositions,
        multiRealizedPnL,
        s.instrument,
        s.candles[s.currentIndex]?.close
      ),
    });
  };

  return {
    setAutoBacktestConfig: (config: AutoBacktestConfig) => {
      const prev = get();
      const wasMulti = isMultiTradeMode(prev);
      const willBeMulti = isMultiTradeMode({ isLiveMode: prev.isLiveMode, autoBacktestConfig: config });

      set({
        autoBacktestConfig: config,
        // Sync autoExitSL with enabled state so SL also auto-exits in auto mode
        autoExitSL: config.enabled,
      });

      if (wasMulti === willBeMulti) return;

      // ── Entering multi-trade mode ────────────────────────────────────────────
      // Adopt whatever single position is open as the first independent trade so
      // it keeps being managed instead of being orphaned by the mirror.
      if (willBeMulti) {
        const pos = prev.position;
        if (!pos || pos.quantity === 0) return;
        const migrated: OpenPosition = {
          ...(pos as OpenPosition),
          id: nextOpenPositionId(),
          entryTimestamp: prev.candles[prev.currentIndex]?.timestamp ?? Date.now() / 1000,
        };
        syncNetPositionMirror({ openPositions: [migrated], multiRealizedPnL: pos.realizedPnL || 0 });
        return;
      }

      // ── Leaving multi-trade mode ─────────────────────────────────────────────
      // A single trade collapses cleanly back to the legacy position. Several
      // cannot be represented at all, so close them at the current bar's close —
      // visibly, as MANUAL rows in Trade History, never silently.
      const open = prev.openPositions;
      if (open.length === 0) return;
      if (open.length > 1) {
        const ids = open.map(p => p.id);
        ids.forEach(id => get().closeIndependentPosition(id, 'MANUAL'));
        useNotificationStore.getState().notify(
          `Closed ${ids.length} open trades — single-position mode cannot hold more than one.`,
          'warning'
        );
      }
      const remaining = get().openPositions;
      const survivor = remaining[0];
      set({
        openPositions: [],
        multiRealizedPnL: 0,
        position: survivor
          ? { ...survivor, realizedPnL: get().multiRealizedPnL }
          : null,
      });
    },

    // ── Multi-trade mode ────────────────────────────────────────────────────────

    openIndependentPosition: (signal: AutoSignal, quantity: number, index: number, journal?: TradeJournal) => {
      const state = get();
      const candle = state.candles[index];
      if (!candle || quantity <= 0) return;

      const entryPrice = candle.close;
      const id = nextOpenPositionId();
      const { fields, isInitialWith } = buildEntryInstrumentation(
        state.candles, index, signal.type, entryPrice, state.autoBacktestConfig, signal.entryMetrics
      );

      const trade: Trade = {
        id: `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
        timestamp: candle.timestamp,
        type: signal.type,
        price: entryPrice,
        quantity,
        instrument: state.instrument,
        positionId: id,
        stopLoss: signal.sl,
        target: signal.tp,
        exitReason: 'MANUAL',
        withTrendSeen: isInitialWith,
        journal,
        ...fields,
        interval: state.sessionConfig?.interval || '5',
      };

      const openPosition: OpenPosition = {
        id,
        entryTimestamp: candle.timestamp,
        instrument: state.instrument,
        quantity: signal.type === 'BUY' ? quantity : -quantity,
        averagePrice: entryPrice,
        realizedPnL: 0,
        unrealizedPnL: 0,
        stopLoss: signal.sl,
        target: signal.tp,
        withTrendSeen: isInitialWith,
        // Every trade opened here is auto-entered, so the exit engine manages it.
        autoEntry: true,
        entryRegime: signal.regime,
        entryBarIndex: index,
      };

      set({ trades: [...state.trades, trade] });
      syncNetPositionMirror({ openPositions: [...state.openPositions, openPosition] });
    },

    closeIndependentPosition: (id: string, reason: ExitReason, fillPrice?: number) => {
      const state = get();
      const pos = state.openPositions.find(p => p.id === id);
      if (!pos) return;
      const candle = state.candles[state.currentIndex];
      if (!candle) return;

      const exitPrice = fillPrice ?? candle.close;
      const isLong = pos.quantity > 0;
      const qty = Math.abs(pos.quantity);
      const pnl = (isLong ? exitPrice - pos.averagePrice : pos.averagePrice - exitPrice) * qty;

      const trade: Trade = {
        id: `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
        timestamp: candle.timestamp,
        type: isLong ? 'SELL' : 'BUY',
        price: exitPrice,
        quantity: qty,
        instrument: pos.instrument,
        positionId: id,
        pnl,
        stopLoss: pos.stopLoss,
        target: pos.target,
        exitReason: reason,
        slHit: reason === 'SL',
        tpHit: reason === 'TP',
        hitFirst: reason === 'SL' || reason === 'TP' ? reason : undefined,
        slTrailed: pos.slTrailed || undefined,
        withTrendSeen: pos.withTrendSeen,
        interval: state.sessionConfig?.interval || '5',
      };

      set({ trades: [...state.trades, trade] });
      syncNetPositionMirror({
        openPositions: state.openPositions.filter(p => p.id !== id),
        multiRealizedPnL: state.multiRealizedPnL + pnl,
      });
    },

    // Per-bar lifecycle for every open trade, applying the SAME canonical order the
    // single-position path uses (trail → SL/TP → signal exits → square-off) to each
    // trade in turn. Reuses evaluateTrailStop / evaluateAutoExitSignal unchanged —
    // both already take a position-shaped argument.
    runMultiPositionCycle: (index: number, opts?: { slTpOnly?: boolean }) => {
      const state = get();
      if (!isMultiTradeMode(state)) return;
      if (state.openPositions.length === 0) return;
      const candle = state.candles[index];
      if (!candle) return;

      const config = state.autoBacktestConfig;
      const fillMode = config.slTpFillMode ?? 'exact';
      const slTpOnly = opts?.slTpOnly === true;
      const squareOffDue = !slTpOnly && config.autoSquareOff
        && candleTimeMinutes(candle.timestamp) >= parseHHMM(config.squareOffTime);
      if (squareOffDue) {
        useNotificationStore.getState().notify(
          `Auto Square-Off at ${config.squareOffTime} IST — closing ${state.openPositions.length} open trade(s)`,
          'info'
        );
      }

      // Snapshot the ids up front: closeIndependentPosition mutates openPositions,
      // and a trade opened later in this same bar must not be managed by it.
      for (const id of state.openPositions.map(p => p.id)) {
        const pos = get().openPositions.find(p => p.id === id);
        if (!pos) continue;

        // ── 1. Pivot trailing stop — ratchet before the touch check reads it ────
        let current = pos;
        if (!slTpOnly) {
          const trail = evaluateTrailStop(state.candles, index, current, config);
          if (trail) {
            current = { ...current, stopLoss: trail.newStopLoss, slTrailed: true };
            syncNetPositionMirror({
              openPositions: get().openPositions.map(p => (p.id === id ? current : p)),
            });
            useNotificationStore.getState().notify(
              `Trailing SL → ${trail.newStopLoss.toFixed(2)} (behind latest pivot)`, 'info'
            );
          }
        }

        // ── 2. SL/TP touch ──────────────────────────────────────────────────────
        const isLong = current.quantity > 0;
        const sl = current.stopLoss ?? 0;
        const tp = current.target ?? 0;
        const { high, low, close } = candle;
        let hit: { reason: ExitReason; price: number } | null = null;
        if (fillMode === 'exact') {
          if (isLong) {
            if (sl > 0 && low <= sl) hit = { reason: 'SL', price: sl };
            else if (tp > 0 && high >= tp) hit = { reason: 'TP', price: tp };
          } else {
            if (sl > 0 && high >= sl) hit = { reason: 'SL', price: sl };
            else if (tp > 0 && low <= tp) hit = { reason: 'TP', price: tp };
          }
        } else {
          if (isLong) {
            if (sl > 0 && close <= sl) hit = { reason: 'SL', price: close };
            else if (tp > 0 && close >= tp) hit = { reason: 'TP', price: close };
          } else {
            if (sl > 0 && close >= sl) hit = { reason: 'SL', price: close };
            else if (tp > 0 && close <= tp) hit = { reason: 'TP', price: close };
          }
        }
        if (hit) {
          useNotificationStore.getState().notify(
            `${hit.reason} Hit at ${hit.price.toFixed(2)}. Auto Exiting.`,
            hit.reason === 'TP' ? 'success' : 'warning'
          );
          get().closeIndependentPosition(id, hit.reason, hit.price);
          continue;
        }
        if (slTpOnly) continue;

        // ── 3. Price-action exit signals (REVERSAL → OPP_SIGNAL → LEG_DECAY) ────
        const { exit, state: exitState } = evaluateAutoExitSignal(state.candles, index, current, config);
        // Persist the per-bar reversal state even when no exit fires, or the
        // confirm-bars counter resets every bar.
        if (exitState.exitWithTrendSeen !== (current.exitWithTrendSeen ?? false)
          || exitState.exitAgainstBars !== (current.exitAgainstBars ?? 0)) {
          current = { ...current, ...exitState };
          syncNetPositionMirror({
            openPositions: get().openPositions.map(p => (p.id === id ? current : p)),
          });
        }
        if (exit) {
          const label = exit.reason === 'REVERSAL' ? 'Reversal Exit'
            : exit.reason === 'OPP_SIGNAL' ? 'Opposite-Signal Exit' : 'Leg-Decay Exit';
          useNotificationStore.getState().notify(`${label}: ${exit.detail}`, 'warning');
          get().closeIndependentPosition(id, exit.reason, close);
          continue;
        }

        // ── 4. Auto square-off ──────────────────────────────────────────────────
        if (squareOffDue) get().closeIndependentPosition(id, 'TIME_OVER', close);
      }
    },

    runAutoBacktestCheck: (index: number) => {
      const state = get();

      // Hard guards — never run in live mode
      if (state.isLiveMode) return;
      if (!state.autoBacktestConfig.enabled) return;

      const multi = isMultiTradeMode(state);

      // Single-position mode: a signal is skipped outright while anything is open.
      if (!multi && state.position !== null) return;

      // Multi-trade mode: every signal opens its own trade, up to the cap.
      const cap = state.autoBacktestConfig.maxOpenPositions ?? MULTI_TRADE_DEFAULT_CAP;
      if (multi && cap > 0 && state.openPositions.length >= cap) {
        set({ lastAutoSignalReason: `Skipped: ${cap} trades already open (max concurrent)` });
        return;
      }

      const { candles, autoBacktestConfig, tradeQuantity } = state;

      // Time window guard — check candle's IST time against configured window
      const candle = candles[index];
      const candleMin = candleTimeMinutes(candle.timestamp);
      if (candleMin < parseHHMM(autoBacktestConfig.tradeStartTime) ||
          candleMin > parseHHMM(autoBacktestConfig.tradeEndTime)) {
        return;
      }

      const signal = evaluateAutoSignals(candles, index, autoBacktestConfig);

      if (!signal) {
        return;
      }

      // Quantity calculation
      let qty: number;
      if (autoBacktestConfig.useAutoQty) {
        const riskPoints = Math.abs(signal.entryPrice - signal.sl);
        qty = riskPoints > 0 ? Math.floor(autoBacktestConfig.riskPerTrade / riskPoints) : 0;
        if (qty < autoBacktestConfig.minQuantity) {
          set({ lastAutoSignalReason: `Skipped: qty ${qty} < min ${autoBacktestConfig.minQuantity} (SL ${riskPoints.toFixed(1)} pts too wide)` });
          return;
        }
      } else {
        qty = tradeQuantity;
      }

      set({ lastAutoSignalReason: signal.reason });

      const maAnalysis = analyzeManualEntry(candles, index, signal.type);
      const journal: TradeJournal = {
        ltMarket: signal.ltMarket,
        htMarket: signal.htMarket,
        entryPosition: maAnalysis.entryPosition,
        llhhPivot: signal.llhhPivot,
        entrySign: signal.reason,
        notes: `[Auto BT] ${signal.reason}`,
        systemEntryAlign: 'Yes',
        myViewEntryAlign: 'Yes',
        systemMoveAlign: 'Yes',
        myViewMoveAlign: 'Yes',
        tradeCategory: 'System',
      };

      if (multi) {
        // Opens a trade of its own, alongside whatever is already running —
        // never blends into an existing position.
        state.openIndependentPosition(signal, qty, index, journal);
        return;
      }

      // Call executeTrade directly — bypasses the manual dialog flow
      state.executeTrade(
        signal.type,
        qty,
        signal.sl,
        signal.tp,
        undefined,        // priceOverride — use candle close
        'MANUAL',
        journal,
        signal.entryMetrics,
        // Stamps the position as auto-entered so the exit engine
        // (runAutoTrailStop/runAutoExitCheck) manages it.
        { auto: true, regime: signal.regime, barIndex: index }
      );
    },

    // Phase 1 of the auto exit engine — pivot trailing stop. Runs BEFORE
    // checkSLTPHits in step() so the touch check tests the trailed level.
    // Auto-entered backtest positions only.
    runAutoTrailStop: (index: number) => {
      const state = get();
      if (state.isLiveMode) return;
      if (!state.autoBacktestConfig.enabled) return;
      // runMultiPositionCycle trails each trade's own stop; `position` is a mirror.
      if (isMultiTradeMode(state)) return;
      const position = state.position;
      if (!position || position.quantity === 0 || !position.autoEntry) return;

      const trail = evaluateTrailStop(state.candles, index, position, state.autoBacktestConfig);
      if (!trail) return;

      set({
        position: {
          ...position,
          stopLoss: trail.newStopLoss,
          slTrailed: true,
          // SL level changed — re-arm the SL trigger (same convention as
          // updatePositionTarget resetting tpHit/tpDialogShown).
          slHit: undefined,
          slDialogShown: undefined,
        },
      });
      useNotificationStore
        .getState()
        .notify(`Trailing SL → ${trail.newStopLoss.toFixed(2)} (behind latest pivot)`, 'info');
    },

    // Phase 2 of the auto exit engine — price-action exit signals evaluated on
    // bar close (REVERSAL → OPP_SIGNAL → LEG_DECAY). Runs AFTER checkSLTPHits,
    // before runAutoSquareOff. Exits immediately, no dialog (same precedent as
    // the autoExitSL path in checkSLTPHits). Auto-entered backtest positions only.
    runAutoExitCheck: (index: number) => {
      const state = get();
      if (state.isLiveMode) return;
      if (!state.autoBacktestConfig.enabled) return;
      // runMultiPositionCycle evaluates signal exits per trade; `position` is a mirror.
      if (isMultiTradeMode(state)) return;
      const position = state.position;
      if (!position || position.quantity === 0 || !position.autoEntry) return;

      const { exit, state: exitState } = evaluateAutoExitSignal(
        state.candles, index, position, state.autoBacktestConfig
      );

      // Persist the per-bar reversal state even when no exit fires — otherwise
      // the confirm-bars counter would reset every bar.
      if (exitState.exitWithTrendSeen !== (position.exitWithTrendSeen ?? false)
        || exitState.exitAgainstBars !== (position.exitAgainstBars ?? 0)) {
        set({ position: { ...position, ...exitState } });
      }
      if (!exit) return;

      const isLong = position.quantity > 0;
      const label = exit.reason === 'REVERSAL' ? 'Reversal Exit'
        : exit.reason === 'OPP_SIGNAL' ? 'Opposite-Signal Exit' : 'Leg-Decay Exit';
      useNotificationStore.getState().notify(`${label}: ${exit.detail}`, 'warning');
      get().executeTrade(
        isLong ? 'SELL' : 'BUY',
        Math.abs(position.quantity),
        undefined,
        undefined,
        undefined,        // fill at current candle close
        exit.reason
      );
    },

    runBatchAutoBacktest: () => {
      const state = get();
      if (state.isLiveMode) return;
      if (state.candles.length === 0) return;
      if (state.isBatchBacktestRunning) return;

      set({ isBatchBacktestRunning: true, isPlaying: false, batchBacktestProgress: 0 });

      const { candles, autoBacktestConfig, instrument, tradeQuantity, sessionConfig } = get();

      const worker = new Worker(
        new URL('../utils/batchBacktestWorker.ts', import.meta.url),
        { type: 'module' }
      );

      worker.onmessage = (e: MessageEvent) => {
        if (e.data.type === 'progress') {
          set({ batchBacktestProgress: e.data.percent });
          return;
        }
        const result = e.data.result;
        set({
          trades: result.trades,
          position: result.finalPosition,
          // Empty unless the run was in multi-trade mode.
          openPositions: result.finalPositions ?? [],
          multiRealizedPnL: result.finalRealizedPnL ?? 0,
          currentIndex: candles.length - 1,
          isBatchBacktestRunning: false,
          batchBacktestProgress: 100,
          lastAutoSignalReason: `Batch complete: ${result.tradeCount} trades, P&L ₹${result.totalPnL.toFixed(2)}`,
        });
        worker.terminate();
      };

      worker.onerror = (err) => {
        console.error('Batch backtest worker error:', err);
        set({ isBatchBacktestRunning: false });
        useNotificationStore.getState().notify('Batch backtest failed', 'error');
        worker.terminate();
      };

      worker.postMessage({
        candles,
        config: autoBacktestConfig,
        startIndex: 0,
        instrument,
        tradeQuantity,
        sessionInterval: sessionConfig?.interval,
      });
    },

    runAutoSquareOff: (index: number) => {
      const state = get();
      if (state.isLiveMode) return;
      if (!state.autoBacktestConfig.autoSquareOff) return;
      // runMultiPositionCycle squares off each trade; `position` is a mirror.
      if (isMultiTradeMode(state)) return;
      if (!state.position) return;

      const candle = state.candles[index];
      if (!candle) return;

      const candleMin = candleTimeMinutes(candle.timestamp);
      if (candleMin < parseHHMM(state.autoBacktestConfig.squareOffTime)) return;

      const isLong = state.position.quantity > 0;
      useNotificationStore
        .getState()
        .notify(`Auto Square-Off at ${state.autoBacktestConfig.squareOffTime} IST`, 'info');
      state.executeTrade(
        isLong ? 'SELL' : 'BUY',
        Math.abs(state.position.quantity),
        undefined,
        undefined,
        undefined,
        'TIME_OVER'
      );
    },

    loadSavedAutoBacktestConfigsList: async () => {
      const configs = await listAutoBacktestConfigs();
      set({ savedAutoBacktestConfigs: configs });
    },

    saveAutoBacktestConfigAs: async (name: string) => {
      try {
        const saved = await saveAutoBacktestConfigAsRemote(name, get().autoBacktestConfig);
        set(state => ({
          savedAutoBacktestConfigs: [saved, ...state.savedAutoBacktestConfigs],
          activeAutoBacktestConfigId: saved.id,
          activeAutoBacktestConfigName: saved.name,
        }));
        useNotificationStore.getState().notify(`Configuration "${name}" saved!`, 'success');
      } catch (e: any) {
        useNotificationStore.getState().notify(`Failed to save configuration: ${e.message}`, 'error');
      }
    },

    updateActiveAutoBacktestConfig: async () => {
      const { activeAutoBacktestConfigId, activeAutoBacktestConfigName, autoBacktestConfig } = get();
      if (!activeAutoBacktestConfigId) {
        useNotificationStore.getState().notify('No saved configuration loaded — use "Save As" to create one', 'info');
        return;
      }
      try {
        await updateAutoBacktestConfigRemote(activeAutoBacktestConfigId, autoBacktestConfig);
        set(state => ({
          savedAutoBacktestConfigs: state.savedAutoBacktestConfigs.map(c =>
            c.id === activeAutoBacktestConfigId
              ? { ...c, config: autoBacktestConfig, updatedAt: Date.now() }
              : c
          ),
        }));
        useNotificationStore.getState().notify(`Configuration "${activeAutoBacktestConfigName}" updated!`, 'success');
      } catch (e: any) {
        useNotificationStore.getState().notify(`Failed to update configuration: ${e.message}`, 'error');
      }
    },

    applySavedAutoBacktestConfig: (id: string) => {
      const found = get().savedAutoBacktestConfigs.find(c => c.id === id);
      if (!found) return;
      get().setAutoBacktestConfig(found.config);
      set({ activeAutoBacktestConfigId: found.id, activeAutoBacktestConfigName: found.name });
      useNotificationStore.getState().notify(`Configuration "${found.name}" loaded`, 'success');
    },

    deleteSavedAutoBacktestConfig: async (id: string) => {
      try {
        await deleteAutoBacktestConfigRemote(id);
        set(state => ({
          savedAutoBacktestConfigs: state.savedAutoBacktestConfigs.filter(c => c.id !== id),
          activeAutoBacktestConfigId: state.activeAutoBacktestConfigId === id ? null : state.activeAutoBacktestConfigId,
          activeAutoBacktestConfigName: state.activeAutoBacktestConfigId === id ? null : state.activeAutoBacktestConfigName,
        }));
        useNotificationStore.getState().notify('Configuration deleted', 'success');
      } catch (e: any) {
        useNotificationStore.getState().notify(`Failed to delete configuration: ${e.message}`, 'error');
      }
    },
  };
}
