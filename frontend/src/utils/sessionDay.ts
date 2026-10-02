// Trading-day boundary primitives: which bar opened the session the entry bar
// belongs to, and how far the session gapped from the previous day's close.
//
// Pure: candles in, typed result out. No store access, no config — every value
// here is fixed by the data's own day boundary, so there is no lookback to tune.

import type { Candle, Trade } from '../types';

// IST = UTC+5:30. Same constant as resampler.ts — candle timestamps are true
// UTC epoch seconds (local NIFTY JSON is corrected back with a -19800 offset at
// load time), so we shift into IST before splitting off the day.
const IST_OFFSET = 19800;

/**
 * IST calendar-day number for a UTC-epoch-seconds candle timestamp.
 *
 * The Indian session (09:15–15:30 IST) never crosses IST midnight, so the
 * calendar day is an exact session key — no session-relative bucketing needed.
 * Deliberately not `new Date(...).getDate()`, which would depend on the
 * browser's timezone being IST.
 */
export function istDayIndex(timestamp: number): number {
  return Math.floor((timestamp + IST_OFFSET) / 86400);
}

export interface SessionOpenContext {
  /** Index in `candles` of the first bar of the entry bar's trading day. */
  openBarIndex: number;
  /** Timestamp of that bar (Unix seconds, same unit as Candle). */
  openBarTimestamp: number;
  /** Open price of that bar — the session open. */
  dayOpen: number;
  /** Close of the last bar of the previous trading day. Absent on the array's first day. */
  prevDayClose?: number;
  /** Signed dayOpen - prevDayClose; positive = gap up, negative = gap down. */
  gapPoints?: number;
  /** gapPoints as a percentage of prevDayClose. */
  gapPercent?: number;
  /** Bars elapsed from the open bar to `index`; 0 on the open bar itself. */
  barsSinceOpen: number;
}

/**
 * Walks back from `index` to the first bar sharing its IST calendar day.
 * Bounded by bars-per-day (75 on 5m), so no caching is warranted.
 *
 * Returns undefined only for an out-of-range index. Gap fields are left
 * undefined — never 0 — when there is no previous trading day in the array, so
 * "no data" stays distinguishable from "flat open".
 */
export function getSessionOpenContext(candles: Candle[], index: number): SessionOpenContext | undefined {
  if (index < 0 || index >= candles.length) return undefined;

  const day = istDayIndex(candles[index].timestamp);
  let openBarIndex = index;
  while (openBarIndex > 0 && istDayIndex(candles[openBarIndex - 1].timestamp) === day) {
    openBarIndex--;
  }

  const openBar = candles[openBarIndex];
  const prevDayClose = openBarIndex > 0 ? candles[openBarIndex - 1].close : undefined;
  const gapPoints = prevDayClose !== undefined ? openBar.open - prevDayClose : undefined;

  return {
    openBarIndex,
    openBarTimestamp: openBar.timestamp,
    dayOpen: openBar.open,
    prevDayClose,
    gapPoints,
    gapPercent:
      gapPoints !== undefined && prevDayClose !== undefined && prevDayClose > 0
        ? (gapPoints / prevDayClose) * 100
        : undefined,
    barsSinceOpen: index - openBarIndex,
  };
}

/**
 * The session-open `*AtEntry` slice of a Trade, ready to spread/assign.
 *
 * Lifted out so both stamping paths — buildEntryInstrumentation (manual + live
 * replay) and batchBacktestSimulator (headless) — write byte-identical values
 * instead of growing a second copy that can drift. Keys whose value is
 * undefined are omitted entirely (Firestore rejects explicit undefined).
 */
export function buildSessionOpenFields(candles: Candle[], index: number): Partial<Trade> {
  const ctx = getSessionOpenContext(candles, index);
  if (!ctx) return {};

  const fields: Partial<Trade> = {
    openBarTimestampAtEntry: ctx.openBarTimestamp,
    dayOpenAtEntry: ctx.dayOpen,
    barsSinceOpenAtEntry: ctx.barsSinceOpen,
  };
  if (ctx.prevDayClose !== undefined) fields.prevDayCloseAtEntry = ctx.prevDayClose;
  if (ctx.gapPoints !== undefined) fields.gapPointsAtEntry = ctx.gapPoints;
  if (ctx.gapPercent !== undefined) fields.gapPercentAtEntry = ctx.gapPercent;
  return fields;
}
