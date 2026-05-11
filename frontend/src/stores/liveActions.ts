// @live-only — this file must never import backtestActions or playback logic.
// WebSocket lifecycle, live tick handling, live candle updates, and position sync live here.

import { getLivePositions, fetchCandles } from '../services/api';
import { resampleCandles, getISTBucket } from '../utils/resampler';
import { useNotificationStore } from './notificationStore';
import type { StoreSet, StoreGet } from './sessionStore';

// Maps secondary TF string (minutes) → { Dhan API interval, resample target (null = direct) }
// Dhan intraday endpoint supports: 1, 5, 15, 25, 60 only.
// Unsupported intervals (30, 120, 240) are fetched at the nearest supported interval then
// resampled client-side. '1440' (1 Day) routes to Dhan's historical endpoint.
const HTF_INTERVAL_MAP: Record<string, { apiInterval: string; resampleTo: number | null; isIntraday: boolean }> = {
  '15':   { apiInterval: '15',   resampleTo: null, isIntraday: true },
  '30':   { apiInterval: '15',   resampleTo: 30,   isIntraday: true },
  '60':   { apiInterval: '60',   resampleTo: null, isIntraday: true },
  '120':  { apiInterval: '60',   resampleTo: 120,  isIntraday: true },
  '240':  { apiInterval: '60',   resampleTo: 240,  isIntraday: true },
  '1440': { apiInterval: '1440', resampleTo: null, isIntraday: false },
};

// Lookback days per TF to yield ~3000 candles with a 1.5x holiday buffer
const HTF_LOOKBACK_DAYS: Record<string, number> = {
  '15':   175,
  '30':   350,
  '60':   700,
  '120':  1400,
  '240':  2800,
  '1440': 5000,
};

// Dhan intraday API is capped at 90 days per request — build chunk windows
function buildDateChunks(from: Date, to: Date, maxDays: number): Array<{ from: Date; to: Date }> {
  const chunks: Array<{ from: Date; to: Date }> = [];
  let cursor = new Date(from);
  while (cursor < to) {
    const chunkEnd = new Date(cursor);
    chunkEnd.setDate(chunkEnd.getDate() + maxDays);
    chunks.push({ from: new Date(cursor), to: chunkEnd > to ? new Date(to) : chunkEnd });
    cursor = new Date(chunkEnd);
    cursor.setDate(cursor.getDate() + 1);
  }
  return chunks;
}

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function createLiveActions(set: StoreSet, get: StoreGet) {
  // Scoped to this closure so multiple store instances don't share interval state
  let syncIntervalId: ReturnType<typeof setInterval> | null = null;
  return {
    setLiveMode: (isLive: boolean) => {
      set({ isLiveMode: isLive });
      if (isLive) {
        const { candles, secondaryTimeframe } = get();
        if (candles.length > 0) set({ currentIndex: candles.length - 1 });
        get().syncLivePositions();
        if (secondaryTimeframe) get().loadSecondaryCandles();
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

    loadSecondaryCandles: async () => {
      const { sessionConfig, secondaryTimeframe } = get();
      if (!sessionConfig || !secondaryTimeframe) return;

      const resolved = HTF_INTERVAL_MAP[secondaryTimeframe];
      if (!resolved) return;

      const lookbackDays = HTF_LOOKBACK_DAYS[secondaryTimeframe] ?? 700;
      const toDate = new Date();
      const fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - lookbackDays);

      const base = {
        securityId: sessionConfig.securityId,
        exchangeSegment: sessionConfig.exchangeSegment,
        instrument: sessionConfig.instrumentType,
        interval: resolved.apiInterval,
      };

      try {
        let allCandles: import('../types').Candle[] = [];

        if (resolved.isIntraday) {
          // Dhan intraday endpoint: max 90 days per request, rate-limited per user.
          // Throttle chunks with a 600ms gap to stay within DH-904 limits.
          const chunks = buildDateChunks(fromDate, toDate, 90);
          for (let i = 0; i < chunks.length; i++) {
            if (i > 0) await new Promise((r) => setTimeout(r, 600));
            const resp = await fetchCandles({ ...base, fromDate: fmtDate(chunks[i].from), toDate: fmtDate(chunks[i].to) });
            if (resp.success && resp.data?.length) allCandles = allCandles.concat(resp.data);
          }
        } else {
          // Historical endpoint (daily) — no 90-day limit
          const resp = await fetchCandles({ ...base, fromDate: fmtDate(fromDate), toDate: fmtDate(toDate) });
          if (resp.success && resp.data?.length) allCandles = resp.data;
        }

        if (!allCandles.length) return;

        if (resolved.resampleTo) allCandles = resampleCandles(allCandles, resolved.resampleTo);
        set({ secondaryCandles: allCandles.slice(-3000) });
      } catch (err) {
        console.warn('Failed to load secondary HTF candles', err);
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
      const { candles, isLiveMode, secondaryCandles, secondaryTimeframe } = get();
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

      // Incrementally update the pre-fetched HTF secondary candle
      let newSecondaryCandles = secondaryCandles;
      if (secondaryTimeframe && secondaryCandles.length > 0) {
        const tfMinutes = secondaryTimeframe === '1D' ? 1440 : parseInt(secondaryTimeframe, 10);
        const bucket = getISTBucket(candle.timestamp, tfMinutes);
        const last = secondaryCandles[secondaryCandles.length - 1];

        if (last.timestamp === bucket) {
          newSecondaryCandles = [
            ...secondaryCandles.slice(0, -1),
            {
              ...last,
              close: candle.close,
              high: Math.max(last.high, candle.high),
              low: Math.min(last.low, candle.low),
              volume: (last.volume ?? 0) + (candle.volume ?? 0),
            },
          ];
        } else {
          newSecondaryCandles = [
            ...secondaryCandles,
            {
              timestamp: bucket,
              open: candle.open,
              high: candle.high,
              low: candle.low,
              close: candle.close,
              volume: candle.volume ?? 0,
            },
          ];
        }
      }

      set({
        candles: newCandles,
        isLivePriceUpdate,
        secondaryCandles: newSecondaryCandles,
        ...(isLiveMode ? { currentIndex: newCandles.length - 1 } : {}),
      });
    },

    patchLiveCandle: (candle: import('../types').Candle) => {
      const { candles } = get();
      const idx = candles.findIndex(c => c.timestamp === candle.timestamp);
      if (idx === -1) return;
      const existing = candles[idx];
      // Never overwrite open — first tick of period is canonical.
      // isLivePriceUpdate = true keeps the React setData effect skipped;
      // the chart is updated imperatively by the correction timer in AdvancedChart.
      set({
        candles: [
          ...candles.slice(0, idx),
          {
            ...existing,
            high:   candle.high,
            low:    candle.low,
            close:  candle.close,
            volume: candle.volume ?? existing.volume,
          },
          ...candles.slice(idx + 1),
        ],
        isLivePriceUpdate: true,
      });
    },
  };
}
