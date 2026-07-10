import { useMemo } from 'react';
import type { Candle } from '../types';
import {
  type RegimeRules,
  type AutoBacktestConfig,
  type EntryMetricsSnapshot,
  computeEntryMetrics,
  passesBarOverlap,
  passesEmaSlope,
  passesEfficiencyRatio,
} from '../utils/autoBacktestEngine';

// One entry per Quality Setup Filter that has a live-preview diagram. Extend this list
// as more filters get their own ThresholdFilterControl (see plan phases 2-4).
export type PreviewFilterKey = 'barOverlap' | 'ema21Slope' | 'efficiencyRatio';

export interface FilterPreviewBar {
  candle: Candle;
  pass: Partial<Record<PreviewFilterKey, boolean>>;
  overallPass: boolean;
  /** Full instrumentation snapshot at this bar, for slider "your data currently sits here" ticks. */
  metrics: EntryMetricsSnapshot;
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

    const bars: FilterPreviewBar[] = [];
    for (let i = start; i <= end; i++) {
      const metrics = computeEntryMetrics(candles, i, config);
      const pass: Partial<Record<PreviewFilterKey, boolean>> = {
        barOverlap: passesBarOverlap(rules, metrics.barOverlapAvg),
        ema21Slope: passesEmaSlope(rules.ema21SlopeFilter, rules.ema21SlopeThreshold, metrics.ema21Slope, isLong),
        efficiencyRatio: passesEfficiencyRatio(rules, metrics.efficiencyRatio),
      };
      bars.push({
        candle: candles[i],
        pass,
        overallPass: Object.values(pass).every(Boolean),
        metrics,
      });
    }
    return bars;
  }, [candles, currentIndex, rules, config]);
}
