import { useMemo } from 'react';
import type { Candle } from '../types';
import {
  type RegimeRules,
  type AutoBacktestConfig,
  type EntryMetricsSnapshot,
  computeEntryMetrics,
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
} from '../utils/autoBacktestEngine';
import { calculateAlBrooks } from '../utils/indicators';

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
  | 'pivotGap';

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

    const bars: FilterPreviewBar[] = [];
    for (let i = start; i <= end; i++) {
      const marker = alBrooks.find(m => m.time === candles[i].timestamp) ?? null;
      const legWindow = (rules.entryMode !== 'PIVOT' && marker)
        ? { startIndex: marker.legStartIndex, endIndex: marker.legEndIndex }
        : null;
      const metrics = computeEntryMetrics(candles, i, config, legWindow);
      const ema21 = getEmaAt(candles, i, 21);
      const atr = getAtrAt(candles, i);
      const atrDepth = ema21 && atr > 0 ? Math.abs(candles[i].close - ema21) / atr : undefined;
      const pass: Partial<Record<PreviewFilterKey, boolean>> = {
        barOverlap: passesBarOverlap(rules, metrics.barOverlapAvg),
        barRange: passesBarRange(rules, metrics.bullBarRangeAvg, metrics.bearBarRangeAvg, metrics.barRangeAvg, isLong),
        barBreak: passesBarBreak(rules, metrics.highBreakCount, metrics.lowBreakCount, isLong),
        consecutiveBreak: passesConsecutiveBreak(rules, metrics.maxConsecutiveHighBreaks, metrics.maxConsecutiveLowBreaks, isLong),
        ema21Slope: passesEmaSlope(rules.ema21SlopeFilter, rules.ema21SlopeThreshold, metrics.ema21Slope, isLong),
        ema50Slope: passesEmaSlope(rules.ema50SlopeFilter, rules.ema50SlopeThreshold, metrics.ema50Slope, isLong),
        ema20GapBar: passesEma20GapBar(rules, metrics.ema20GapBarRatio),
        ema20Bias: passesEma20Bias(rules, metrics.ema20CloseAboveRatio, isLong),
        efficiencyRatio: passesEfficiencyRatio(rules, metrics.efficiencyRatio),
        atrDepth: passesAtrDepth(rules, candles[i].close, ema21, atr),
        highSeq: passesSeqFilter(rules.highSeqFilter, rules.highSeqPatterns, metrics.pivotHighSeq ?? []),
        lowSeq: passesSeqFilter(rules.lowSeqFilter, rules.lowSeqPatterns, metrics.pivotLowSeq ?? []),
        pivotGap: passesPivotGap(rules, metrics.pivotGapAvgBars),
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
