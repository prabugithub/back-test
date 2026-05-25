// @backtest-only — no live imports allowed.

import type { StoreSet, StoreGet } from './sessionStore';
import { type AutoBacktestConfig, evaluateAutoSignals } from '../utils/autoBacktestEngine';
import type { TradeJournal } from '../types';

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

      const signal = evaluateAutoSignals(candles, index, autoBacktestConfig);

      if (!signal) {
        // Clear last signal reason only if a new bar and no signal
        // (keep previous reason visible until a new one fires)
        return;
      }

      set({ lastAutoSignalReason: signal.reason });

      const journal: TradeJournal = {
        ltMarket: signal.ltMarket,
        htMarket: signal.htMarket,
        entryPosition: '',
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
        tradeQuantity,
        signal.sl,
        signal.tp,
        undefined,        // priceOverride — use candle close
        'MANUAL',
        journal
      );
    },
  };
}
