// Pivot-only market-structure classifier — public API.
//
// Consumers: autoBacktestEngine (Market-step gate + optional regime source), entry/exit hook
// contexts (ctx.structure()), leg-pattern window clauses (structureBroad / structureSub) and
// the experimental AdvancedChart layer. Pure and side-effect free; never imports the engine.

import type { Candle, LegSegment } from '../../types';
import { DEFAULT_MIN_PIVOT_GAP_BARS, MIN_PIVOT_GAP_BARS_MAX, MIN_PIVOT_GAP_BARS_MIN, getAlBrooksRunUpTo } from '../indicators';
import { buildLegSequence } from '../legSequence';
import { resolveStructureParams, type StructureConfig } from './params';
import { buildStructureTimeline } from './timeline';
import type { StructureSegment, StructureState } from './types';

export * from './types';
export { STRUCTURE_PARAM_DEFS, resolveStructureParams, type StructureConfig, type StructureParams } from './params';
export { buildStructureTimeline } from './timeline';

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

/** Collapse the timeline into contiguous runs of the same (segment, broad, sub, confirmed). */
export function getStructureSegments(candles: Candle[], config: Partial<StructureConfig>): StructureSegment[] {
  const states = getStructureTimeline(candles, config);
  const out: StructureSegment[] = [];
  let cur: StructureSegment | null = null;
  for (let i = 0; i < states.length; i++) {
    const s = states[i];
    if (cur && cur.segmentId === s.segmentId && cur.broad === s.broad && cur.sub === s.sub && cur.confirmed === s.confirmed) {
      cur.endIndex = i;
      cur.rangeHigh = s.rangeHigh;
      cur.rangeLow = s.rangeLow;
      cur.keyLevel = s.keyLevel;
      continue;
    }
    cur = {
      startIndex: i, endIndex: i, segmentId: s.segmentId, broad: s.broad, sub: s.sub,
      confirmed: s.confirmed, rangeHigh: s.rangeHigh, rangeLow: s.rangeLow, keyLevel: s.keyLevel,
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
  return `${broad}${state.confirmed ? '' : ' (unconf.)'}${sub}`;
}

const SUB_SHORT: Record<NonNullable<StructureState['sub']>, string> = {
  'stairs': 'Stairs', 'trending-range': 'Trending rng', 'expanding-trend': 'Expanding',
  'shrinking-trend': 'Shrinking', 'wedge': 'Wedge', 'sideways': 'Sideways', 'tight-range': 'Tight',
  'expanding-triangle': 'Exp. triangle', 'converging-triangle': 'Conv. triangle',
};
