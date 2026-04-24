// @live-only — this file must never import backtestActions or playback logic.
// WebSocket lifecycle, live tick handling, live candle updates, and position sync live here.

import { getLivePositions } from '../services/api';
import { useNotificationStore } from './notificationStore';
import type { SessionStore } from './sessionStore';

type Set = (
  partial: Partial<SessionStore> | ((s: SessionStore) => Partial<SessionStore>)
) => void;
type Get = () => SessionStore;

// Interval that periodically syncs broker position state while in live mode
let syncIntervalId: ReturnType<typeof setInterval> | null = null;

export function createLiveActions(set: Set, get: Get) {
  return {
    setLiveMode: (isLive: boolean) => {
      set({ isLiveMode: isLive });
      if (isLive) {
        const { candles } = get();
        if (candles.length > 0) set({ currentIndex: candles.length - 1 });
        get().syncLivePositions();
        // Clear any stale interval before starting a fresh one
        if (syncIntervalId) clearInterval(syncIntervalId);
        syncIntervalId = setInterval(() => {
          if (get().isLiveMode) get().syncLivePositions();
        }, 3000);
      } else {
        if (syncIntervalId) {
          clearInterval(syncIntervalId);
          syncIntervalId = null;
        }
      }
    },

    syncLivePositions: async () => {
      try {
        const resp = await getLivePositions();
        if (resp?.success && Array.isArray(resp.data)) {
          const openFnoPositions = resp.data.filter(
            (p: any) =>
              p.positionType !== 'CLOSED' &&
              p.buyQty !== p.sellQty &&
              p.exchangeSegment === 'NSE_FNO'
          );

          const currentStoreToken = (get().position as any)?.liveOptionToken;
          let openPosition: any;
          if (currentStoreToken) {
            openPosition = openFnoPositions.find(
              (p: any) => String(p.securityId) === String(currentStoreToken)
            );
          } else {
            openPosition = openFnoPositions[0];
          }

          if (openPosition) {
            const qty =
              openPosition.positionType === 'LONG'
                ? Math.abs(openPosition.buyQty - openPosition.sellQty)
                : -Math.abs(openPosition.sellQty - openPosition.buyQty);
            const avgPrice =
              openPosition.positionType === 'LONG'
                ? openPosition.buyAvg
                : openPosition.sellAvg;
            const currentStorePos = get().position;

            set({
              position: {
                instrument: currentStorePos?.instrument || openPosition.tradingSymbol || 'NIFTY',
                quantity: qty,
                averagePrice: avgPrice,
                realizedPnL: openPosition.realizedProfit || 0,
                unrealizedPnL: openPosition.unrealizedProfit || 0,
                liveOptionToken: openPosition.securityId,
                stopLoss: currentStorePos?.stopLoss,
                target: currentStorePos?.target,
                slHit: currentStorePos?.slHit,
                tpHit: currentStorePos?.tpHit,
                slDialogShown: currentStorePos?.slDialogShown,
                tpDialogShown: currentStorePos?.tpDialogShown,
                hitFirst: currentStorePos?.hitFirst,
              },
            });

            if (!currentStorePos && qty !== 0) {
              useNotificationStore
                .getState()
                .notify(
                  `Synced Option Position: ${openPosition.tradingSymbol} (Qty ${qty})`,
                  'info'
                );
            }
          } else {
            if (get().position) {
              set({ position: null });
              useNotificationStore
                .getState()
                .notify('No active Option positions on broker. Cleared local position.', 'info');
            }
          }
        }
      } catch (err) {
        console.warn('Failed to sync live positions', err);
      }
    },

    updateLivePrice: (price: number) => {
      set({ livePrice: price });
      const { isLiveMode, currentIndex } = get();
      if (isLiveMode) get().checkSLTPHits(currentIndex);
    },

    addLiveCandle: (candle: import('../types').Candle) => {
      const { candles, isLiveMode } = get();
      const lastCandle = candles[candles.length - 1];
      let newCandles: typeof candles;
      if (lastCandle && lastCandle.timestamp === candle.timestamp) {
        newCandles = [
          ...candles.slice(0, -1),
          {
            ...lastCandle,
            close: candle.close,
            high: Math.max(lastCandle.high, candle.high),
            low: Math.min(lastCandle.low, candle.low),
            volume: candle.volume ?? lastCandle.volume ?? 0,
          },
        ];
      } else {
        newCandles = [...candles, candle];
      }
      const isLivePriceUpdate = !!(lastCandle && lastCandle.timestamp === candle.timestamp);
      set({
        candles: newCandles,
        isLivePriceUpdate,
        ...(isLiveMode ? { currentIndex: newCandles.length - 1 } : {}),
      });
    },
  };
}
