/**
 * @backtest-only
 *
 * Leg-pattern rule engine — public surface.
 *
 * Nothing outside this folder should import from the individual modules. In particular
 * `LegSegment` must never be referenced above `adapter.ts`: that file is the single place
 * where this repo's `'leg'` / `bullBear` / newest-first conventions are translated, and
 * keeping the translation to one site is what stops the ordering traps from spreading.
 */
import type { Candle } from '../../types';
import { buildLegSequence } from '../legSequence';
import { getAlBrooksRunUpTo } from '../indicators';
import { buildLegWindow as buildWindowFromSegments, type LegWindow } from './adapter';

export { buildLegWindow as buildLegWindowFromSegments, deriveDirArray, goodRuns, maxRunIn, IMPULSE, PULLBACK } from './adapter';
export type { LegFeature, LegWindow, GoodRuns } from './adapter';
export { computeAggregates, retracePct } from './aggregates';
export type { WindowAggregates } from './aggregates';
export { scoreWindow, goodLegPct } from './score';
export { compileLegPattern, getMatcher } from './matcher';
export type { Matcher, Verdict, VerdictSection } from './matcher';
export { describeLegPattern, describeSlot } from './describe';
export { compileLegList, compileLegSlot } from './compile';
export * from './schema';

export interface LegWindowOptions {
  /** Impulse legs to keep. Pullbacks are extra segments, so the array is longer than this. */
  windowLegs: number;
  /** Build with the per-candle arrays. Driven by the compiled matcher's `needsPerCandle`,
   *  NOT by `AutoBacktestConfig.legSequenceDetail` — see the note below. */
  needsPerCandle: boolean;
  /** Mean-candle-range baseline window. Session Settings' `barRangeLookback`. */
  baselineLookback?: number;
  /** Candle-overlap window for the score's constant term. Session Settings' `barOverlapLookback`. */
  overlapLookback?: number;
}

/**
 * Build the feature window for one bar.
 *
 * Two things here are load-bearing:
 *
 * 1. `getAlBrooksRunUpTo` supplies the leg history off the shared cache, filtered by each
 *    leg's FREEZE bar. Letting `buildLegSequence` recompute internally would cost a full
 *    O(n) state-machine pass per bar; filtering the cached history by `endIndex` instead
 *    would be lookahead. See the note on `CompletedLeg` in indicators.ts.
 *
 * 2. Detail is chosen by the compiled matcher, deliberately ignoring
 *    `AutoBacktestConfig.legSequenceDetail`. That setting governs what gets STAMPED on a
 *    trade record for later inspection; honouring it here would make a global `'avg'`
 *    silently render every run condition unevaluable, and unknown-fails semantics would
 *    then reject every bar with no cause the user could see. The unknown path still exists
 *    for the genuinely-missing case — a sequence restored from Firestore, where the arrays
 *    were stripped.
 */
export function buildLegWindow(
  candles: Candle[],
  currentIndex: number,
  opts: LegWindowOptions
): LegWindow {
  const run = getAlBrooksRunUpTo(candles, currentIndex);
  const segments = buildLegSequence(
    candles,
    currentIndex,
    opts.windowLegs,
    opts.needsPerCandle ? 'full' : 'avg',
    run
  );
  return buildWindowFromSegments(segments, candles, currentIndex, {
    baselineLookback: opts.baselineLookback,
    overlapLookback: opts.overlapLookback,
  });
}
