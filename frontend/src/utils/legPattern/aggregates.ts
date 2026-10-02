/**
 * @backtest-only
 *
 * Leg-pattern engine — whole-window aggregates (§3).
 *
 * Coarse scalars over the entire window. Two jobs: cheap gating before the expensive
 * matcher runs (a handful of scalar comparisons typically rejects most windows), and the
 * vocabulary window clauses are written in.
 *
 * NAMING WARNING: `legEfficiency` here is a LEG-window ratio — net displacement over the
 * total path walked across the segments. The codebase separately exports a BAR-window
 * Kaufman efficiency ratio (`calculateEfficiencyRatio` in pivotAnalysis.ts, surfaced as
 * `EntryMetricsSnapshot.efficiencyRatio`). They answer different questions over different
 * windows. They are kept under distinct names on purpose; conflating them will cost you an
 * afternoon.
 */
import type { LegWindow } from './adapter';
import { IMPULSE } from './adapter';
import { goodLegPct } from './score';
import type { WindowField } from './schema';

const clamp01 = (v: number): number => (v > 1 ? 1 : v < 0 ? 0 : v);

/** Every §3 scalar. `undefined` means "not measurable in this window" and must fail a
 *  numeric comparison rather than being coerced to 0 — see the `goodLegPct` note. */
export type WindowAggregates = Record<WindowField, number | undefined>;

export function computeAggregates(
  window: LegWindow,
  scores: number[] | null,
  legStrength: number
): WindowAggregates {
  const f = window.features;

  let nBull = 0;
  let nBear = 0;
  let sumBull = 0;
  let sumBear = 0;
  let impulseCount = 0;
  let barsCovered = 0;
  let sumAbsMove = 0;
  let brrTotal = 0;
  let clvTotal = 0;
  let maxGoodRun = 0;
  let depthSum = 0;
  let depthCount = 0;

  for (const leg of f) {
    barsCovered += leg.barCount;
    sumAbsMove += leg.absMovePct;
    brrTotal += leg.brr;
    clvTotal += leg.dirClv;
    if (leg.maxRun > maxGoodRun) maxGoodRun = leg.maxRun;
    if (leg.depthRatio > 0) {
      depthSum += leg.depthRatio;
      depthCount++;
    }
    if (leg.kind !== IMPULSE) continue;
    impulseCount++;
    if (leg.realizedDir > 0) {
      nBull++;
      sumBull += leg.absMovePct;
    } else if (leg.realizedDir < 0) {
      nBear++;
      sumBear += leg.absMovePct;
    }
  }

  // Efficiency: net displacement across the window over the total path walked.
  // Toward 1 a clean trend, toward 0 chop. Newest-first, so the window starts at the
  // OLDEST segment's open and ends at the NEWEST segment's close.
  const oldest = f[f.length - 1];
  const newest = f[0];
  const netMovePct =
    oldest && newest && oldest.startPrice
      ? Math.abs((newest.endPrice - oldest.startPrice) / oldest.startPrice) * 100
      : 0;

  // What the current bar is reacting to: the most recent impulse leg, or failing that
  // just the newest segment.
  const recent = f.find(x => x.kind === IMPULSE) ?? f[0];

  return {
    legCount: f.length,
    impulseCount,
    barsCovered,
    nBull,
    nBear,
    legBalance: nBull - nBear,
    dominance: sumBull + sumBear > 0 ? sumBull / (sumBull + sumBear) : 0.5,
    legEfficiency: sumAbsMove > 0 ? clamp01(netMovePct / sumAbsMove) : 0,
    netMovePct,
    sumAbsMove,
    pullbackDepth: depthCount > 0 ? depthSum / depthCount : 0,
    moveEfficiency: recent && recent.barCount > 0 ? recent.absMovePct / recent.barCount : 0,
    avgBrr: f.length > 0 ? brrTotal / f.length : 0,
    avgDirClv: f.length > 0 ? clvTotal / f.length : 0,
    maxGoodRun,
    goodLegPct: scores ? goodLegPct(window, scores, legStrength) : undefined,
  };
}

/**
 * How far into the whole recent structure price has come back by now (§9).
 *
 * Per-segment `depthRatio` answers a LOCAL question — how deep is this pullback against
 * the one leg it retraced. A shallow pullback off a two-candle leg and a shallow pullback
 * off the whole morning's range score identically there. This answers the other one.
 *
 * Returns NaN when the window has no height — unmeasurable, and NaN fails the `<=` test
 * naturally, so the window is excluded rather than waved through.
 *
 * The newest segment is itself in the window, so `current` always lies inside
 * [windowLow, windowHigh] and the result is bounded to [0, 100] by construction.
 */
export function retracePct(window: LegWindow, windowLegs: number, isLong: boolean): number {
  const slice = window.features.slice(0, Math.max(1, windowLegs));
  if (slice.length === 0) return NaN;

  let high = -Infinity;
  let low = Infinity;
  for (const f of slice) {
    if (f.high > high) high = f.high;
    if (f.low < low) low = f.low;
  }
  const height = high - low;
  if (!(height > 0)) return NaN;

  const current = slice[0].endPrice; // newest-first — the current bar's close
  return isLong ? ((high - current) / height) * 100 : ((current - low) / height) * 100;
}
