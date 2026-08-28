/**
 * @backtest-only
 *
 * Leg-pattern engine — the adapter boundary.
 *
 * Turns this repo's `LegSegment[]` into the engine's `LegFeature[]`. Everything above this
 * file is portable; every convention mismatch is reconciled HERE and nowhere else:
 *
 *  1. ORDERING. The segment array is NEWEST-FIRST (index 0 is closest to the current bar)
 *     while the per-candle arrays inside each segment are OLDEST-FIRST. Both are correct,
 *     they simply run in opposite directions, and that is the single most bug-prone fact
 *     in this subsystem. The engine keeps newest-first for segments and oldest-first
 *     within a segment — i.e. it adopts both conventions unchanged rather than flipping
 *     one and having to remember which.
 *
 *  2. `kind`. legSequence.ts says 'leg'; the engine says impulse (0) / pullback (1).
 *
 *  3. PER-CANDLE DIRECTION. `LegSegment.bullBear` is `0|1` where **0 means bear OR doji**.
 *     The engine needs tri-state (1 / -1 / 0) because a doji must break a conviction run
 *     regardless of its body ratio. Mapping 0 → -1 would silently corrupt every run
 *     condition, so direction is derived from the raw `o`/`c` series instead (and, when
 *     those are absent, from `brr === 0` — which is exactly the zero-body test).
 *
 *  4. PULLBACK DIRECTION. legSequence.ts tags a pullback with the direction OPPOSITE the
 *     leg it retraces. That is a convention, not a bug; it is carried through unchanged.
 */
import type { Candle, LegSegment } from '../../types';
import { calculateBarRanges, averageBarRanges, calculateBarOverlap, averageBarOverlap, calculateConsecutiveBreaks } from '../pivotAnalysis';
import { DEFAULT_RUN_MIN_BRR } from './schema';

export const IMPULSE = 0;
export const PULLBACK = 1;

/** Conviction-run breakdown inside one segment (§2.1). */
export interface GoodRuns {
  maxRun: number;
  run2: number;
  run3: number;
  run4: number;
}

/** One segment, with everything the matcher can ask about it precomputed.
 *  Computed once per window, before matching. */
export interface LegFeature {
  /** The segment this was derived from — kept for explain()/describe() and chart mapping. */
  seg: LegSegment;
  index: number;

  kind: 0 | 1;                 // IMPULSE | PULLBACK
  structDir: 1 | 0 | -1;       // what the leg machine labelled it
  realizedDir: 1 | 0 | -1;     // where it actually ended up
  barCount: number;
  absMovePct: number;
  startPrice: number;
  endPrice: number;
  high: number;
  low: number;

  highBreakCount: number;
  lowBreakCount: number;
  /** Breaks in the direction the segment actually travelled, over its bar count. */
  breakPersist: number;
  /** Longest BACK-TO-BACK run of candles each breaking the previous one's extreme.
   *  Distinct from breakCount, which does not require them to be consecutive. Computed
   *  from the raw candles via the repo's calculateConsecutiveBreaks, so it needs no
   *  per-candle arrays and is never unknown. An outside bar resets the run. */
  maxHighBreakRun: number;
  maxLowBreakRun: number;
  /** Mean close-location, mirrored for down segments so higher is always better. */
  dirClv: number;
  brr: number;

  /** Absolute move against this window's own scale — not an absolute one. */
  moveVsMedian: number;
  /** Mean candle range inside the segment vs the recent baseline. Above 1 is oversized. */
  rangeRatio: number;
  /** Oversized candles are exhaustion risk, so this is a penalty, never a reward. */
  climaxPenalty: number;

  maxRun: number;
  runLength: number;
  runs: GoodRuns;

  /** Pullback depth against the leg it retraced. Impulse legs keep 0 — conditions on it
   *  are meaningful for pullbacks only. A nested pullback rule overrides this with the
   *  depth against its OWN slot's leg, which is exact by construction. */
  depthRatio: number;

  /** This segment runs up to and including the current bar, so its stats are incomplete
   *  and will keep changing as the bar advances. Practically always index 0. */
  isForming: boolean;

  /** Per-candle series, OLDEST-FIRST within the segment. `null` when the sequence was
   *  built at 'avg' detail (or restored from Firestore, which strips them) — in which
   *  case run conditions are UNKNOWN, and unknown fails and is counted. */
  brrArr: number[] | null;
  dirArr: (1 | 0 | -1)[] | null;
}

/** A whole window: the segments plus the scalars that only make sense across all of them. */
export interface LegWindow {
  features: LegFeature[];
  /** Median absolute % move across ALL segments — impulses and pullbacks alike. Per
   *  window, not global. */
  medianAbsMove: number;
  /** Mean candle range over the recent baseline lookback, ending at the current bar.
   *  Substituting a lookalike (an ATR, a body average, a different window) silently
   *  corrupts rangeRatio, climaxPenalty and every climax guard built on them, with no
   *  symptom other than wrong answers. */
  baselineRange: number;
  /** Candle overlap at the current bar — the score's per-window constant term. */
  overlapAvg: number;
  currentIndex: number;
  /**
   * Feature indices of the IMPULSE LEGS, newest-first — the pattern's addressing scheme.
   * legs[k] in a config resolves to features[impulseIndices[k]], and that leg's
   * following retrace sits at impulseIndices[k] - 1.
   *
   * Indexing legs rather than raw segments is what keeps a position meaningful: on real
   * data segment 2 is a leg only 75% of the time and segment 3 only 25%, because legs are
   * sometimes adjacent with no pullback between them.
   */
  impulseIndices: number[];
}

const clamp01 = (v: number): number => (v > 1 ? 1 : v < 0 ? 0 : v);

function toDir(direction: LegSegment['direction']): 1 | 0 | -1 {
  return direction === 'bull' ? 1 : direction === 'bear' ? -1 : 0;
}

/**
 * Per-candle tri-state direction, OLDEST-FIRST, or null when unavailable.
 *
 * Preference order matters. `o`/`c` are exact. The `brr`/`bullBear` fallback is also
 * exact — `brr` is `|close - open| / range`, so `brr === 0` holds precisely when the body
 * is zero, which is the definition of a doji — and it survives a segment built without the
 * raw price series. `bullBear` alone is NOT enough: its `0` conflates bear with doji.
 */
export function deriveDirArray(seg: LegSegment): (1 | 0 | -1)[] | null {
  const { o, c, brr, bullBear } = seg;
  if (o && c && o.length === c.length && o.length === seg.barCount) {
    return c.map((close, i) => (close > o[i] ? 1 : close < o[i] ? -1 : 0));
  }
  if (brr && bullBear && brr.length === bullBear.length && brr.length === seg.barCount) {
    return brr.map((b, i) => (b === 0 ? 0 : bullBear[i] === 1 ? 1 : -1));
  }
  return null;
}

/**
 * Longest run of consecutive same-direction conviction candles (§2.1).
 * A doji (dir === 0) breaks a run regardless of its BRR.
 */
export function goodRuns(
  brrArr: number[] | null,
  dirArr: (1 | 0 | -1)[] | null,
  minBrr: number = DEFAULT_RUN_MIN_BRR
): GoodRuns {
  const out: GoodRuns = { maxRun: 0, run2: 0, run3: 0, run4: 0 };
  if (!brrArr || !dirArr) return out;

  let run = 0;
  let runDir: 1 | 0 | -1 = 0;
  const closeRun = () => {
    if (run >= 2) out.run2++;
    if (run >= 3) out.run3++;
    if (run >= 4) out.run4++;
    if (run > out.maxRun) out.maxRun = run;
    run = 0;
    runDir = 0;
  };

  const n = Math.min(brrArr.length, dirArr.length);
  for (let i = 0; i < n; i++) {
    const good = dirArr[i] !== 0 && brrArr[i] >= minBrr;
    if (good && dirArr[i] === runDir) {
      run++;
    } else if (good) {
      closeRun();
      run = 1;
      runDir = dirArr[i];
    } else {
      closeRun();
    }
  }
  closeRun();
  return out;
}

/**
 * Longest run inside one segment at a caller-chosen BRR cutoff and direction.
 *
 * Returns **-1 for UNKNOWN** — not 0 — when the segment carries no per-candle arrays.
 * The distinction is the whole point: a segment reporting a run of 0 would fail every run
 * condition, which is the same outcome as unknown but *silently*, indistinguishable from a
 * segment that was measured and found wanting. You would then conclude your spec is too
 * tight when in fact your data is incomplete. Callers must treat -1 as unknown: fail the
 * condition AND count it.
 *
 * @param sideWanted 1 bull, -1 bear, 0 = direction ignored.
 */
export function maxRunIn(f: LegFeature, minBrr: number, sideWanted: 1 | 0 | -1): number {
  const { brrArr, dirArr } = f;
  if (!brrArr || !dirArr) return -1;

  let best = 0;
  let run = 0;
  const n = Math.min(brrArr.length, dirArr.length);
  for (let i = 0; i < n; i++) {
    const d = dirArr[i];
    // A doji breaks a run regardless of its BRR — kept explicit even though a zero body
    // gives brr === 0 and so cannot clear a positive cutoff anyway.
    const ok = brrArr[i] >= minBrr && (sideWanted === 0 ? d !== 0 : d === sideWanted);
    if (ok) {
      run++;
      if (run > best) best = run;
    } else {
      run = 0;
    }
  }
  return best;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export interface AdapterOptions {
  /** Bars for the mean-candle-range baseline. Comes from `AutoBacktestConfig.barRangeLookback`
   *  — a Session Settings field, never a literal at the call site. */
  baselineLookback?: number;
  /** Bars for the candle-overlap constant. Comes from `AutoBacktestConfig.barOverlapLookback`. */
  overlapLookback?: number;
}

/**
 * Build the derived feature window. One pass over ~10–25 segments, done once per bar and
 * shared by every regime that evaluates a pattern on that bar.
 *
 * @param segments    Newest-first, straight from buildLegSequence.
 * @param candles     The candle array the segments index into (indices are absolute).
 * @param currentIndex The bar being evaluated.
 */
export function buildLegWindow(
  segments: LegSegment[],
  candles: Candle[],
  currentIndex: number,
  opts: AdapterOptions = {}
): LegWindow {
  const baselineLookback = opts.baselineLookback ?? 20;
  const overlapLookback = opts.overlapLookback ?? 8;

  const baselineRange = averageBarRanges(calculateBarRanges(candles, currentIndex, baselineLookback)).barRangeAvg ?? 0;
  const overlapAvg = averageBarOverlap(calculateBarOverlap(candles, currentIndex, overlapLookback)) ?? 0;

  const absMoves = segments.map(s => Math.abs(s.movePct));
  const medianAbsMove = median(absMoves);

  const features: LegFeature[] = segments.map((seg, index) => {
    const move = seg.endPrice - seg.startPrice;
    const realizedDir: 1 | 0 | -1 = move > 0 ? 1 : move < 0 ? -1 : 0;
    const barCount = seg.barCount || 1;
    const absMovePct = Math.abs(seg.movePct);

    // Measured in the direction the segment actually travelled: did it keep making new
    // extremes, or stall?
    const breaks = realizedDir >= 0 ? seg.highBreakCount : seg.lowBreakCount;
    const breakPersist = clamp01(breaks / barCount);

    // clvAvg is the 0..1 form, so a down segment mirrors it — after mirroring, higher is
    // always better, in both directions.
    const dirClv = clamp01(realizedDir >= 0 ? seg.clvAvg : 1 - seg.clvAvg);

    const rangeRatio = baselineRange > 0 ? (seg.high - seg.low) / barCount / baselineRange : 0;

    // Back-to-back break runs come from the RAW CANDLES via the repo helper, so they are
    // available at any detail level and are never unknown. Two things to know:
    //   - it compares from the segment's second bar onward, unlike calculateBarBreaks,
    //     which also compares the first bar against the one before the segment;
    //   - it reads the candle array by absolute index, so it is only consistent with the
    //     segment's own stored highBreakCount/lowBreakCount when the segments and the
    //     candles came from the same source. buildLegWindow always guarantees that;
    //     hand-built fixtures passed to buildLegWindowFromSegments may not.
    const breakRuns = calculateConsecutiveBreaks(candles, seg.startIndex, seg.endIndex);

    const brrArr = seg.brr && seg.brr.length === barCount ? seg.brr : null;
    const dirArr = deriveDirArray(seg);
    const runs = goodRuns(brrArr, dirArr);

    return {
      seg,
      index,
      kind: seg.kind === 'pullback' ? PULLBACK : IMPULSE,
      structDir: toDir(seg.direction),
      realizedDir,
      barCount,
      absMovePct,
      startPrice: seg.startPrice,
      endPrice: seg.endPrice,
      high: seg.high,
      low: seg.low,
      highBreakCount: seg.highBreakCount,
      lowBreakCount: seg.lowBreakCount,
      breakPersist,
      maxHighBreakRun: breakRuns.maxConsecutiveHighBreaks,
      maxLowBreakRun: breakRuns.maxConsecutiveLowBreaks,
      dirClv,
      brr: clamp01(seg.brrAvg),
      moveVsMedian: medianAbsMove > 0 ? clamp01(absMovePct / (2 * medianAbsMove)) : 0,
      rangeRatio,
      climaxPenalty: clamp01(rangeRatio - 1),
      maxRun: runs.maxRun,
      runLength: clamp01(runs.maxRun / 4),
      runs,
      depthRatio: 0,
      isForming: seg.endIndex >= currentIndex,
      brrArr,
      dirArr,
    };
  });

  // Second pass — depth needs the whole window. Newest-first ordering means the leg a
  // pullback retraced sits at the NEXT (older) index. The oldest segment can be a leading
  // pullback that retraces nothing inside this window; the loop bound leaves it at 0.
  for (let i = 0; i < features.length - 1; i++) {
    const pb = features[i];
    const leg = features[i + 1];
    if (pb.kind === PULLBACK && leg.kind === IMPULSE && leg.absMovePct > 0) {
      pb.depthRatio = pb.absMovePct / leg.absMovePct;
    }
  }

  // The pattern addresses IMPULSE LEGS by position, so precompute the mapping once.
  const impulseIndices: number[] = [];
  for (let i = 0; i < features.length; i++) {
    if (features[i].kind === IMPULSE) impulseIndices.push(i);
  }

  return { features, medianAbsMove, baselineRange, overlapAvg, currentIndex, impulseIndices };
}
