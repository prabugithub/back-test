/**
 * Market-time holding duration.
 *
 * Counts only time the market was actually open between entry and exit, so weekends and
 * exchange holidays (leave days) are excluded. Open days and session hours are taken from the
 * loaded candles: a date with no candles was a weekend or holiday. Each day's session runs from
 * its first candle's open to its last candle's open + the candle interval.
 */

const IST_OFFSET = 19800;                 // seconds, UTC+5:30
const DEFAULT_OPEN = 9 * 3600 + 15 * 60;  // 09:15 IST
const DEFAULT_CLOSE = 15 * 3600 + 30 * 60; // 15:30 IST
const DEFAULT_SESSION_MIN = (DEFAULT_CLOSE - DEFAULT_OPEN) / 60; // 375

interface Session { openSec: number; closeSec: number }

export interface SessionIndex {
  sessions: Map<number, Session>; // IST day key → session bounds (UTC epoch seconds)
  firstDay: number;
  lastDay: number;
  sessionMinutes: number;          // typical session length, used for day roll-over
}

export interface MarketDuration {
  minutes: number;
  approx: boolean; // true when part of the range fell outside the loaded candles
}

const toSec = (ts: number) => (ts > 1e11 ? ts / 1000 : ts);
const dayKey = (sec: number) => Math.floor((sec + IST_OFFSET) / 86400);
const fixedSession = (day: number): Session => {
  const istMidnightUtc = day * 86400 - IST_OFFSET;
  return { openSec: istMidnightUtc + DEFAULT_OPEN, closeSec: istMidnightUtc + DEFAULT_CLOSE };
};
// Day key 0 = 1970-01-01 (Thursday). 0 = Sunday … 6 = Saturday.
const isWeekday = (day: number) => {
  const dow = (((day + 4) % 7) + 7) % 7;
  return dow >= 1 && dow <= 5;
};

function mode(values: number[]): number | null {
  const counts = new Map<number, number>();
  let best: number | null = null;
  let bestCount = 0;
  for (const v of values) {
    const c = (counts.get(v) ?? 0) + 1;
    counts.set(v, c);
    if (c > bestCount) { best = v; bestCount = c; }
  }
  return best;
}

export function buildSessionIndex(candles: { timestamp: number }[]): SessionIndex {
  const ts = candles.map(c => toSec(c.timestamp)).sort((a, b) => a - b);
  const byDay = new Map<number, { first: number; last: number }>();
  const intradayGaps: number[] = [];

  for (let i = 0; i < ts.length; i++) {
    const d = dayKey(ts[i]);
    const e = byDay.get(d);
    if (e) {
      if (ts[i] > e.last) intradayGaps.push(ts[i] - e.last);
      e.last = ts[i];
    } else {
      byDay.set(d, { first: ts[i], last: ts[i] });
    }
  }

  // Daily+ timeframes have no intraday gaps → fall back to the standard NSE session per open day.
  const interval = mode(intradayGaps);
  const sessions = new Map<number, Session>();
  const lengths: number[] = [];
  for (const [d, { first, last }] of byDay) {
    const s = interval ? { openSec: first, closeSec: last + interval } : fixedSession(d);
    sessions.set(d, s);
    lengths.push(Math.round((s.closeSec - s.openSec) / 60));
  }

  const days = [...byDay.keys()];
  return {
    sessions,
    firstDay: days.length ? Math.min(...days) : Infinity,
    lastDay: days.length ? Math.max(...days) : -Infinity,
    sessionMinutes: mode(lengths) ?? DEFAULT_SESSION_MIN,
  };
}

/** In-market minutes held between entry and exit (ms or seconds). */
export function marketDuration(index: SessionIndex, entryTs: number, exitTs: number): MarketDuration {
  const entry = toSec(entryTs);
  const exit = toSec(exitTs);
  if (exit <= entry) return { minutes: 0, approx: false };

  let seconds = 0;
  let approx = false;
  for (let d = dayKey(entry), end = dayKey(exit); d <= end; d++) {
    let s: Session | undefined;
    if (d >= index.firstDay && d <= index.lastDay) {
      s = index.sessions.get(d); // missing → weekend / holiday
    } else {
      approx = true;
      if (isWeekday(d)) s = fixedSession(d);
    }
    if (!s) continue;
    const from = Math.max(entry, s.openSec);
    const to = Math.min(exit, s.closeSec);
    if (to > from) seconds += to - from;
  }
  return { minutes: Math.round(seconds / 60), approx };
}

/** "3h 20m" under one session; "1d 2h 15m" otherwise (1 day = one full session). Zero parts omitted. */
export function formatMarketDuration(minutes: number, sessionMinutes: number): string {
  const days = sessionMinutes > 0 ? Math.floor(minutes / sessionMinutes) : 0;
  const rem = minutes - days * sessionMinutes;
  const h = Math.floor(rem / 60);
  const m = rem % 60;
  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  return parts.length ? parts.join(' ') : '0m';
}
