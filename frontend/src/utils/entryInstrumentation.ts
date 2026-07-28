// Entry-condition instrumentation shared by every store-side trade entry.
//
// This is the exact computation `executeTrade` (sharedActions.ts) has always run
// for a non-reducing fill — lifted out verbatim so the multi-trade path
// (openIndependentPosition) stamps byte-identical `*AtEntry` fields instead of
// growing a second copy that can drift.
//
// Pure: candles in, Trade fields out. No store access.

import type { Candle, Trade } from '../types';
import { calculatePivotPoints, calculateATR, calculateEMA, calculateAlBrooksLegs } from './indicators';
import { analyzeMarketStructure, calculateBarOverlap } from './pivotAnalysis';
import { computeEntryMetrics, type AutoBacktestConfig, type EntryMetricsSnapshot } from './autoBacktestEngine';
import { buildLegSequence } from './legSequence';

export interface EntryInstrumentation {
  /** Every `*AtEntry` field, ready to spread onto a Trade. */
  fields: Partial<Trade>;
  /** Entry direction agrees with the current lower-timeframe structure. */
  isInitialWith: boolean;
}

export function buildEntryInstrumentation(
  candles: Candle[],
  index: number,
  type: 'BUY' | 'SELL',
  entryPrice: number,
  config: AutoBacktestConfig,
  entryMetricsOverride?: EntryMetricsSnapshot
): EntryInstrumentation {
  const visible = candles.slice(0, index + 1);
  const pivots = calculatePivotPoints(visible);
  const { ltMarket } = analyzeMarketStructure(visible, pivots);

  const atrSeries = calculateATR(visible, 14);
  const emaSeries = calculateEMA(visible, 21);
  const atrVal = atrSeries[atrSeries.length - 1]?.value ?? 0;
  const emaVal = emaSeries[emaSeries.length - 1]?.value ?? 0;
  const atrDepthAtEntry = atrVal > 0 ? Math.abs(entryPrice - emaVal) / atrVal : 0;
  const barOverlapAtEntry = calculateBarOverlap(candles, index, config.barOverlapLookback ?? 8);

  // Manual/fallback instrumentation — the same computeEntryMetrics the auto engine
  // uses, graded over the completed breakout leg matching the trade's direction
  // (BUY → bull leg, SELL → bear leg) when one exists. A short leg still records
  // (manual entries are never blocked — legBarCountAtEntry shows it was under Leg
  // Min Bars); no completed leg yet → entry-bar windows, leg fields undefined.
  const legs = calculateAlBrooksLegs(visible);
  const leg = type === 'BUY' ? legs.bull[index] : legs.bear[index];
  const fallback = computeEntryMetrics(candles, index, config, leg);

  // Recent-price-action context: the last N Al Brooks impulse legs + the pullbacks
  // between them, contiguous back from the entry bar. Same H/L machinery, no pivots.
  const legSequence = buildLegSequence(
    visible,
    index,
    config.legSequenceCount ?? 10,
    config.legSequenceDetail ?? 'full'
  );

  const pivotHighSeq = entryMetricsOverride?.pivotHighSeq ?? fallback?.pivotHighSeq ?? [];
  const pivotLowSeq = entryMetricsOverride?.pivotLowSeq ?? fallback?.pivotLowSeq ?? [];

  return {
    isInitialWith:
      (type === 'BUY' && ltMarket.startsWith('Bull')) ||
      (type === 'SELL' && ltMarket.startsWith('Bear')),
    fields: {
      atrDepthAtEntry,
      barOverlapAtEntry,
      barOverlapAvgAtEntry: entryMetricsOverride?.barOverlapAvg ?? fallback?.barOverlapAvg,
      barRangeAvgAtEntry: entryMetricsOverride?.barRangeAvg ?? fallback?.barRangeAvg,
      bullBarRangeAvgAtEntry: entryMetricsOverride?.bullBarRangeAvg ?? fallback?.bullBarRangeAvg,
      bearBarRangeAvgAtEntry: entryMetricsOverride?.bearBarRangeAvg ?? fallback?.bearBarRangeAvg,
      efficiencyRatioAtEntry: entryMetricsOverride?.efficiencyRatio ?? fallback?.efficiencyRatio,
      highBreakCountAtEntry: entryMetricsOverride?.highBreakCount ?? fallback?.highBreakCount,
      lowBreakCountAtEntry: entryMetricsOverride?.lowBreakCount ?? fallback?.lowBreakCount,
      barBreakWindowAtEntry: entryMetricsOverride?.barBreakWindow ?? fallback?.barBreakWindow,
      ema21SlopeAtEntry: entryMetricsOverride?.ema21Slope ?? fallback?.ema21Slope,
      ema50SlopeAtEntry: entryMetricsOverride?.ema50Slope ?? fallback?.ema50Slope,
      ema20GapBarRatioAtEntry: entryMetricsOverride?.ema20GapBarRatio ?? fallback?.ema20GapBarRatio,
      ema20CloseAboveRatioAtEntry: entryMetricsOverride?.ema20CloseAboveRatio ?? fallback?.ema20CloseAboveRatio,
      ema20InteractionWindowAtEntry: entryMetricsOverride?.ema20InteractionWindow ?? fallback?.ema20InteractionWindow,
      pivotHighSeqAtEntry: pivotHighSeq.length ? pivotHighSeq.join('-') : undefined,
      pivotLowSeqAtEntry: pivotLowSeq.length ? pivotLowSeq.join('-') : undefined,
      pivotGapAvgBarsAtEntry: entryMetricsOverride?.pivotGapAvgBars ?? fallback?.pivotGapAvgBars,
      brrAtEntry: entryMetricsOverride?.brrSeries ?? fallback?.brrSeries,
      clvAtEntry: entryMetricsOverride?.clvSeries ?? fallback?.clvSeries,
      uwrAtEntry: entryMetricsOverride?.uwrSeries ?? fallback?.uwrSeries,
      lwrAtEntry: entryMetricsOverride?.lwrSeries ?? fallback?.lwrSeries,
      brrAvgAtEntry: entryMetricsOverride?.brrAvg ?? fallback?.brrAvg,
      clvAvgAtEntry: entryMetricsOverride?.clvAvg ?? fallback?.clvAvg,
      uwrAvgAtEntry: entryMetricsOverride?.uwrAvg ?? fallback?.uwrAvg,
      lwrAvgAtEntry: entryMetricsOverride?.lwrAvg ?? fallback?.lwrAvg,
      // Leg fields have no fallback recompute: undefined simply means the entry was
      // graded with currentIndex windows (PIVOT mode / no completed leg / degenerate leg).
      legStartIndexAtEntry: entryMetricsOverride?.legStartIndex ?? fallback?.legStartIndex,
      legEndIndexAtEntry: entryMetricsOverride?.legEndIndex ?? fallback?.legEndIndex,
      legBarCountAtEntry: entryMetricsOverride?.legBarCount ?? fallback?.legBarCount,
      maxConsecutiveHighBreaksAtEntry:
        entryMetricsOverride?.maxConsecutiveHighBreaks ?? fallback?.maxConsecutiveHighBreaks,
      maxConsecutiveLowBreaksAtEntry:
        entryMetricsOverride?.maxConsecutiveLowBreaks ?? fallback?.maxConsecutiveLowBreaks,
      legSequenceAtEntry: legSequence.length ? legSequence : undefined,
    },
  };
}
