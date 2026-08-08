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
import { analyzeMarketStructure } from './pivotAnalysis';
import { computeEntryMetrics, type AutoBacktestConfig, type EntryMetricsSnapshot } from './autoBacktestEngine';
import { buildLegSequence } from './legSequence';
import { buildSessionOpenFields } from './sessionDay';

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

  // Manual/fallback instrumentation — the same computeEntryMetrics the auto engine
  // uses, graded over the completed breakout leg matching the trade's direction
  // (BUY → bull leg, SELL → bear leg) when one exists. A short leg still records
  // over the bars available (manual entries are never blocked by Leg Min Bars);
  // no completed leg yet → entry-bar windows with the configured lookbacks.
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
      brrAvgAtEntry: entryMetricsOverride?.brrAvg ?? fallback?.brrAvg,
      brrAvgIQRAtEntry: entryMetricsOverride?.brrAvgIQR ?? fallback?.brrAvgIQR,
      ema21SlopeAtEntry: entryMetricsOverride?.ema21Slope ?? fallback?.ema21Slope,
      ema50SlopeAtEntry: entryMetricsOverride?.ema50Slope ?? fallback?.ema50Slope,
      ema20GapBarRatioAtEntry: entryMetricsOverride?.ema20GapBarRatio ?? fallback?.ema20GapBarRatio,
      ema20CloseAboveRatioAtEntry: entryMetricsOverride?.ema20CloseAboveRatio ?? fallback?.ema20CloseAboveRatio,
      ema20InteractionWindowAtEntry: entryMetricsOverride?.ema20InteractionWindow ?? fallback?.ema20InteractionWindow,
      pivotHighSeqAtEntry: pivotHighSeq.length ? pivotHighSeq.join('-') : undefined,
      pivotLowSeqAtEntry: pivotLowSeq.length ? pivotLowSeq.join('-') : undefined,
      pivotGapAvgBarsAtEntry: entryMetricsOverride?.pivotGapAvgBars ?? fallback?.pivotGapAvgBars,
      // Session-open context (open bar + gap up/down + bars into the session).
      // Deterministic from (candles, index) alone, so there is nothing for the
      // auto engine to override.
      ...buildSessionOpenFields(candles, index),
      legSequenceAtEntry: legSequence.length ? legSequence : undefined,
    },
  };
}
