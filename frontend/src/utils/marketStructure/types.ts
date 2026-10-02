// Pivot-only market-structure classifier — shared types.
//
// Everything here is derived from confirmed pivots (price, bar index, candle gaps between
// them). No ATR / EMA / indicator input — every threshold is a ratio of the segment's own
// swings. See market-structure-taxonomy.md for the regime definitions.

import type { PivotPoint } from '../indicators';

export type StructureBroad = 'up' | 'down' | 'range';

/** The 9-regime taxonomy. Trend subs apply to up/down, range subs to range. */
export type StructureSub =
  | 'stairs' | 'trending-range' | 'expanding-trend' | 'shrinking-trend' | 'wedge'
  | 'sideways' | 'tight-range' | 'expanding-triangle' | 'converging-triangle';

export const TREND_SUBS: readonly StructureSub[] =
  ['stairs', 'trending-range', 'expanding-trend', 'shrinking-trend', 'wedge'];
export const RANGE_SUBS: readonly StructureSub[] =
  ['sideways', 'tight-range', 'expanding-triangle', 'converging-triangle'];

export const STRUCTURE_BROAD_LABELS: Record<StructureBroad, string> = {
  up: 'Up', down: 'Down', range: 'Range',
};

export const STRUCTURE_SUB_LABELS: Record<StructureSub, string> = {
  'stairs': 'Stairs',
  'trending-range': 'Trending range',
  'expanding-trend': 'Expanding trend',
  'shrinking-trend': 'Shrinking trend',
  'wedge': 'Wedge',
  'sideways': 'Sideways',
  'tight-range': 'Tight range',
  'expanding-triangle': 'Expanding triangle',
  'converging-triangle': 'Converging triangle',
};

/** Numeric codes — the leg-pattern window clauses are numeric, so categorical structure
 *  fields travel as codes. Append-only: codes are persisted in saved configs. */
export const BROAD_CODE: Record<StructureBroad, number> = { up: 1, down: 2, range: 3 };
export const SUB_CODE: Record<StructureSub, number> = {
  'stairs': 1, 'trending-range': 2, 'expanding-trend': 3, 'shrinking-trend': 4, 'wedge': 5,
  'sideways': 6, 'tight-range': 7, 'expanding-triangle': 8, 'converging-triangle': 9,
};

/** A confirmed swing extreme. Built from pivots: bearish pivot → 'high', bullish → 'low'.
 *  Consecutive same-type pivots collapse to the more extreme one, so points alternate. */
export interface SwingPoint {
  type: 'high' | 'low';
  price: number;
  barIndex: number;
  time: number;
  label?: PivotPoint['trendLabel'];
}

/** The move between two consecutive (alternating) swing points. */
export interface Swing {
  from: SwingPoint;
  to: SwingPoint;
  dir: 'up' | 'down';
  size: number;     // |Δprice|
  bars: number;     // candles between the two pivots
  sizePct: number;  // size / from.price × 100
}

export interface StructureEvidence {
  swingCount: number;
  medianSwing: number;      // median swing size in the segment (price units)
  buffer: number;           // break buffer = breakFrac × medianSwing
  avgRetrace: number | null;   // trend: mean pullback size / prior impulse size
  avgTimeRatio: number | null; // trend: mean pullback bars / prior impulse bars
  ampRatio: number | null;     // trend: mean impulse size, 2nd half ÷ 1st half
  hiSlope: number | null;      // least-squares slope of swing highs (price per bar)
  loSlope: number | null;      // least-squares slope of swing lows
  widthStart: number | null;   // hi-line − lo-line at segment start
  widthEnd: number | null;     // hi-line − lo-line at the last swing point
}

export interface PrevSegmentInfo {
  broad: StructureBroad;
  sub: StructureSub | null;
  medianImpulse: number;
}

export type TransitionReason =
  | 'init' | 'bos' | 'breakout' | 'failed-breakout' | 'confirmed' | 'sub-change';

/** Market structure as of one bar. Immutable — consecutive bars share the object when
 *  nothing changed. */
export interface StructureState {
  barIndex: number;           // bar this state was (last) produced at
  segmentId: number;
  broad: StructureBroad;
  sub: StructureSub | null;   // null while the segment has too few swings
  /** Trend only: false until the breakout is confirmed by a pullback holding above (below)
   *  the broken range edge. Range states are always true. */
  confirmed: boolean;
  segmentStart: number;       // bar index of the segment's first swing point (anchor)
  transitionBar: number;      // bar the current broad state began on (causal band start)
  transitionReason: TransitionReason;
  /** Trend only: the protected swing (HL in up, LH in down). A close beyond it − buffer = BOS. */
  keyLevel: number | null;
  /** Unconfirmed trend only: the broken range edge a close must not fall back through. */
  breakoutLevel: number | null;
  rangeHigh: number | null;   // max swing high in the segment
  rangeLow: number | null;    // min swing low in the segment
  /** The adaptive window — every swing point of the current segment (capped by maxPivots). */
  segmentPivots: readonly SwingPoint[];
  swings: readonly Swing[];
  prevSegment: PrevSegmentInfo | null;
  failedBreakouts: number;    // failed breakouts seen inside the current range segment
  evidence: StructureEvidence;
}

/** A contiguous run of bars with the same (segment, broad, sub, confirmed) — for drawing. */
export interface StructureSegment {
  startIndex: number;
  endIndex: number;
  segmentId: number;
  broad: StructureBroad;
  sub: StructureSub | null;
  confirmed: boolean;
  rangeHigh: number | null;
  rangeLow: number | null;
  keyLevel: number | null;
  transitionReason: TransitionReason;
}
