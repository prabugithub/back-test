/**
 * Retrace Guard — don't fade a strong bounce off an unbroken major low / high. Gate mode, both sides.
 *
 *   • short trigger — armed once price has bounced off the newest MAJOR swing low, closed at or
 *                     above `retraceGuardFrac` (0.5) of the leg down into it, and printed
 *                     `retraceGuardBullBars` (3) decent bull bars IN A ROW since the low. While
 *                     armed, a short is blocked only if the trigger bar's close is still INSIDE the
 *                     bounce zone: from `retraceGuardFrac` up to `retraceGuardMaxFrac` (1.25) of the
 *                     leg. A close below the low disarms it for good (that bar may itself enter).
 *   • long trigger  — the mirror off a major swing high, with bear bars.
 *
 * A bounce that has not reached the level, or has no such run of bars, never blocks.
 *
 * Why the zone. On swipe-4 (7 NSE 15m indices, two 3-year periods) blocking every armed short
 * until the low broke cut profit and PF: the blocked trades were the strategy's BEST ones. Two
 * groups were winners, not fades:
 *   - close already back under the 50% level → the bounce failed; it's a continuation short
 *   - close beyond ~1.25–1.5× the leg → the low is stale, the trend has moved on
 * Only the triggers still sitting in the bounce zone lost. Zone 0.5–1.25, 3 bars and a 1.6%
 * leg were the one setting that beat "no hook" on both periods.
 *
 * ── Definitions (pivot swings only, ctx.swings(1)) ────────────────────────────
 *
 *   • leg start H — walk the opposite swing points back from the low while each earlier one is
 *                   further out (higher high for a low) than the next; H is the furthest. That is
 *                   the start of the run of lower highs that fell into the low.
 *   • major low L — the newest swing low whose leg (H − L) is ≥ `retraceGuardMinLegPct` % of H.
 *                   A smaller pullback low (e.g. an HL during the bounce) does not replace it.
 *   • decent bar  — closes in the bounce direction with body ≥ `retraceGuardBodyMult` × the mean
 *                   body of the previous Bar Range Lookback bars (candleSizeVsAverage, the same
 *                   numbers as the chart's candle-click popup). No baseline → not decent.
 *
 * Swing points must sit inside the Entry Hook Candles window. Reads no bar after the trigger.
 */
import type { EntryHook } from '../utils/entryHook';
import type { SwingPoint } from '../utils/marketStructure';
import type { Candle } from '../types';
import { candleSizeVsAverage } from '../utils/pivotAnalysis';
import { probe } from './debug';

export const DEFAULT_RETRACE_GUARD = {
  /** Smallest leg (leg start → swing low/high), in % of the leg start price, that makes a major swing. */
  retraceGuardMinLegPct: 1.6,
  /** Fraction of the leg the bounce must close beyond to arm the guard; also the bottom of the
   *  blocking zone for the trigger bar's close. */
  retraceGuardFrac: 0.5,
  /** Top of the blocking zone, as a fraction of the leg: a trigger closing beyond it is allowed
   *  (the major swing is stale). */
  retraceGuardMaxFrac: 1.25,
  /** Decent bounce-direction bars required in a row since the major swing. */
  retraceGuardBullBars: 3,
  /** Body ÷ mean body of the previous Bar Range Lookback bars for a bar to count as decent. */
  retraceGuardBodyMult: 1.0,
} as const;

export type RetraceGuardSettings = { -readonly [K in keyof typeof DEFAULT_RETRACE_GUARD]: number };

export function retraceGuardSettings(c: Partial<RetraceGuardSettings>): RetraceGuardSettings {
  const d = DEFAULT_RETRACE_GUARD;
  const num = (v: number | undefined) => Number.isFinite(v);
  return {
    retraceGuardMinLegPct: num(c.retraceGuardMinLegPct) ? Math.max(0, c.retraceGuardMinLegPct as number) : d.retraceGuardMinLegPct,
    retraceGuardFrac: num(c.retraceGuardFrac) && (c.retraceGuardFrac as number) > 0 ? (c.retraceGuardFrac as number) : d.retraceGuardFrac,
    retraceGuardMaxFrac: num(c.retraceGuardMaxFrac) ? (c.retraceGuardMaxFrac as number) : d.retraceGuardMaxFrac,
    retraceGuardBullBars: num(c.retraceGuardBullBars) ? Math.max(1, Math.floor(c.retraceGuardBullBars as number)) : d.retraceGuardBullBars,
    retraceGuardBodyMult: num(c.retraceGuardBodyMult) ? Math.max(0, c.retraceGuardBodyMult as number) : d.retraceGuardBodyMult,
  };
}

export interface RetraceGuardRead {
  blocked: boolean;
  reason: string;
  /** The judged major swing's price, or null when none qualifies. */
  major: number | null;
  /** Retrace level (major + frac × leg), or null. */
  level: number | null;
}

/**
 * Pure verdict for a trigger at bar `now` (absolute). `long` = the trigger side: a short is judged
 * against the newest major swing LOW, a long against the newest major swing HIGH. `points` are
 * alternating re-anchored swing points with absolute bar indices (ctx.swings(1)).
 */
export function retraceGuardRead(
  candles: Candle[], points: readonly SwingPoint[], now: number, long: boolean,
  s: RetraceGuardSettings, bodyLookback: number,
): RetraceGuardRead {
  // Bounce space u: for a short trigger the bounce goes UP off a low (u = price); for a long it
  // goes DOWN off a high (u = −price). In u-space the major swing is a low and its leg start a high.
  const sgn = long ? -1 : 1;
  const ext = long ? 'high' : 'low';
  const name = long ? 'major high' : 'major low';
  const bounce = long ? 'bear' : 'bull';

  for (let j = points.length - 1; j >= 0; j--) {
    const p = points[j];
    if (p.type !== ext || p.barIndex >= now) continue;
    // Leg start: walk the opposite-type points back while each earlier one is further out and the
    // swing between them stayed above this low (a lower low in between belongs to an older leg).
    let k = j - 1;
    while (k >= 0 && points[k].type === ext) k--;
    if (k < 0) continue;
    let start = points[k];
    for (
      let m = k - 2;
      m >= 0 && points[m].type !== ext && sgn * points[m].price > sgn * points[m + 2].price && sgn * points[m + 1].price > sgn * p.price;
      m -= 2
    ) {
      if (sgn * points[m].price > sgn * start.price) start = points[m];
    }
    const uL = sgn * p.price, uH = sgn * start.price;
    const leg = uH - uL;
    if (!(leg > 0) || leg / Math.abs(start.price) * 100 < s.retraceGuardMinLegPct) continue;

    // Newest major swing found — judge the bounce off it.
    const levelU = uL + s.retraceGuardFrac * leg;
    const level = sgn * levelU;
    const fmt = (v: number) => v.toFixed(2);
    let run = 0, runOk = false, reached = false, armedAt = -1;
    for (let b = p.barIndex + 1; b <= now; b++) {
      const c = candles[b];
      const uc = sgn * c.close;
      if (uc < uL) {
        return { blocked: false, major: p.price, level, reason: `${name} ${fmt(p.price)} broken` };
      }
      const decent = sgn * (c.close - c.open) > 0 &&
        (candleSizeVsAverage(candles, b, bodyLookback).bodyX ?? -1) >= s.retraceGuardBodyMult;
      run = decent ? run + 1 : 0;
      if (run >= s.retraceGuardBullBars) runOk = true;
      if (uc >= levelU) reached = true;
      if (armedAt < 0 && runOk && reached) armedAt = b;
    }
    const pct = (s.retraceGuardFrac * 100).toFixed(0);
    const pos = (sgn * candles[now].close - uL) / leg;
    if (armedAt >= 0 && pos < s.retraceGuardFrac) {
      return { blocked: false, major: p.price, level, reason: `${name} ${fmt(p.price)}: bounce failed, close back under ${pct}% (${fmt(level)})` };
    }
    if (armedAt >= 0 && pos >= s.retraceGuardMaxFrac) {
      return { blocked: false, major: p.price, level,
        reason: `${name} ${fmt(p.price)}: close ${(pos * 100).toFixed(0)}% of the leg, beyond ${(s.retraceGuardMaxFrac * 100).toFixed(0)}% — stale` };
    }
    if (armedAt >= 0) {
      return {
        blocked: true, major: p.price, level,
        reason: `${name} ${fmt(p.price)} (leg from ${fmt(start.price)}) retraced ≥${pct}% (${fmt(level)}) with ` +
          `${s.retraceGuardBullBars} ${bounce} bars ${now - armedAt} bars ago, close at ${(pos * 100).toFixed(0)}% of the leg, ${long ? 'long' : 'short'} blocked`,
      };
    }
    return {
      blocked: false, major: p.price, level,
      reason: `${name} ${fmt(p.price)}: ${reached ? '' : `no close beyond ${pct}% (${fmt(level)})`}` +
        `${!reached && !runOk ? ', ' : ''}${runOk ? '' : `no ${s.retraceGuardBullBars} ${bounce} bars in a row`}`,
    };
  }
  return { blocked: false, major: null, level: null, reason: `no ${name}` };
}

export const retraceGuard: EntryHook = ctx => {
  const long = ctx.trigger.side === 'long';
  const v = retraceGuardRead(
    ctx.fullCandles, ctx.swings(1), ctx.absoluteIndex, long,
    retraceGuardSettings(ctx.config), ctx.config.barRangeLookback ?? 20,
  );
  probe(ctx, { rgBlocked: v.blocked, rgMajor: v.major, rgLevel: v.level, rgReason: v.reason });
  if (v.blocked) return false;
  ctx.log(v.reason);
  return true;
};
