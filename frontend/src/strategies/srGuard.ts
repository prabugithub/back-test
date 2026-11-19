/**
 * S/R Guard — vetoes entries into opposing support / resistance. Meant for GATE mode: the
 * regime's own chain (entry mode, filters, SL, target, sizing) decides the trade, and this
 * hook can only refuse it. It never changes side, stop, target or quantity.
 *
 * Two kinds of barrier, mirrored per side (resistance for longs, support for shorts):
 *
 *   1. Counter trendline — a FALLING resistance line (rising support for shorts) from the
 *      pivot trendlines (Session Settings → Trendlines), whose first and last touch are at
 *      least TL_MIN_SPAN_BARS apart. While it is intact the side is blocked, however far away.
 *
 *   2. Horizontal swing level — a REAL swing top (bottom), not every pivot: the highest high of
 *      LEVEL_SIDE_BARS bars on each side, followed by a drop of at least LEVEL_REJECT_PCT
 *      before price closed back above it. While intact it only blocks when price is within
 *      LEVEL_NEAR_PCT of it — an entry with room to the level is fine.
 *
 * Breaks: the FIRST close through a barrier is never traded. The side opens on the second
 * entry — a retest (wick back to the barrier, close on the breakout side), a pullback swing
 * low (high) that holds beyond it, or a re-break after falling back inside.
 *
 * Why trend entries survive: LEVEL_NEAR_PCT is below LEVEL_REJECT_PCT, so a pullback entry at
 * the bottom of the very pullback that made a top a level is never "near" that top; and once
 * a level breaks, the first pullback that holds above it is the second entry that reopens it.
 *
 * Look-ahead safe: reads only candles, pivots and trendline states ≤ the trigger bar.
 */
import type { Candle } from '../types';
import type { EntryHook } from '../utils/entryHook';
import type { PivotPoint } from '../utils/indicators';
import type { AutoBacktestConfig } from '../utils/autoBacktestEngine';
import { getTrendlinesAt, trendlinePriceAt, type Trendline } from '../utils/marketStructure';
import { probe } from './debug';

/** Counter trendline: min bars between the line's first and last pivot touch. Short lines are
 *  local wiggles; 80 bars is the "real trend line" bar you asked for. */
const TL_MIN_SPAN_BARS = 80;
/** Counter trendline: bars a line is remembered after it last appeared in a trendline state.
 *  A broken line leaves the state at once, so without memory its break could not be tracked. */
const TL_MEMORY_BARS = 100;

/** Horizontal level: how far back swing tops / bottoms are searched. */
const LEVEL_LOOKBACK_BARS = 150;
/** Horizontal level: a top must be the highest high of this many bars on EACH side. The right
 *  side must already have printed, so a top is known LEVEL_SIDE_BARS bars after it. */
const LEVEL_SIDE_BARS = 10;
/** Horizontal level: price must fall at least this % from the top before closing back above
 *  it. This is what separates a rejection from an ordinary pivot. */
const LEVEL_REJECT_PCT = 0.5;
/** Horizontal level: tops within this % merge into one level; also the touch / break band. */
const LEVEL_TOL_PCT = 0.05;
/** Horizontal level: an intact level closer than this % to the close blocks the entry. Keep it
 *  below LEVEL_REJECT_PCT (see the header) or pullback entries in a trend get blocked. */
const LEVEL_NEAR_PCT = 0.3;

// ─── Barriers and their state ─────────────────────────────────────────────────

export type BarrierState = 'intact' | 'first_break' | 'retest' | 'held' | 'rebreak';

export interface Barrier {
  kind: 'trendline' | 'level';
  priceAt(bar: number): number;
  tol: number;      // break / touch band in price
  from: number;     // last bar the barrier is known intact — the walk starts after it
  anchorBar: number; // newest swing the barrier is drawn through
}

export interface BarrierRead {
  barrier: Barrier;
  state: BarrierState;
  firstBreak: number; // bar of the first close through it, -1 if never
}

/**
 * Walk one barrier from `b.from + 1` to `index`. `long` = the barrier is overhead resistance
 * (breaking it means closing ABOVE); shorts mirror on support. `heldPivots` holds the bars of
 * confirmed same-side swing points (bullish pivots for a long) and their prices.
 */
export function barrierState(
  candles: Candle[], index: number, b: Barrier, long: boolean, heldPivots: Map<number, number>,
): BarrierRead {
  const sgn = long ? 1 : -1;
  let beyond = false, breaks = 0, second: BarrierState | null = null, firstBreak = -1;
  for (let x = b.from + 1; x <= index; x++) {
    const at = b.priceAt(x);
    const d = sgn * (candles[x].close - at);
    if (!beyond) {
      if (d > b.tol) {
        beyond = true;
        breaks++;
        if (firstBreak < 0) firstBreak = x;
        second = breaks >= 2 ? 'rebreak' : null;
      }
      continue;
    }
    if (d < 0) { beyond = false; second = null; continue; } // back inside — that break failed
    if (second) continue;
    const pv = heldPivots.get(x);
    if (pv !== undefined && sgn * (pv - at) >= -b.tol) second = 'held';
    else if (long ? candles[x].low <= at + b.tol : candles[x].high >= at - b.tol) second = 'retest';
  }
  return { barrier: b, state: !beyond ? 'intact' : second ?? 'first_break', firstBreak };
}

/** Counter trendlines as barriers: falling resistance (long) / rising support (short) with a
 *  span ≥ minSpan, gathered from the states of the last `memory` bars. */
export function counterTrendlines(
  candles: Candle[], index: number, config: Readonly<AutoBacktestConfig>, long: boolean,
  minSpan = TL_MIN_SPAN_BARS, memory = TL_MEMORY_BARS,
): Barrier[] {
  const seen = new Map<string, Barrier>();
  for (let j = index; j >= Math.max(0, index - memory); j--) {
    const st = getTrendlinesAt(candles, j, config);
    if (!st) continue;
    for (const l of long ? st.resistance : st.support) {
      if (l.lastTouchBar - l.firstBar < minSpan) continue;
      if (long ? l.slope >= 0 : l.slope <= 0) continue;
      if (Math.abs(l.slope) * Math.max(1, j - l.firstBar) <= l.tolerance) continue; // flat — not a trend line
      const k = `${l.slope.toFixed(6)}|${l.intercept.toFixed(2)}`;
      if (!seen.has(k)) seen.set(k, lineBarrier(l, j));
    }
  }
  return [...seen.values()];
}

function lineBarrier(l: Trendline, intactAt: number): Barrier {
  return { kind: 'trendline', priceAt: x => trendlinePriceAt(l, x), tol: l.tolerance, from: intactAt, anchorBar: l.lastTouchBar };
}

/** Real swing tops (long) / bottoms (short) in the last `lookback` bars as flat barriers. */
export function findSwingLevels(
  candles: Candle[], index: number, long: boolean,
  lookback = LEVEL_LOOKBACK_BARS, side = LEVEL_SIDE_BARS, rejectPct = LEVEL_REJECT_PCT, tolPct = LEVEL_TOL_PCT,
): Barrier[] {
  const ext = (x: number) => (long ? candles[x].high : candles[x].low);
  const tops: Array<{ bar: number; price: number }> = [];
  for (let t = Math.max(side, index - lookback); t <= index - side; t++) {
    const p = ext(t);
    let dominant = true;
    for (let x = t - side; x <= t + side && dominant; x++) {
      if (x === t) continue;
      // Strict on the left, ≥ on the right: an equal-high double top keeps its first bar.
      if (long ? (x < t ? ext(x) >= p : ext(x) > p) : (x < t ? ext(x) <= p : ext(x) < p)) dominant = false;
    }
    if (!dominant) continue;
    // Rejection: the furthest price travelled away before a close back through the top.
    const tol = (p * tolPct) / 100;
    let away = p;
    for (let x = t + 1; x <= index; x++) {
      if (long ? candles[x].close > p + tol : candles[x].close < p - tol) break;
      away = long ? Math.min(away, candles[x].low) : Math.max(away, candles[x].high);
    }
    if ((Math.abs(p - away) / p) * 100 >= rejectPct) tops.push({ bar: t, price: p });
  }
  // Merge tops within tolerance into one level: the more extreme price, the newest bar.
  const merged: Array<{ bar: number; price: number }> = [];
  for (const tp of tops) {
    const m = merged.find(q => (Math.abs(q.price - tp.price) / tp.price) * 100 <= tolPct);
    if (!m) merged.push({ ...tp });
    else { m.price = long ? Math.max(m.price, tp.price) : Math.min(m.price, tp.price); m.bar = Math.max(m.bar, tp.bar); }
  }
  return merged.map(q => ({
    kind: 'level' as const, priceAt: () => q.price, tol: (q.price * tolPct) / 100, from: q.bar, anchorBar: q.bar,
  }));
}

// ─── Verdict ──────────────────────────────────────────────────────────────────

export interface SrGuardVerdict {
  allowed: boolean;
  /** Why it was blocked, or what was checked when allowed — goes into the trade reason. */
  reason: string;
  tlState: BarrierState | 'none';   // worst counter-trendline state
  levelPrice: number | null;        // nearest intact level on the trade's side
  levelRoomPct: number | null;      // room to it, % of close (negative = within the band)
  levelState: BarrierState | 'none'; // worst horizontal-level state
}

const RANK: Record<BarrierState | 'none', number> = { none: 0, retest: 1, held: 1, rebreak: 1, intact: 2, first_break: 3 };

export function srGuardRead(
  candles: Candle[], index: number, pivots: readonly PivotPoint[], config: Readonly<AutoBacktestConfig>, long: boolean,
): SrGuardVerdict {
  const close = candles[index].close;
  const heldPivots = new Map<number, number>();
  for (const p of pivots) if (p.barIndex <= index && p.type === (long ? 'bullish' : 'bearish')) heldPivots.set(p.barIndex, p.price);

  const reads = [
    ...counterTrendlines(candles, index, config, long),
    ...findSwingLevels(candles, index, long),
  ].map(b => barrierState(candles, index, b, long, heldPivots));

  // A swing printed after a barrier broke belongs to the breakout's own pullback; a trendline
  // through it is a flatter "fan" of the broken line, and a level at it is the breakout high.
  // Fans are skipped (they would block every retest); breakout highs stay — rallying back
  // into them is a real "near resistance" entry.
  const lineBreaks = reads.filter(r => r.barrier.kind === 'trendline' && r.firstBreak >= 0).map(r => r.firstBreak);
  const brokeAt = lineBreaks.length ? Math.min(...lineBreaks) : Infinity;
  const live = reads.filter(r => !(r.barrier.kind === 'trendline' && r.barrier.anchorBar > brokeAt));

  const worst = (kind: Barrier['kind']) =>
    live.filter(r => r.barrier.kind === kind).reduce<BarrierState | 'none'>((w, r) => (RANK[r.state] > RANK[w] ? r.state : w), 'none');
  const tlState = worst('trendline');
  const levelState = worst('level');

  let levelPrice: number | null = null, levelRoomPct: number | null = null;
  for (const r of live) {
    if (r.barrier.kind !== 'level' || r.state !== 'intact') continue;
    const lv = r.barrier.priceAt(index);
    const room = ((long ? lv - close : close - lv) / close) * 100;
    if (levelRoomPct === null || room < levelRoomPct) { levelRoomPct = room; levelPrice = lv; }
  }

  const blocks: string[] = [];
  if (tlState === 'intact') blocks.push('counter TL intact');
  if (tlState === 'first_break') blocks.push('counter TL first break');
  if (levelState === 'first_break') blocks.push('level first break');
  if (levelRoomPct !== null && levelRoomPct < LEVEL_NEAR_PCT) blocks.push(`near ${long ? 'res' : 'sup'} ${levelPrice!.toFixed(1)}`);

  const lvl = levelPrice === null ? `${long ? 'res' : 'sup'}=none` : `${long ? 'res' : 'sup'}=${levelPrice.toFixed(1)} room=${levelRoomPct!.toFixed(2)}%`;
  return {
    allowed: blocks.length === 0,
    reason: blocks.length ? `SR blocked: ${blocks.join(', ')}` : `SR ok: tl=${tlState} lvl=${levelState} ${lvl}`,
    tlState, levelPrice, levelRoomPct, levelState,
  };
}

// ─── The hook ─────────────────────────────────────────────────────────────────

export const srGuard: EntryHook = ctx => {
  const long = ctx.trigger.side === 'long';
  const v = srGuardRead(ctx.fullCandles, ctx.absoluteIndex, ctx.pivots, ctx.config, long);
  probe(ctx, {
    srAllowed: v.allowed,
    srTl: v.tlState,
    srLevel: v.levelState,
    srLevelPrice: v.levelPrice,
    srRoomPct: v.levelRoomPct === null ? null : Number(v.levelRoomPct.toFixed(3)),
    srReason: v.reason,
  });
  if (!v.allowed) return false;
  ctx.log(v.reason);
  return true;
};
