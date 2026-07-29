// @backtest-only — this file must never import liveExecutionService or any live API functions.
// All playback, candle navigation, trade dialog, and session reset logic lives here.

import { useNotificationStore } from './notificationStore';
import type { SessionStore, StoreSet, StoreGet } from './sessionStore';
import { isMultiTradeMode } from '../utils/autoBacktestEngine';
import { fetchCandles } from '../services/api';
import { parseColumnarData, resampleCandles, type ColumnarData } from '../utils/resampler';

// Dynamic import for local data
const loadNiftyData = () => import('../assets/market-data/nifty5min_data.json');

export function createBacktestActions(set: StoreSet, get: StoreGet) {
  return {
    loadCandles: (candles: SessionStore['candles'], instrument: string, config?: SessionStore['sessionConfig']) => {
      // Block only when a live broker-backed position is open AND we are NOT reloading
      // the live chart. For live reloads (dataSource === 'live'), restoreSessionState()
      // is called immediately after and puts the position back — so blocking here is wrong.
      const activePos = get().position as any;
      if (activePos?.liveOptionToken && config?.dataSource !== 'live') {
        console.warn('[Safety] loadCandles blocked — active live option position open');
        useNotificationStore.getState().notify(
          'Cannot load new data while a live option position is open. Close the position first.',
          'warning'
        );
        return;
      }
      set({
        candles,
        instrument,
        sessionConfig: config || null,
        currentIndex: candles.length > 0 ? candles.length - 1 : 0,
        trades: [],
        position: null,
        openPositions: [],
        multiRealizedPnL: 0,
        isPlaying: false,
        manualLevels: null,
        pendingExitRequest: null,
        pendingTradeRequest: null,
      });
    },

    reloadCandlesWithRange: async (startStr: string, endStr: string, newTimeframe: string, jumpToDateStr?: string) => {
      const config = get().sessionConfig;
      if (!config) {
        useNotificationStore.getState().notify('No active session config found.', 'error');
        return false;
      }

      try {
        if (config.dataSource === 'api') {
          const response = await fetchCandles({
            securityId: config.securityId,
            exchangeSegment: config.exchangeSegment,
            instrument: config.instrumentType,
            interval: newTimeframe,
            fromDate: startStr,
            toDate: endStr,
          });

          if (response.success && response.data.length > 0) {
            const newConfig = { ...config, interval: newTimeframe, fromDate: startStr, toDate: endStr };
            get().loadCandles(response.data, `${config.securityId}-${config.exchangeSegment}`, newConfig);
            useNotificationStore.getState().notify('Data reloaded successfully (API)!', 'success');
          } else {
            throw new Error((response as any).message || 'No data received from API');
          }
        } else {
          const module = await loadNiftyData();
          const rawData: any = module.default || module;

          if (!rawData || !rawData.t || !rawData.o || !rawData.h || !rawData.l || !rawData.c || !rawData.v) {
            throw new Error('Invalid JSON data format');
          }

          // Local data (Nifty JSON) is already offset by 5.5 hours (IST)
          let allCandles = parseColumnarData(rawData as ColumnarData, -19800);

          if (startStr) {
            const fromTs = new Date(startStr).getTime() / 1000;
            allCandles = allCandles.filter(c => c.timestamp >= fromTs);
          }
          if (endStr) {
            const toTs = (new Date(endStr).getTime() / 1000) + 86400;
            allCandles = allCandles.filter(c => c.timestamp < toTs);
          }

          let tfMinutes = 5;
          if (newTimeframe === '1') {
            tfMinutes = 5; // Fallback for local data since we only have 5m
            useNotificationStore.getState().notify('1m timeframe not available for local data. Using 5m instead.', 'warning');
          }
          if (newTimeframe === '5') tfMinutes = 5;
          if (newTimeframe === '15') tfMinutes = 15;
          if (newTimeframe === '30') tfMinutes = 30;
          if (newTimeframe === '60') tfMinutes = 60;
          if (newTimeframe === '240') tfMinutes = 240;
          if (newTimeframe === '1440' || newTimeframe === '1D') tfMinutes = 1440;

          const resampledCandles = tfMinutes === 5 ? allCandles : resampleCandles(allCandles, tfMinutes);

          if (resampledCandles.length === 0) {
            throw new Error('No candles found for the selected range/timeframe');
          }

          const newConfig = { ...config, interval: newTimeframe, fromDate: startStr, toDate: endStr };
          get().loadCandles(resampledCandles, `NIFTY50 (Local ${newTimeframe}m)`, newConfig);
          useNotificationStore.getState().notify('Data reloaded successfully (Local)!', 'success');
        }

        if (jumpToDateStr) {
          const candles = get().candles;
          const targetTs = new Date(jumpToDateStr).getTime() / 1000;
          const foundIndex = candles.findIndex(c => c.timestamp >= targetTs);
          if (foundIndex !== -1) {
            get().setCurrentIndex(foundIndex);
            useNotificationStore.getState().notify(`Jumped to ${jumpToDateStr}`, 'info');
          }
        }

        return true;
      } catch (error: any) {
        console.error('Failed to reload data:', error);
        useNotificationStore.getState().notify(`Failed to reload data: ${error.message}`, 'error');
        return false;
      }
    },

    play: () => {
      if (get().isLiveMode) return;
      set({ isPlaying: true });
    },

    pause: () => {
      if (get().isLiveMode) return;
      set({ isPlaying: false });
    },

    step: (direction: 'forward' | 'backward') => {
      if (get().isLiveMode) return;
      const { currentIndex, candles } = get();
      if (direction === 'forward' && currentIndex < candles.length - 1) {
        const nextIndex = currentIndex + 1;
        set({ currentIndex: nextIndex });
        get().checkTrendReversal(nextIndex);
        // Canonical per-bar exit order — mirrored in batchBacktestSimulator's loop:
        // trail SL → SL/TP touch check → signal exits → square-off → entry check.
        // In multi-trade mode runMultiPositionCycle applies that same order to each
        // open trade in turn; the single-position actions all no-op there.
        get().runAutoTrailStop(nextIndex);
        get().checkSLTPHits(nextIndex);
        get().runAutoExitCheck(nextIndex);
        get().runAutoSquareOff(nextIndex);
        get().runMultiPositionCycle(nextIndex);
        get().runAutoBacktestCheck(nextIndex);
      } else if (direction === 'backward' && currentIndex > 0) {
        set({ currentIndex: currentIndex - 1 });
      }
    },

    jump: (count: number) => {
      if (get().isLiveMode) return;
      const { currentIndex, candles } = get();
      const newIndex = currentIndex + count;
      if (newIndex >= 0 && newIndex < candles.length) {
        set({ currentIndex: newIndex });
        get().checkTrendReversal(newIndex);
        get().checkSLTPHits(newIndex);
        get().runMultiPositionCycle(newIndex, { slTpOnly: true });
      } else if (newIndex < 0) {
        set({ currentIndex: 0 });
      } else {
        set({ currentIndex: candles.length - 1 });
      }
    },

    setSpeed: (speed: number) => set({ speed }),

    setCurrentIndex: (index: number) => {
      const { candles } = get();
      if (index >= 0 && index < candles.length) {
        set({ currentIndex: index });
        get().checkSLTPHits(index);
        get().runMultiPositionCycle(index, { slTpOnly: true });
      }
    },

    initiateTrade: (
      type: 'BUY' | 'SELL',
      quantity: number,
      stopLoss?: number,
      target?: number
    ) => {
      // Multi-trade mode has no single position for a manual order to act on —
      // entries are auto-only and exits go through closeIndependentPosition.
      // TradingPanel disables its buttons too; this is the backstop for the
      // keyboard shortcuts and any other caller.
      if (isMultiTradeMode(get())) {
        useNotificationStore.getState().notify(
          'Manual trading is disabled while "Skip if open" is unchecked — exit trades from the position panel.',
          'info'
        );
        return;
      }
      set({ isPlaying: false, pendingTradeRequest: { type, quantity, stopLoss, target } });
    },

    resolveTradeRequest: (journal: import('../types').TradeJournal | null, exitReason: import('../types').ExitReason = 'MANUAL') => {
      const { pendingTradeRequest } = get();
      if (!pendingTradeRequest) return;
      if (journal) {
        get().executeTrade(
          pendingTradeRequest.type,
          pendingTradeRequest.quantity,
          pendingTradeRequest.stopLoss,
          pendingTradeRequest.target,
          undefined,
          exitReason,
          journal
        );
      }
      set({ pendingTradeRequest: null });
    },

    resolveExitRequest: (confirm: boolean, journal?: import('../types').TradeJournal) => {
      const { pendingExitRequest, position } = get();
      if (!pendingExitRequest || !position) return;
      if (confirm) {
        const exitType = position.quantity > 0 ? 'SELL' : 'BUY';
        get().executeTrade(
          exitType,
          Math.abs(position.quantity),
          undefined,
          undefined,
          pendingExitRequest.price,
          pendingExitRequest.type,
          journal
        );
        set({ pendingExitRequest: null });
      } else {
        set({
          position: {
            ...position,
            slDialogShown: pendingExitRequest.type === 'SL' ? true : position.slDialogShown,
            tpDialogShown: pendingExitRequest.type === 'TP' ? true : position.tpDialogShown,
          },
          pendingExitRequest: null,
        });
      }
    },

    resetSession: () => {
      if (get().isLiveMode) {
        console.warn('[Safety] resetSession blocked while in live mode');
        useNotificationStore.getState().notify(
          'Cannot reset session while in live mode. Disable live mode first.',
          'warning'
        );
        return;
      }
      set({
        currentIndex: 0,
        trades: [],
        position: null,
        openPositions: [],
        multiRealizedPnL: 0,
        isPlaying: false,
        manualLevels: null,
        pendingExitRequest: null,
        pendingTradeRequest: null,
      });
    },
  };
}
