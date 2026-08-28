import { useMemo } from 'react';
import type { Candle } from '../types';
import {
  type RegimeRules,
  type AutoBacktestConfig,
  type EntryMetricsSnapshot,
  computeEntryMetrics,
  legStrengthFiltersActive,
  passesBarOverlap,
  passesBarRange,
  passesBarBreak,
  passesConsecutiveBreak,
  passesEmaSlope,
  passesEma20GapBar,
  passesEma20Bias,
  passesEfficiencyRatio,
  passesAtrDepth,
  passesSeqFilter,
  passesPivotGap,
  getEmaAt,
  getAtrAt,
  passesLegPattern,
  type LegPatternCtx,
} from '../utils/autoBacktestEngine';
import { calculateAlBrooks } from '../utils/indicators';
import { buildLegWindow as buildLegPatternWindow, type LegWindow as LegPatternWindow } from '../utils/legPattern';

// One entry per Quality Setup Filter that has a live-preview diagram. Extend this list
// as more filters get their own ThresholdFilterControl (see plan phases 2-4).
export type PreviewFilterKey =
  | 'barOverlap'
  | 'barRange'
  | 'barBreak'
  | 'consecutiveBreak'
  | 'ema21Slope'
  | 'ema50Slope'
  | 'ema20GapBar'
  | 'ema20Bias'
  | 'efficiencyRatio'
  | 'atrDepth'
  | 'highSeq'
  | 'lowSeq'
  | 'pivotGap'
  | 'legPattern';

export interface FilterPreviewBar {
  candle: Candle;
  pass: Partial<Record<PreviewFilterKey, boolean>>;
  overallPass: boolean;
  /** Full instrumentation snapshot at this bar, for slider "your data currently sits here" ticks. */
  metrics: EntryMetricsSnapshot;
  /** ATR-unit distance from EMA21 — not part of EntryMetricsSnapshot (that's the trade-record stamp shape). */
  atrDepth?: number;
}

const PREVIEW_WINDOW = 30;
// computeEntryMetrics mirrors evaluateAutoSignals' own warm-up guard (currentIndex < 50
// is rejected there) so the preview reflects bars the live engine would actually evaluate.
const METRICS_WARMUP = 50;

/**
 * Recomputes, for the last `PREVIEW_WINDOW` bars ending at currentIndex, which of the
 * currently-active quality filters each bar would pass — using the same computeEntryMetrics
 * + passesXxx functions the real engine gates entries with, so the preview never drifts
 * from actual backtest behavior. Direction ambiguity for BOTH-direction regimes is
 * resolved by previewing as long-aligned (SHORT_ONLY regimes preview as short-aligned) —
 * a display simplification only; evaluateAutoSignals still checks both directions for real.
 */
export function useFilterPreviewData(
  candles: Candle[],
  currentIndex: number,
  rules: RegimeRules,
  config: AutoBacktestConfig
): FilterPreviewBar[] {
  return useMemo(() => {
    if (candles.length === 0) return [];
    const isLong = rules.direction !== 'SHORT_ONLY';
    const end = Math.min(currentIndex, candles.length - 1);
    const start = Math.max(METRICS_WARMUP, end - PREVIEW_WINDOW + 1);
    if (start > end) return [];

    // Mirrors evaluateAutoSignals' trend-anchor logic (autoBacktestEngine.ts) so the preview
    // never disagrees with what the real engine would compute for a pullback entry.
    const alBrooks = calculateAlBrooks(candles.slice(0, end + 1));

    // Leg-pattern windows for the previewed bars. Built on demand and memoized per
    // (bar, detail) so a two-slot pattern doesn't rebuild the same window twice, and
    // never built at all when the regime has no active pattern.
    const legWindows = new Map<string, LegPatternWindow>();
    const legPatternCtxFor = (bar: number): LegPatternCtx => needsPerCandle => {
      const key = `${bar}|${needsPerCandle ? 'full' : 'avg'}`;
      let w = legWindows.get(key);
      if (!w) {
        w = buildLegPatternWindow(candles, bar, {
          windowLegs: config.legSequenceCount ?? 10,
          needsPerCandle,
          baselineLookback: config.barRangeLookback,
          overlapLookback: config.barOverlapLookback,
        });
        legWindows.set(key, w);
      }
      return w;
    };

    const bars: FilterPreviewBar[] = [];
    for (let i = start; i <= end; i++) {
      const marker = alBrooks.find(m => m.time === candles[i].timestamp) ?? null;
      const legWindow = (rules.entryMode !== 'PIVOT' && marker
        && marker.legStartIndex !== undefined && marker.legEndIndex !== undefined)
        ? { startIndex: marker.legStartIndex, endIndex: marker.legEndIndex }
        : null;
      const metrics = computeEntryMetrics(candles, i, config, legWindow);
      // Mirror evaluateAutoSignals' leg gate: with leg-strength filters active, an H/L
      // entry with no completed leg (or one shorter than legMinBarCount) is blocked.
      const legGated = rules.entryMode !== 'PIVOT' && legStrengthFiltersActive(rules)
        && (!legWindow || metrics.legTooShort === true);
      const ema21 = getEmaAt(candles, i, 21);
      const atr = getAtrAt(candles, i);
      const atrDepth = ema21 && atr > 0 ? Math.abs(candles[i].close - ema21) / atr : undefined;
      const pass: Partial<Record<PreviewFilterKey, boolean>> = {
        barOverlap: !legGated && passesBarOverlap(rules, metrics.barOverlapAvg),
        barRange: !legGated && passesBarRange(rules, metrics.bullBarRangeAvg, metrics.bearBarRangeAvg, metrics.barRangeAvg, isLong),
        barBreak: !legGated && passesBarBreak(rules, metrics.highBreakCount, metrics.lowBreakCount, isLong),
        consecutiveBreak: !legGated && passesConsecutiveBreak(rules, metrics.maxConsecutiveHighBreaks, metrics.maxConsecutiveLowBreaks, isLong),
        ema21Slope: passesEmaSlope(rules.ema21SlopeFilter, rules.ema21SlopeThreshold, metrics.ema21Slope, isLong),
        ema50Slope: passesEmaSlope(rules.ema50SlopeFilter, rules.ema50SlopeThreshold, metrics.ema50Slope, isLong),
        ema20GapBar: !legGated && passesEma20GapBar(rules, metrics.ema20GapBarRatio),
        ema20Bias: passesEma20Bias(rules, metrics.ema20CloseAboveRatio, isLong),
        efficiencyRatio: !legGated && passesEfficiencyRatio(rules, metrics.efficiencyRatio),
        atrDepth: passesAtrDepth(rules, candles[i].close, ema21, atr),
        highSeq: passesSeqFilter(rules.highSeqFilter, rules.highSeqPatterns, metrics.pivotHighSeq ?? []),
        lowSeq: passesSeqFilter(rules.lowSeqFilter, rules.lowSeqPatterns, metrics.pivotLowSeq ?? []),
        pivotGap: passesPivotGap(rules, metrics.pivotGapAvgBars),
        // Uses the SAME passesLegPattern the engine calls, so the strip can never drift
        // from the real gate. The window is built per previewed bar and cached for the
        // duration of this call; the whole column is skipped when no pattern is active,
        // so an unconfigured regime pays nothing for it.
        legPattern: passesLegPattern(rules, legPatternCtxFor(i), isLong),
      };
      bars.push({
        candle: candles[i],
        pass,
        overallPass: Object.values(pass).every(Boolean),
        metrics,
        atrDepth,
      });
    }
    return bars;
  }, [candles, currentIndex, rules, config]);
}
