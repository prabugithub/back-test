// @backtest-only — no live imports allowed.

import type { StoreSet, StoreGet } from './sessionStore';
import { type AutoBacktestConfig, evaluateAutoSignals, evaluateTrailStop, evaluateAutoExitSignal } from '../utils/autoBacktestEngine';
import { useNotificationStore } from './notificationStore';
import type { TradeJournal } from '../types';
import { analyzeManualEntry } from '../utils/pivotAnalysis';
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

export function createAutoBacktestActions(set: StoreSet, get: StoreGet) {
  return {
    setAutoBacktestConfig: (config: AutoBacktestConfig) => {
      set({
        autoBacktestConfig: config,
        // Sync autoExitSL with enabled state so SL also auto-exits in auto mode
        autoExitSL: config.enabled,
      });
    },

    runAutoBacktestCheck: (index: number) => {
      const state = get();

      // Hard guards — never run in live mode
      if (state.isLiveMode) return;
      if (!state.autoBacktestConfig.enabled) return;

      // Skip if position is open and pyramiding is disabled
      if (state.position !== null && state.autoBacktestConfig.skipIfPositionOpen) {
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
