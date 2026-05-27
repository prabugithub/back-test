// @backtest-only — no live imports allowed.

import type { StoreSet, StoreGet } from './sessionStore';
import { type AutoBacktestConfig, evaluateAutoSignals } from '../utils/autoBacktestEngine';
import type { TradeJournal } from '../types';

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
        qty,
        signal.sl,
        signal.tp,
        undefined,        // priceOverride — use candle close
        'MANUAL',
        journal
      );
    },
  };
}
