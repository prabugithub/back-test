// Pivot-only market-structure classifier — public API.
//
// Consumers: autoBacktestEngine (Market-step gate + optional regime source), entry/exit hook
// contexts (ctx.structure()), leg-pattern window clauses (structureBroad / structureSub) and
// the experimental AdvancedChart layer. Pure and side-effect free; never imports the engine.

import type { Candle, LegSegment } from '../../types';
import { DEFAULT_MIN_PIVOT_GAP_BARS, MIN_PIVOT_GAP_BARS_MAX, MIN_PIVOT_GAP_BARS_MIN, getAlBrooksRunUpTo, getPivotPointsUpTo } from '../indicators';
import { buildLegSequence } from '../legSequence';
import { resolveStructureParams, type StructureConfig } from './params';
import { buildStructureTimeline } from './timeline';
import { swingLevels } from './swingPoints';
import {
  findTrendlineSetup, findTrendlinesAt, resolveTrendlineParams, trendStrength,
  type TrendlineConfig, type TrendlineSetup, type TrendlineSetupKind, type TrendlineState, type TrendStrength,
} from './trendlines';
import type { StructureSegment, StructureState, SwingPoint } from './types';

export * from './types';
export { STRUCTURE_PARAM_DEFS, resolveStructureParams, type StructureConfig, type StructureParams } from './params';
export { buildStructureTimeline } from './timeline';
export { swingLevels, pivotsToSwings, reanchorSwings, raiseDegree } from './swingPoints';
export {
  TRENDLINE_PARAM_DEFS, resolveTrendlineParams, trendlinePriceAt, findTrendlinesAt, trendStrength, findTrendlineSetup,
  type Trendline, type TrendlineState, type TrendlineConfig, type TrendlineParams,
  type TrendStrength, type ChannelShape, type TrendlineSetup, type TrendlineSetupKind,
} from './trendlines';
export {
  computeStructureStats, summarize, transitionMatrix, subTransitions,
  type EpisodeStat, type StructureStats, type DistSummary, type SubKey, type SubRun,
} from './stats';

// Same clamp as resolveMinPivotGapBars in the engine — duplicated (3 lines) rather than
// imported, because the engine imports this module.
function gapOf(config: Partial<StructureConfig>): number {
  const raw = config.minPivotGapBars ?? DEFAULT_MIN_PIVOT_GAP_BARS;
  if (!Number.isFinite(raw)) return DEFAULT_MIN_PIVOT_GAP_BARS;
  return Math.min(MIN_PIVOT_GAP_BARS_MAX, Math.max(MIN_PIVOT_GAP_BARS_MIN, Math.floor(raw)));
}

export function getStructureTimeline(candles: Candle[], config: Partial<StructureConfig>): StructureState[] {
  return buildStructureTimeline(candles, gapOf(config), resolveStructureParams(config));
}

/** Structure as of bar `index` (look-ahead safe). Null outside the series. */
export function getStructureAt(candles: Candle[], index: number, config: Partial<StructureConfig>): StructureState | null {
  if (index < 0 || index >= candles.length) return null;
  return getStructureTimeline(candles, config)[index] ?? null;
}

/** Highest swing degree ctx.swings() serves (same bound as Trendlines → Swing degree). */
export const MAX_SWING_DEGREE = 4;

/**
 * Swing points as of bar `index` (look-ahead safe), built from the engine pivots that fired
 * on bars [fromBar, index]. Degree 1 = every pivot swing, 2+ = major swings (swing of
 * swings). Each point is re-anchored to the true high/low of its swing; bar indices are
 * absolute. The newest point of a degree ≥ 2 waits until the next same-type swing confirms
 * it. Oldest first.
 */
export function getSwingPointsAt(
  candles: Candle[], index: number, fromBar: number, config: Partial<StructureConfig>, degree = 1,
): SwingPoint[] {
  if (index < 0 || index >= candles.length) return [];
  const d = Math.min(MAX_SWING_DEGREE, Math.max(1, Math.floor(Number.isFinite(degree) ? degree : 1)));
  const pivots = getPivotPointsUpTo(candles, index, gapOf(config));
  let lo = 0;
  while (lo < pivots.length && pivots[lo].barIndex < fromBar) lo++;
  return swingLevels(candles, pivots.slice(lo), d)[d - 1];
}

/** Major pivot trendlines as of bar `index` (look-ahead safe). Null outside the series. */
export function getTrendlinesAt(candles: Candle[], index: number, config: Partial<StructureConfig & TrendlineConfig>): TrendlineState | null {
  if (index < 0 || index >= candles.length) return null;
  return findTrendlinesAt(candles, index, gapOf(config), resolveTrendlineParams(config));
}

/** Trend direction / strength read off the trendlines at bar `index`. Null outside the series. */
export function getTrendStrengthAt(candles: Candle[], index: number, config: Partial<StructureConfig & TrendlineConfig>): TrendStrength | null {
  const st = getTrendlinesAt(candles, index, config);
  return st ? trendStrength(st, candles[index].close) : null;
}

/** A trendline setup of `kind` at bar `index`, per side. Null outside the series. */
export function getTrendlineSetupAt(
  candles: Candle[], index: number, config: Partial<StructureConfig & TrendlineConfig>,
  kind: TrendlineSetupKind, bars: number, zone: number,
): { long: TrendlineSetup | null; short: TrendlineSetup | null } | null {
  if (index < 0 || index >= candles.length) return null;
  return findTrendlineSetup(candles, index, gapOf(config), resolveTrendlineParams(config), kind, bars, zone);
}

/** Collapse the timeline into contiguous runs of the same (segment, broad, sub, attempt). */
export function getStructureSegments(candles: Candle[], config: Partial<StructureConfig>): StructureSegment[] {
  const states = getStructureTimeline(candles, config);
  const out: StructureSegment[] = [];
  let cur: StructureSegment | null = null;
  for (let i = 0; i < states.length; i++) {
    const s = states[i];
    if (cur && cur.segmentId === s.segmentId && cur.broad === s.broad && cur.sub === s.sub && cur.breakoutAttempt === s.breakoutAttempt) {
      cur.endIndex = i;
      cur.rangeHigh = s.rangeHigh;
      cur.rangeLow = s.rangeLow;
      cur.keyLevel = s.keyLevel;
      continue;
    }
    cur = {
      startIndex: i, endIndex: i, segmentId: s.segmentId, broad: s.broad, sub: s.sub,
      confirmed: s.confirmed, breakoutAttempt: s.breakoutAttempt, rangeHigh: s.rangeHigh, rangeLow: s.rangeLow, keyLevel: s.keyLevel,
      transitionReason: s.transitionReason,
    };
    out.push(cur);
  }
  return out;
}

/** Map onto the existing ltMarket vocabulary so getRegimeKey / passesStructureFilter /
 *  journals keep working when Session Settings → Regime source = Pivot structure. */
export function structureToLtMarket(state: StructureState | null): string {
  if (!state || state.broad === 'range') return 'Range';
  const clean = state.sub === 'stairs' || state.sub === 'expanding-trend';
  if (state.broad === 'up') return clean ? 'Bull-Trend' : 'Bull-Trending-range';
  return clean ? 'Bear-Trend' : 'Bear-Trending-range';
}

/** Optional enrichment: the Brooks leg/pullback segments covering the current structure
 *  segment, NEWEST-FIRST. Never used by the classifier itself. */
export function structureLegs(candles: Candle[], index: number, state: StructureState | null): LegSegment[] {
  if (!state || index < 0 || index >= candles.length) return [];
  const legs = buildLegSequence(candles, index, Math.max(10, state.segmentPivots.length + 2), 'avg', getAlBrooksRunUpTo(candles, index));
  return legs.filter(l => l.endIndex >= state.segmentStart);
}

export function describeStructure(state: StructureState | null): string {
  if (!state) return '—';
  const broad = state.broad === 'up' ? 'UP' : state.broad === 'down' ? 'DOWN' : 'RANGE';
  const sub = state.sub ? ` · ${SUB_SHORT[state.sub]}` : '';
  const attempt = state.breakoutAttempt ? ` → ${state.breakoutAttempt === 'up' ? 'UP' : 'DOWN'}?` : '';
  return `${broad}${attempt}${sub}`;
}

const SUB_SHORT: Record<NonNullable<StructureState['sub']>, string> = {
  'stairs': 'Stairs', 'trending-range': 'Trending rng', 'expanding-trend': 'Expanding',
  'shrinking-trend': 'Shrinking', 'wedge': 'Wedge', 'sideways': 'Sideways', 'tight-range': 'Tight',
  'expanding-triangle': 'Exp. triangle', 'converging-triangle': 'Conv. triangle',
};
