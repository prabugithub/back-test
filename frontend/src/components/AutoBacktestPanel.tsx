import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Zap, TrendingUp, TrendingDown, Minus, RefreshCw, BarChart2 } from 'lucide-react';
import { useSessionStore } from '../stores/sessionStore';
import { EntryMetricsDashboard } from './EntryMetricsDashboard';
import type { Candle } from '../types';
import {
  type AutoBacktestConfig,
  type RegimeRules,
  type RegimeKey,
  defaultAutoBacktestConfig,
  AUTO_BT_PRESETS,
  REGIME_LABELS,
  getCurrentMarketState,
  generateBinaryPatterns,
} from '../utils/autoBacktestEngine';
import { useFilterPreviewData, type PreviewFilterKey } from '../hooks/useFilterPreviewData';
import { FilterPreviewStrip } from './autobacktest-visuals/FilterPreviewStrip';
import { ThresholdFilterControl } from './autobacktest-visuals/ThresholdFilterControl';
import { BarOverlapDiagram } from './autobacktest-visuals/BarOverlapDiagram';
import { BarRangeFilterControl } from './autobacktest-visuals/BarRangeFilterControl';
import { BreakCountDiagram } from './autobacktest-visuals/BreakCountDiagram';
import { EmaSlopeDiagram } from './autobacktest-visuals/EmaSlopeDiagram';
import { EmaInteractionDiagram } from './autobacktest-visuals/EmaInteractionDiagram';
import { EfficiencyRatioDiagram } from './autobacktest-visuals/EfficiencyRatioDiagram';
import { ModePickerControl } from './autobacktest-visuals/ModePickerControl';
import { MaPositionDiagram } from './autobacktest-visuals/MaPositionDiagram';
import { PivotSeqDiagram } from './autobacktest-visuals/PivotSeqDiagram';
import { AtrDepthDiagram } from './autobacktest-visuals/AtrDepthDiagram';
import { PivotSequencePatternPicker } from './autobacktest-visuals/PivotSequencePatternPicker';
import { PivotGapDiagram } from './autobacktest-visuals/PivotGapDiagram';

const HIGH_SEQ_PATTERNS = generateBinaryPatterns('HH', 'LH');
const LOW_SEQ_PATTERNS = generateBinaryPatterns('HL', 'LL');

interface AutoBacktestPanelProps {
  onClose: () => void;
}

// ─── Regime tab icons & colors ────────────────────────────────────────────────

const REGIME_META: Record<RegimeKey, { icon: React.ReactNode; color: string; bg: string; border: string; activeBg: string }> = {
  uptrend: {
    icon: <TrendingUp size={13} />,
    color: 'text-green-700',
    bg: 'bg-green-50',
    border: 'border-green-200',
    activeBg: 'bg-green-600',
  },
  downtrend: {
    icon: <TrendingDown size={13} />,
    color: 'text-red-700',
    bg: 'bg-red-50',
    border: 'border-red-200',
    activeBg: 'bg-red-600',
  },
  range: {
    icon: <Minus size={13} />,
    color: 'text-amber-700',
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    activeBg: 'bg-amber-500',
  },
  reversal: {
    icon: <RefreshCw size={13} />,
    color: 'text-purple-700',
    bg: 'bg-purple-50',
    border: 'border-purple-200',
    activeBg: 'bg-purple-600',
  },
};

// ─── Regime rules editor ──────────────────────────────────────────────────────

interface RegimeEditorProps {
  regime: RegimeKey;
  rules: RegimeRules;
  onChange: (rules: RegimeRules) => void;
  candles: Candle[];
  currentIndex: number;
  config: AutoBacktestConfig;
}

// Starting-point recommendations, not fixed rules — tune per instrument/timeframe against
// your own batch-backtest results. Trend rows apply to both Uptrend and Downtrend (the
// direction-aligned filters flip automatically for shorts, so the same setting works for both).
const QUALITY_FILTER_GUIDE: { filter: string; trend: string; range: string; reversal: string }[] = [
  { filter: 'Bar Overlap', trend: '≤0.4 (Clean/Trend)', range: '≥0.5 (Choppy) or None', reversal: 'None — structure still forming' },
  { filter: 'Bar Range', trend: 'Dominance ≥1.0×', range: 'None', reversal: 'Dominance ≥1.0× once turn confirms' },
  { filter: 'Break Count', trend: '≥5 (Persistent)', range: '≤3 (Exhausted/quiet)', reversal: 'None' },
  { filter: 'EMA21 Slope', trend: '≥0 (Favor Trade)', range: '≤0.1 (Flat) or None', reversal: 'None — slope hasn’t turned yet' },
  { filter: 'EMA50 Slope', trend: '≥0 (Favor Trade)', range: '≤0.1 (Flat) or None', reversal: 'None' },
  { filter: 'EMA20 Gap-Bar', trend: '≥0.4 (continuation) or ≤0.3 (pullback entries)', range: '≤0.3 (still touching)', reversal: '≤0.3 (still touching)' },
  { filter: 'EMA20 Bias', trend: '≥0.6 (Sustained)', range: 'None', reversal: '≥0.5 (early confirm)' },
];

function RegimeEditor({ regime, rules, onChange, candles, currentIndex, config }: RegimeEditorProps) {
  const meta = REGIME_META[regime];
  const up = (patch: Partial<RegimeRules>) => onChange({ ...rules, ...patch });
  const [showGuide, setShowGuide] = useState(false);
  const [hoveredFilterKey, setHoveredFilterKey] = useState<PreviewFilterKey | null>(null);
  const previewBars = useFilterPreviewData(candles, currentIndex, rules, config);
  const latestBar = previewBars[previewBars.length - 1];
  const isShort = rules.direction === 'SHORT_ONLY';
  const isBoth = rules.direction === 'BOTH';

  return (
    <div className="space-y-3 pt-1">
      <FilterPreviewStrip bars={previewBars} highlightFilterKey={hoveredFilterKey} />

      {/* Enable + Direction */}
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <div
            onClick={() => up({ enabled: !rules.enabled })}
            className={`relative w-9 h-5 rounded-full transition-colors ${rules.enabled ? meta.activeBg : 'bg-gray-300'}`}
          >
            <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${rules.enabled ? 'translate-x-4' : ''}`} />
          </div>
          <span className={`text-xs font-semibold ${rules.enabled ? meta.color : 'text-gray-400'}`}>
            {rules.enabled ? 'Active' : 'Disabled'}
          </span>
        </label>

        <div className="flex gap-1">
          {(['LONG_ONLY', 'SHORT_ONLY', 'BOTH'] as const).map(d => (
            <button
              key={d}
              onClick={() => up({ direction: d })}
              className={`px-1.5 py-0.5 text-[10px] rounded border font-medium transition-colors ${
                rules.direction === d
                  ? d === 'LONG_ONLY' ? 'bg-green-600 text-white border-green-600'
                    : d === 'SHORT_ONLY' ? 'bg-red-600 text-white border-red-600'
                    : 'bg-purple-600 text-white border-purple-600'
                  : 'bg-gray-50 text-gray-500 border-gray-300 hover:bg-gray-100'
              }`}
            >
              {d === 'LONG_ONLY' ? 'Long' : d === 'SHORT_ONLY' ? 'Short' : 'Both'}
            </button>
          ))}
        </div>
      </div>

      {/* Entry mode */}
      <div>
        <p className="text-[10px] text-gray-400 mb-1 uppercase tracking-wide font-medium">Entry Signal</p>
        <div className="flex gap-1 mb-1.5">
          {(['PIVOT', 'H_SIGNAL', 'CONFLUENCE'] as const).map(m => (
            <button
              key={m}
              onClick={() => up({ entryMode: m })}
              className={`flex-1 py-1 text-[10px] rounded border font-medium transition-colors ${
                rules.entryMode === m ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-gray-50 text-gray-500 border-gray-300 hover:bg-gray-100'
              }`}
            >
              {m === 'PIVOT' ? 'Pivot' : m === 'H_SIGNAL' ? 'H/L Signal' : 'Confluence'}
            </button>
          ))}
        </div>

        {/* H/L signal toggles */}
        <div className="flex gap-3 mb-1.5">
          {(['H1', 'H2'] as const).map(s => {
            const key = `allow${s}` as 'allowH1' | 'allowH2';
            return (
              <label key={s} className="flex items-center gap-1 cursor-pointer">
                <input type="checkbox" checked={rules[key]} onChange={e => up({ [key]: e.target.checked })} className="w-3 h-3" />
                <span className="text-xs font-bold text-green-700">{s}</span>
              </label>
            );
          })}
          {(['L1', 'L2'] as const).map(s => {
            const key = `allow${s}` as 'allowL1' | 'allowL2';
            return (
              <label key={s} className="flex items-center gap-1 cursor-pointer">
                <input type="checkbox" checked={rules[key]} onChange={e => up({ [key]: e.target.checked })} className="w-3 h-3" />
                <span className="text-xs font-bold text-red-700">{s}</span>
              </label>
            );
          })}
          {rules.entryMode === 'CONFLUENCE' && (
            <div className="flex items-center gap-1 ml-auto">
              <span className="text-[10px] text-gray-500">Lookback:</span>
              <input
                type="number" min={1} max={20} value={rules.confluenceLookback}
                onChange={e => up({ confluenceLookback: Number(e.target.value) })}
                className="w-10 px-1 py-0.5 text-[10px] border rounded text-center"
              />
            </div>
          )}
        </div>
      </div>

      {/* Filters row */}
      <div className="grid grid-cols-2 gap-2">
        <div className="col-span-2">
          <ModePickerControl
            label="MA Filter"
            tooltip="Where price must sit relative to a moving average at entry. On/Touch allows the candle to still be interacting with the line; the plain Above/Below variants require clear separation."
            mode={rules.maFilter}
            offValue="none"
            modeOptions={[
              { value: 'none', label: 'Off' },
              { value: 'above_ema21', label: isBoth ? 'EMA21 side' : isShort ? 'Below EMA21' : 'Above EMA21' },
              { value: 'on_or_above_ema21', label: isBoth ? 'EMA21 touch' : isShort ? 'On/Below EMA21' : 'On/Above EMA21' },
              { value: 'above_ema60', label: isBoth ? 'EMA60 side' : isShort ? 'Below EMA60' : 'Above EMA60' },
            ]}
            onModeChange={v => up({ maFilter: v as RegimeRules['maFilter'] })}
            diagram={m => (m === 'none' ? null : <MaPositionDiagram variant={m as 'above_ema21' | 'on_or_above_ema21' | 'above_ema60'} isShort={isShort} />)}
          />
        </div>

        <div className="col-span-2">
          <ModePickerControl
            label="Pivot Seq"
            tooltip="Matches the single most recent swing-high and swing-low trend labels (Brooks HH/LH, HL/LL) against a specific pattern. 'Any' applies no filter."
            mode={rules.ltPivotSequence}
            offValue="any"
            gridCols={5}
            modeOptions={[
              { value: 'any', label: 'Any' },
              { value: 'HH-HL', label: 'HH-HL (Bull)' },
              { value: 'LH-HL', label: 'LH-HL (Reversal)' },
              { value: 'HH-LL', label: 'HH-LL (Mixed)' },
              { value: 'LH-LL', label: 'LH-LL (Bear)' },
            ]}
            onModeChange={v => up({ ltPivotSequence: v as RegimeRules['ltPivotSequence'] })}
            diagram={m => (m === 'any' ? null : <PivotSeqDiagram pattern={m as 'HH-HL' | 'LH-HL' | 'HH-LL' | 'LH-LL'} />)}
          />
        </div>

        <div className="col-span-2">
          <ModePickerControl
            label="HT Structure"
            tooltip="Higher-timeframe structure gate. Note: this is actually an EMA60 slope computed on the same base-timeframe candles, not a true resampled higher-timeframe read — treat it as a longer-term trend confirmation, not independent multi-timeframe confluence."
            mode={rules.htStructureFilter}
            offValue="any"
            modeOptions={[
              { value: 'any', label: 'Any' },
              { value: 'bull_trend', label: 'Bull Trend' },
              { value: 'bear_trend', label: 'Bear Trend' },
            ]}
            onModeChange={v => up({ htStructureFilter: v as RegimeRules['htStructureFilter'] })}
            diagram={m =>
              m === 'any' ? null : m === 'bull_trend' ? (
                <TrendingUp size={22} className="text-green-600" />
              ) : (
                <TrendingDown size={22} className="text-red-600" />
              )
            }
          />
        </div>

        <div className="col-span-2">
          <ThresholdFilterControl
            label="ATR Depth"
            tooltip="Distance of the entry price from the EMA21, measured in ATR units (volatility-normalized). Trend caps how far price can be from the average, to avoid chasing an overextended move. Gap/Range instead requires a minimum distance, for gap or range-reversal entries."
            mode={rules.atrDepthFilter ?? 'none'}
            offValue="none"
            modeOptions={[
              { value: 'none', label: 'Off' },
              { value: 'max', label: 'Trend' },
              { value: 'min', label: 'Gap/Range' },
            ]}
            onModeChange={v => up({ atrDepthFilter: v as RegimeRules['atrDepthFilter'] })}
            threshold={rules.atrDepthThreshold ?? 1.5}
            onThresholdChange={v => up({ atrDepthThreshold: v })}
            min={0.25}
            max={4}
            step={0.25}
            formatValue={v => v.toFixed(2)}
            liveValue={latestBar?.atrDepth}
            onHoverChange={hovering => setHoveredFilterKey(hovering ? 'atrDepth' : null)}
            diagram={<AtrDepthDiagram atrMultiple={rules.atrDepthThreshold ?? 1.5} />}
          />
        </div>

        <div className="col-span-2">
          <ThresholdFilterControl
            label="Efficiency Ratio"
            tooltip="How directly price traveled from A to B over the lookback window (Kaufman Efficiency Ratio). Near 1 = a straight, efficient trend; near 0 = price zigzagged and cancelled itself out (chop)."
            mode={rules.efficiencyRatioFilter ?? 'none'}
            offValue="none"
            modeOptions={[
              { value: 'none', label: 'Off' },
              { value: 'min', label: 'Trending' },
              { value: 'max', label: 'Choppy' },
            ]}
            onModeChange={v => up({ efficiencyRatioFilter: v as RegimeRules['efficiencyRatioFilter'] })}
            threshold={rules.efficiencyRatioThreshold ?? 0.3}
            onThresholdChange={v => up({ efficiencyRatioThreshold: v })}
            min={0}
            max={1}
            step={0.05}
            liveValue={latestBar?.metrics.efficiencyRatio}
            onHoverChange={hovering => setHoveredFilterKey(hovering ? 'efficiencyRatio' : null)}
            diagram={<EfficiencyRatioDiagram ratio={rules.efficiencyRatioThreshold ?? 0.3} />}
          />
        </div>
      </div>

      {/* Quality-setup filters (instrumentation-based) */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <p
            className="text-[10px] text-gray-400 uppercase tracking-wide font-medium cursor-help"
            title="Reject a signal outright unless its market-structure condition holds — not just recorded on the trade, but checked before entry. Directional filters (Break Count, EMA Slope, EMA20 Bias) automatically flip to match whichever side (long/short) is being evaluated, so one setting covers both directions."
          >
            Quality Setup Filters
          </p>
          <button
            onClick={() => setShowGuide(v => !v)}
            className="text-[10px] text-indigo-500 hover:text-indigo-700 font-medium flex items-center gap-0.5"
          >
            Suggested values by regime {showGuide ? '▲' : '▼'}
          </button>
        </div>
        {showGuide && (
          <div className="mb-2 border border-indigo-100 rounded-lg overflow-x-auto">
            <table className="w-full text-[10px] border-collapse">
              <thead>
                <tr className="bg-indigo-50 text-indigo-700">
                  <th className="text-left px-2 py-1 font-semibold">Filter</th>
                  <th className="text-left px-2 py-1 font-semibold">Uptrend / Downtrend</th>
                  <th className="text-left px-2 py-1 font-semibold">Range</th>
                  <th className="text-left px-2 py-1 font-semibold">Reversal</th>
                </tr>
              </thead>
              <tbody>
                {QUALITY_FILTER_GUIDE.map((row, i) => (
                  <tr key={row.filter} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="px-2 py-1 font-medium text-gray-600 whitespace-nowrap">{row.filter}</td>
                    <td className="px-2 py-1 text-gray-500">{row.trend}</td>
                    <td className="px-2 py-1 text-gray-500">{row.range}</td>
                    <td className="px-2 py-1 text-gray-500">{row.reversal}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="px-2 py-1 text-[9px] text-gray-400 bg-gray-50 border-t border-indigo-100">
              Starting points, not rules — tune against your own batch-backtest results per instrument/timeframe.
            </p>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <div className="col-span-2">
            <ThresholdFilterControl
              label="Bar Overlap"
              tooltip="How much each bar's range overlaps the previous bar's range, averaged over the 'Overlap' lookback (Instrumentation Lookbacks section above). Low overlap = clean directional bars; high overlap = choppy/ranging."
              mode={rules.barOverlapFilter ?? 'none'}
              offValue="none"
              modeOptions={[
                { value: 'none', label: 'Off' },
                { value: 'max', label: 'Clean/Trend' },
                { value: 'min', label: 'Choppy' },
              ]}
              onModeChange={v => up({ barOverlapFilter: v as RegimeRules['barOverlapFilter'] })}
              threshold={rules.barOverlapThreshold ?? 0.4}
              onThresholdChange={v => up({ barOverlapThreshold: v })}
              min={0}
              max={1}
              step={0.05}
              liveValue={latestBar?.metrics.barOverlapAvg}
              onHoverChange={hovering => setHoveredFilterKey(hovering ? 'barOverlap' : null)}
              diagram={<BarOverlapDiagram ratio={rules.barOverlapThreshold ?? 0.4} />}
            />
          </div>

          <div className="col-span-2">
            <BarRangeFilterControl
              mode={rules.barRangeFilter ?? 'none'}
              onModeChange={v => up({ barRangeFilter: v as RegimeRules['barRangeFilter'] })}
              dominanceThreshold={rules.barRangeDominanceThreshold ?? 1.0}
              onDominanceChange={v => up({ barRangeDominanceThreshold: v })}
              rangeThreshold={rules.barRangeThreshold ?? 0}
              onRangeChange={v => up({ barRangeThreshold: v })}
              liveDominance={
                latestBar && rules.direction !== 'SHORT_ONLY'
                  ? latestBar.metrics.bullBarRangeAvg && latestBar.metrics.bearBarRangeAvg
                    ? latestBar.metrics.bullBarRangeAvg / latestBar.metrics.bearBarRangeAvg
                    : undefined
                  : latestBar?.metrics.bearBarRangeAvg && latestBar?.metrics.bullBarRangeAvg
                  ? latestBar.metrics.bearBarRangeAvg / latestBar.metrics.bullBarRangeAvg
                  : undefined
              }
              liveRangeAvg={latestBar?.metrics.barRangeAvg}
              onHoverChange={hovering => setHoveredFilterKey(hovering ? 'barRange' : null)}
            />
          </div>

          <div className="col-span-2">
            <ThresholdFilterControl
              label="Break Count"
              tooltip="Counts, over the 'Breaks' lookback, how many bars made a new high (for longs) or new low (for shorts) vs. the bar before it — a momentum/persistence check. Persistent requires at least X breaks (momentum still active). Exhausted requires at most X (momentum fading — useful for reversal/fade entries)."
              mode={rules.barBreakFilter ?? 'none'}
              offValue="none"
              modeOptions={[
                { value: 'none', label: 'Off' },
                { value: 'min', label: 'Persistent' },
                { value: 'max', label: 'Exhausted' },
              ]}
              onModeChange={v => up({ barBreakFilter: v as RegimeRules['barBreakFilter'] })}
              threshold={rules.barBreakThreshold ?? 5}
              onThresholdChange={v => up({ barBreakThreshold: v })}
              min={0}
              max={20}
              step={1}
              liveValue={rules.direction !== 'SHORT_ONLY' ? latestBar?.metrics.highBreakCount : latestBar?.metrics.lowBreakCount}
              formatValue={v => v.toFixed(0)}
              onHoverChange={hovering => setHoveredFilterKey(hovering ? 'barBreak' : null)}
              diagram={<BreakCountDiagram count={rules.barBreakThreshold ?? 5} />}
            />
          </div>

          <div className="col-span-2">
            <ThresholdFilterControl
              label="EMA21 Slope"
              tooltip="Rate of change (steepness) of the EMA21, automatically flipped for shorts so this always means 'is the EMA sloping in my trade's favor.' Favor Trade requires the slope to clear the threshold (0 = just needs to point the right way). Not Overextended instead caps how steep it can be. Raw price-points/bar — instrument/timeframe-scale-dependent, use 'your data' as a starting reference."
              mode={rules.ema21SlopeFilter ?? 'none'}
              offValue="none"
              modeOptions={[
                { value: 'none', label: 'Off' },
                { value: 'min', label: 'Favor Trade' },
                { value: 'max', label: 'Not Overextended' },
              ]}
              onModeChange={v => up({ ema21SlopeFilter: v as RegimeRules['ema21SlopeFilter'] })}
              threshold={rules.ema21SlopeThreshold ?? 0}
              onThresholdChange={v => up({ ema21SlopeThreshold: v })}
              min={-2}
              max={2}
              step={0.05}
              liveValue={latestBar?.metrics.ema21Slope}
              onHoverChange={hovering => setHoveredFilterKey(hovering ? 'ema21Slope' : null)}
              diagram={<EmaSlopeDiagram slope={rules.ema21SlopeThreshold ?? 0} min={-2} max={2} />}
            />
          </div>

          <div className="col-span-2">
            <ThresholdFilterControl
              label="EMA50 Slope"
              tooltip="Same as EMA21 Slope above, but on the slower EMA50 — a longer-term trend-direction confirmation rather than short-term steepness."
              mode={rules.ema50SlopeFilter ?? 'none'}
              offValue="none"
              modeOptions={[
                { value: 'none', label: 'Off' },
                { value: 'min', label: 'Favor Trade' },
                { value: 'max', label: 'Not Overextended' },
              ]}
              onModeChange={v => up({ ema50SlopeFilter: v as RegimeRules['ema50SlopeFilter'] })}
              threshold={rules.ema50SlopeThreshold ?? 0}
              onThresholdChange={v => up({ ema50SlopeThreshold: v })}
              min={-2}
              max={2}
              step={0.05}
              liveValue={latestBar?.metrics.ema50Slope}
              onHoverChange={hovering => setHoveredFilterKey(hovering ? 'ema50Slope' : null)}
              diagram={<EmaSlopeDiagram slope={rules.ema50SlopeThreshold ?? 0} min={-2} max={2} />}
            />
          </div>

          <div className="col-span-2">
            <ThresholdFilterControl
              label="EMA20 Gap-Bar"
              tooltip="Fraction of bars over the 'EMA20 Interaction' lookback whose entire range never touches the EMA20 ('gap bars' — a Brooks strong-trend signal). Strong Trend requires at least X of bars to be gap bars. Pullback/Touch requires at most X — price is still interacting with the average, better suited to pullback/mean-reversion entries."
              mode={rules.ema20GapBarFilter ?? 'none'}
              offValue="none"
              modeOptions={[
                { value: 'none', label: 'Off' },
                { value: 'min', label: 'Strong Trend' },
                { value: 'max', label: 'Pullback/Touch' },
              ]}
              onModeChange={v => up({ ema20GapBarFilter: v as RegimeRules['ema20GapBarFilter'] })}
              threshold={rules.ema20GapBarThreshold ?? 0.5}
              onThresholdChange={v => up({ ema20GapBarThreshold: v })}
              min={0}
              max={1}
              step={0.05}
              liveValue={latestBar?.metrics.ema20GapBarRatio}
              onHoverChange={hovering => setHoveredFilterKey(hovering ? 'ema20GapBar' : null)}
              diagram={<EmaInteractionDiagram ratio={rules.ema20GapBarThreshold ?? 0.5} mode="gapBar" />}
            />
          </div>

          <div className="col-span-2">
            <ThresholdFilterControl
              label="EMA20 Bias"
              tooltip="Fraction of closes above the EMA20 over the same 'EMA20 Interaction' lookback ('always-in' bias), automatically flipped for shorts so this always means 'is price staying on my trade's side of the average.' Sustained Bias requires at least X (bias holding steady). Weak Bias requires at most X (choppier back-and-forth around the average)."
              mode={rules.ema20BiasFilter ?? 'none'}
              offValue="none"
              modeOptions={[
                { value: 'none', label: 'Off' },
                { value: 'min', label: 'Sustained Bias' },
                { value: 'max', label: 'Weak Bias' },
              ]}
              onModeChange={v => up({ ema20BiasFilter: v as RegimeRules['ema20BiasFilter'] })}
              threshold={rules.ema20BiasThreshold ?? 0.5}
              onThresholdChange={v => up({ ema20BiasThreshold: v })}
              min={0}
              max={1}
              step={0.05}
              liveValue={
                rules.direction !== 'SHORT_ONLY'
                  ? latestBar?.metrics.ema20CloseAboveRatio
                  : latestBar?.metrics.ema20CloseAboveRatio !== undefined
                  ? 1 - latestBar.metrics.ema20CloseAboveRatio
                  : undefined
              }
              onHoverChange={hovering => setHoveredFilterKey(hovering ? 'ema20Bias' : null)}
              diagram={<EmaInteractionDiagram ratio={rules.ema20BiasThreshold ?? 0.5} mode="bias" />}
            />
          </div>
        </div>
      </div>

      {/* Pivot sequence history + inter-pivot distance */}
      <div>
        <p className="text-[10px] text-gray-400 mb-1 uppercase tracking-wide font-medium">
          Pivot Sequence History (last 4)
        </p>
        <div className="grid grid-cols-2 gap-2">
          <PivotSequencePatternPicker
            label="High Sequence"
            tooltip="Matches the last 4 bearish-pivot trend labels (swing highs: HH/LH), oldest to newest, against a whitelist of allowed 4-in-a-row patterns. With fewer than 4 pivots recorded yet, this filter passes through."
            filter={rules.highSeqFilter}
            onFilterChange={v => up({ highSeqFilter: v })}
            patterns={HIGH_SEQ_PATTERNS}
            selectedPatterns={rules.highSeqPatterns ?? []}
            onTogglePattern={p => {
              const active = (rules.highSeqPatterns ?? []).includes(p);
              up({
                highSeqPatterns: active
                  ? (rules.highSeqPatterns ?? []).filter(x => x !== p)
                  : [...(rules.highSeqPatterns ?? []), p],
              });
            }}
            onHoverChange={hovering => setHoveredFilterKey(hovering ? 'highSeq' : null)}
          />

          <PivotSequencePatternPicker
            label="Low Sequence"
            tooltip="Matches the last 4 bullish-pivot trend labels (swing lows: HL/LL), oldest to newest, against a whitelist of allowed 4-in-a-row patterns. With fewer than 4 pivots recorded yet, this filter passes through."
            filter={rules.lowSeqFilter}
            onFilterChange={v => up({ lowSeqFilter: v })}
            patterns={LOW_SEQ_PATTERNS}
            selectedPatterns={rules.lowSeqPatterns ?? []}
            onTogglePattern={p => {
              const active = (rules.lowSeqPatterns ?? []).includes(p);
              up({
                lowSeqPatterns: active
                  ? (rules.lowSeqPatterns ?? []).filter(x => x !== p)
                  : [...(rules.lowSeqPatterns ?? []), p],
              });
            }}
            onHoverChange={hovering => setHoveredFilterKey(hovering ? 'lowSeq' : null)}
          />

          <div className="col-span-2">
            <ThresholdFilterControl
              label="Pivot Gap (bars)"
              tooltip="Average bar-count gap between consecutive pivots across both the high and low sequences — a trend-pace check. Fast requires the average gap to stay at or below the threshold (pivots forming quickly — accelerating/choppy). Slow requires it to be at or above (pivots spaced out — a slower, more mature trend)."
              mode={rules.pivotGapFilter ?? 'none'}
              offValue="none"
              modeOptions={[
                { value: 'none', label: 'Off' },
                { value: 'max', label: 'Fast' },
                { value: 'min', label: 'Slow' },
              ]}
              onModeChange={v => up({ pivotGapFilter: v as RegimeRules['pivotGapFilter'] })}
              threshold={rules.pivotGapThreshold ?? 5}
              onThresholdChange={v => up({ pivotGapThreshold: v })}
              min={0}
              max={20}
              step={1}
              formatValue={v => `${v.toFixed(0)} bars`}
              liveValue={latestBar?.metrics.pivotGapAvgBars}
              onHoverChange={hovering => setHoveredFilterKey(hovering ? 'pivotGap' : null)}
              diagram={<PivotGapDiagram gapBars={rules.pivotGapThreshold ?? 5} />}
            />
          </div>
        </div>
      </div>

      {/* Risk */}
      <div>
        <p className="text-[10px] text-gray-400 mb-1 uppercase tracking-wide font-medium">Risk</p>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex gap-1">
            {(['pivot', 'atr', 'fixed'] as const).map(m => (
              <button
                key={m}
                onClick={() => up({ slMethod: m })}
                className={`px-2 py-0.5 text-[10px] rounded border font-medium ${
                  rules.slMethod === m ? 'bg-orange-600 text-white border-orange-600' : 'bg-gray-50 text-gray-500 border-gray-300 hover:bg-gray-100'
                }`}
              >
                {m === 'pivot' ? 'Pivot SL' : m === 'atr' ? 'ATR SL' : 'Fixed SL'}
              </button>
            ))}
          </div>
          {rules.slMethod === 'atr' && (
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-gray-500">×</span>
              <input type="number" step={0.1} min={0.5} max={5} value={rules.slAtrMultiplier}
                onChange={e => up({ slAtrMultiplier: Number(e.target.value) })}
                className="w-12 px-1 py-0.5 text-[10px] border rounded text-center" />
            </div>
          )}
          {rules.slMethod === 'fixed' && (
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-gray-500">pts</span>
              <input type="number" min={1} value={rules.slFixedPoints}
                onChange={e => up({ slFixedPoints: Number(e.target.value) })}
                className="w-16 px-1 py-0.5 text-[10px] border rounded text-center" />
            </div>
          )}
          <div className="flex items-center gap-1 ml-auto">
            <span className="text-[10px] text-gray-500">RR:</span>
            <input type="number" step={0.5} min={0.5} max={10} value={rules.targetRR}
              onChange={e => up({ targetRR: Number(e.target.value) })}
              className="w-12 px-1 py-0.5 text-[10px] border rounded text-center" />
            <span className="text-[10px] text-gray-400">×</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export function AutoBacktestPanel({ onClose }: AutoBacktestPanelProps) {
  const config = useSessionStore(s => s.autoBacktestConfig);
  const lastSignalReason = useSessionStore(s => s.lastAutoSignalReason);
  const setAutoBacktestConfig = useSessionStore(s => s.setAutoBacktestConfig);
  const position = useSessionStore(s => s.position);
  const candles = useSessionStore(s => s.candles);
  const currentIndex = useSessionStore(s => s.currentIndex);
  const runBatchAutoBacktest = useSessionStore(s => s.runBatchAutoBacktest);
  const isBatchRunning = useSessionStore(s => s.isBatchBacktestRunning);
  const batchProgress = useSessionStore(s => s.batchBacktestProgress);
  const trades = useSessionStore(s => s.trades);

  const [activeRegime, setActiveRegime] = useState<RegimeKey>('uptrend');
  const [showMetrics, setShowMetrics] = useState(false);

  // Live market state
  const marketState = useMemo(
    () => getCurrentMarketState(candles, currentIndex),
    [candles, currentIndex]
  );

  const updateGlobal = (patch: Partial<AutoBacktestConfig>) =>
    setAutoBacktestConfig({ ...config, ...patch });

  const updateRegime = (regime: RegimeKey) => (rules: RegimeRules) =>
    setAutoBacktestConfig({ ...config, [regime]: rules });

  const applyPreset = (name: string) => {
    const preset = AUTO_BT_PRESETS[name];
    if (!preset) return;
    setAutoBacktestConfig({
      ...defaultAutoBacktestConfig,
      ...preset,
      enabled: config.enabled,
      // Preserve session-level settings — presets only change regime rules
      tradeStartTime: config.tradeStartTime,
      tradeEndTime: config.tradeEndTime,
      useAutoQty: config.useAutoQty,
      riskPerTrade: config.riskPerTrade,
      minQuantity: config.minQuantity,
    });
  };

  const regimes: RegimeKey[] = ['uptrend', 'downtrend', 'range', 'reversal'];

  return createPortal(
    <div className="fixed inset-0 z-[110] bg-slate-50 flex flex-col overflow-hidden font-sans">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-slate-200 shrink-0">
        <div className="flex items-center gap-4">
          <button
            onClick={onClose}
            className="flex items-center gap-2 text-sm font-semibold text-slate-500 hover:text-slate-800 transition-colors"
          >
            <ArrowLeft size={18} />
            Back to Chart
          </button>
          <div className="w-px h-6 bg-slate-200" />
          <div className="bg-indigo-600 p-2 rounded-xl text-white shadow-lg shadow-indigo-200">
            <Zap size={20} />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-800 tracking-tight">Auto Backtesting Engine</h2>
            <p className="text-slate-500 text-xs font-medium">Configure regime rules and run instant batch backtests</p>
          </div>
        </div>

        {/* Enable + quick controls */}
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-1.5 cursor-pointer select-none">
            <input type="checkbox" checked={config.skipIfPositionOpen}
              onChange={e => updateGlobal({ skipIfPositionOpen: e.target.checked })}
              className="w-3.5 h-3.5" />
            <span className="text-xs text-slate-600 font-medium">Skip if open</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <div
              onClick={() => updateGlobal({ enabled: !config.enabled })}
              className={`relative w-10 h-5 rounded-full transition-colors ${config.enabled ? 'bg-indigo-600' : 'bg-gray-300'}`}
            >
              <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${config.enabled ? 'translate-x-5' : ''}`} />
            </div>
            <span className={`text-xs font-bold ${config.enabled ? 'text-indigo-700' : 'text-gray-400'}`}>
              {config.enabled ? 'Running' : 'Off'}
            </span>
          </label>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Settings Sidebar */}
        <div className="w-80 bg-white border-r border-slate-200 p-6 flex flex-col gap-5 overflow-y-auto shrink-0">
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase mb-2 tracking-tighter">Trading Window (IST)</p>
            <div className="flex items-center gap-2">
              <input
                type="time"
                value={config.tradeStartTime}
                onChange={e => updateGlobal({ tradeStartTime: e.target.value })}
                className="flex-1 px-2 py-1.5 text-xs border rounded-lg"
              />
              <span className="text-xs text-gray-400">→</span>
              <input
                type="time"
                value={config.tradeEndTime}
                onChange={e => updateGlobal({ tradeEndTime: e.target.value })}
                className="flex-1 px-2 py-1.5 text-xs border rounded-lg"
              />
            </div>
          </div>

          <div>
            <p className="text-xs font-bold text-slate-400 uppercase mb-2 tracking-tighter">Quantity</p>
            <label className="flex items-center gap-1.5 cursor-pointer select-none mb-1.5">
              <input
                type="checkbox"
                checked={config.useAutoQty}
                onChange={e => updateGlobal({ useAutoQty: e.target.checked })}
                className="w-3.5 h-3.5"
              />
              <span className="text-xs text-gray-600 font-medium">Auto (risk-based)</span>
            </label>
            {config.useAutoQty ? (
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1 flex-1">
                  <span className="text-[10px] text-gray-500">₹ Risk</span>
                  <input
                    type="number" step={1000} min={100} value={config.riskPerTrade}
                    onChange={e => updateGlobal({ riskPerTrade: Number(e.target.value) })}
                    className="w-full px-1.5 py-1 text-xs border rounded text-right"
                    title="Risk per trade (₹)"
                  />
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-gray-500">Min</span>
                  <input
                    type="number" min={1} value={config.minQuantity}
                    onChange={e => updateGlobal({ minQuantity: Number(e.target.value) })}
                    className="w-14 px-1.5 py-1 text-xs border rounded text-center"
                    title="Minimum quantity — skip trade if auto-qty is below this"
                  />
                </div>
              </div>
            ) : (
              <span className="text-[10px] text-gray-400">Using manual qty from trade panel</span>
            )}
          </div>

          <div>
            <p className="text-xs font-bold text-slate-400 uppercase mb-2 tracking-tighter">Square-off</p>
            <label className="flex items-center gap-1.5 cursor-pointer select-none mb-1.5">
              <input
                type="checkbox"
                checked={config.autoSquareOff}
                onChange={e => updateGlobal({ autoSquareOff: e.target.checked })}
                className="w-3.5 h-3.5"
              />
              <span className="text-xs text-gray-600 font-medium">Auto square-off</span>
            </label>
            {config.autoSquareOff && (
              <div className="flex items-center gap-2">
                <input
                  type="time"
                  value={config.squareOffTime}
                  onChange={e => updateGlobal({ squareOffTime: e.target.value })}
                  className="flex-1 px-2 py-1.5 text-xs border rounded-lg"
                  title="Close any open position at this IST time"
                />
                <span className="text-[10px] text-orange-600 font-medium">IST</span>
              </div>
            )}
          </div>

          <div>
            <p className="text-xs font-bold text-slate-400 uppercase mb-2 tracking-tighter">SL/TP Fill Price</p>
            <select
              value={config.slTpFillMode ?? 'exact'}
              onChange={e => updateGlobal({ slTpFillMode: e.target.value as AutoBacktestConfig['slTpFillMode'] })}
              className="w-full px-2 py-1.5 text-xs border rounded-lg"
              title="Exact: fill at the sl/tp price the instant intrabar high/low touches it. Close: legacy — only fire once candle close crosses the level."
            >
              <option value="exact">Exact touch (no slippage)</option>
              <option value="close">Close cross (legacy)</option>
            </select>
          </div>

          <div>
            <p className="text-xs font-bold text-slate-400 uppercase mb-2 tracking-tighter">Instrumentation Lookbacks</p>
            <div className="grid grid-cols-2 gap-x-3 gap-y-2">
              <div className="flex items-center justify-between gap-1">
                <span className="text-[10px] text-gray-500" title="Bars looked back for bar-overlap instrumentation on trade records">Overlap</span>
                <input
                  type="number" min={2} max={20} value={config.barOverlapLookback}
                  onChange={e => updateGlobal({ barOverlapLookback: Number(e.target.value) })}
                  className="w-12 px-1.5 py-1 text-xs border rounded text-center"
                />
              </div>
              <div className="flex items-center justify-between gap-1">
                <span className="text-[10px] text-gray-500" title="Bars looked back for bull/bear bar-range (trend strength) instrumentation on trade records">Bar Range</span>
                <input
                  type="number" min={5} max={50} value={config.barRangeLookback}
                  onChange={e => updateGlobal({ barRangeLookback: Number(e.target.value) })}
                  className="w-12 px-1.5 py-1 text-xs border rounded text-center"
                />
              </div>
              <div className="flex items-center justify-between gap-1">
                <span className="text-[10px] text-gray-500" title="Bars looked back for Kaufman Efficiency Ratio instrumentation on trade records">Efficiency</span>
                <input
                  type="number" min={3} max={30} value={config.efficiencyRatioLookback}
                  onChange={e => updateGlobal({ efficiencyRatioLookback: Number(e.target.value) })}
                  className="w-12 px-1.5 py-1 text-xs border rounded text-center"
                />
              </div>
              <div className="flex items-center justify-between gap-1">
                <span className="text-[10px] text-gray-500" title="Bars looked back for high/low break-count instrumentation on trade records">Breaks</span>
                <input
                  type="number" min={5} max={50} value={config.barBreakLookback}
                  onChange={e => updateGlobal({ barBreakLookback: Number(e.target.value) })}
                  className="w-12 px-1.5 py-1 text-xs border rounded text-center"
                />
              </div>
              <div className="flex items-center justify-between gap-1">
                <span className="text-[10px] text-gray-500" title="Bars looked back for EMA21 slope instrumentation on trade records">EMA21</span>
                <input
                  type="number" min={3} max={30} value={config.ema21SlopeLookback}
                  onChange={e => updateGlobal({ ema21SlopeLookback: Number(e.target.value) })}
                  className="w-12 px-1.5 py-1 text-xs border rounded text-center"
                />
              </div>
              <div className="flex items-center justify-between gap-1">
                <span className="text-[10px] text-gray-500" title="Bars looked back for EMA50 slope instrumentation on trade records">EMA50</span>
                <input
                  type="number" min={3} max={40} value={config.ema50SlopeLookback}
                  onChange={e => updateGlobal({ ema50SlopeLookback: Number(e.target.value) })}
                  className="w-12 px-1.5 py-1 text-xs border rounded text-center"
                />
              </div>
              <div className="flex items-center justify-between gap-1 col-span-2">
                <span className="text-[10px] text-gray-500" title="Bars looked back for EMA20 gap-bar / always-in interaction instrumentation on trade records">EMA20 Interaction</span>
                <input
                  type="number" min={5} max={50} value={config.emaInteractionLookback}
                  onChange={e => updateGlobal({ emaInteractionLookback: Number(e.target.value) })}
                  className="w-12 px-1.5 py-1 text-xs border rounded text-center"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Regimes / Results main pane */}
        <div className="flex-1 overflow-y-auto p-6 max-w-4xl">
        {/* Current market state */}
        <div className="mb-3 p-2 rounded-lg bg-gray-50 border border-gray-200">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-gray-500 font-medium uppercase tracking-wide">Current Market State</span>
            <span className="text-[10px] text-gray-400">live</span>
          </div>
          <div className="flex gap-3 mt-1">
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-gray-500">LT:</span>
              <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${REGIME_META[marketState.regime].bg} ${REGIME_META[marketState.regime].color}`}>
                {marketState.ltMarket}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-gray-500">HT:</span>
              <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                marketState.htMarket === 'Bull-Trend' ? 'bg-green-50 text-green-700' :
                marketState.htMarket === 'Bear-Trend' ? 'bg-red-50 text-red-700' :
                'bg-gray-100 text-gray-600'
              }`}>
                {marketState.htMarket}
              </span>
            </div>
            <div className="ml-auto flex items-center gap-1">
              <span className="text-[10px] text-gray-500">Active rules:</span>
              {(() => {
                const rk = marketState.regime;
                const enabled = config[rk].enabled;
                return (
                  <span className={`text-[10px] font-bold ${enabled ? REGIME_META[rk].color : 'text-gray-400'}`}>
                    {enabled ? REGIME_LABELS[rk] : 'none'}
                  </span>
                );
              })()}
            </div>
          </div>
        </div>

        {/* Presets */}
        <div className="mb-3">
          <p className="text-[10px] text-gray-400 mb-1 uppercase tracking-wide font-medium">Quick Presets</p>
          <div className="flex gap-1.5">
            {Object.keys(AUTO_BT_PRESETS).map(name => (
              <button key={name} onClick={() => applyPreset(name)}
                className="flex-1 py-1 text-[10px] bg-indigo-50 text-indigo-700 border border-indigo-200 rounded hover:bg-indigo-100 font-medium">
                {name}
              </button>
            ))}
          </div>
        </div>

        {/* Regime tabs */}
        <div className="flex gap-1 mb-3">
          {regimes.map(r => {
            const meta = REGIME_META[r];
            const isActive = activeRegime === r;
            const isCurrentMarket = marketState.regime === r;
            return (
              <button
                key={r}
                onClick={() => setActiveRegime(r)}
                className={`flex-1 flex flex-col items-center gap-0.5 py-1.5 rounded border text-[10px] font-medium transition-colors relative ${
                  isActive
                    ? `${meta.activeBg} text-white border-transparent`
                    : `${meta.bg} ${meta.color} ${meta.border} hover:brightness-95`
                }`}
              >
                {meta.icon}
                <span>{REGIME_LABELS[r]}</span>
                {isCurrentMarket && (
                  <div className={`absolute -top-1 -right-1 w-2 h-2 rounded-full border border-white ${isActive ? 'bg-white' : meta.activeBg}`} title="Current market" />
                )}
                {config[r].enabled && (
                  <div className={`absolute bottom-0.5 right-1 w-1 h-1 rounded-full ${isActive ? 'bg-white/70' : meta.activeBg}`} />
                )}
              </button>
            );
          })}
        </div>

        {/* Active regime editor */}
        <div className={`p-3 rounded-lg border-2 ${REGIME_META[activeRegime].bg} ${REGIME_META[activeRegime].border}`}>
          <div className="flex items-center gap-1 mb-2 pb-1.5 border-b border-current/20">
            <span className={REGIME_META[activeRegime].color}>{REGIME_META[activeRegime].icon}</span>
            <span className={`text-xs font-bold ${REGIME_META[activeRegime].color}`}>{REGIME_LABELS[activeRegime]} Rules</span>
            <span className={`text-[9px] ml-1 ${REGIME_META[activeRegime].color} opacity-60`}>
              {activeRegime === 'uptrend' ? '(Bull-Trend / Bull-Trending-range)' :
               activeRegime === 'downtrend' ? '(Bear-Trend / Bear-Trending-range)' :
               activeRegime === 'reversal' ? '(Bull-Reversal / Bear-Reversal)' : '(Range)'}
            </span>
          </div>
          <RegimeEditor
            regime={activeRegime}
            rules={config[activeRegime]}
            onChange={updateRegime(activeRegime)}
            candles={candles}
            currentIndex={currentIndex}
            config={config}
          />
        </div>

        {/* Status bar */}
        <div className={`mt-3 rounded p-2 text-[11px] ${config.enabled ? 'bg-indigo-50 border border-indigo-200' : 'bg-gray-50 border border-gray-200'}`}>
          <span className="font-medium text-gray-600">Last signal: </span>
          {config.enabled ? (
            position ? (
              <span className="text-orange-600">Position open — waiting for exit</span>
            ) : lastSignalReason ? (
              <span className="text-indigo-700 break-all">{lastSignalReason}</span>
            ) : (
              <span className="text-gray-400">No signal yet — press Play to run</span>
            )
          ) : (
            <span className="text-gray-400">Enable to start scanning</span>
          )}
        </div>

        {/* Batch run — processes all candles instantly without visual playback */}
        <div className="mt-2">
          <button
            onClick={runBatchAutoBacktest}
            disabled={isBatchRunning || candles.length === 0 || !config.enabled}
            className="w-full py-2 px-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold rounded-lg flex items-center justify-center gap-2 transition-colors"
          >
            {isBatchRunning ? (
              <>
                <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                Running...
              </>
            ) : (
              <>
                <Zap size={13} />
                Run Full Backtest (instant)
              </>
            )}
          </button>

          {isBatchRunning && (
            <div className="mt-2">
              <div className="flex justify-between text-[10px] text-gray-500 mb-1">
                <span>Processing candles…</span>
                <span>{batchProgress}%</span>
              </div>
              <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-indigo-500 rounded-full transition-all duration-150"
                  style={{ width: `${batchProgress}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Entry Metrics Dashboard — shown when batch trades with journal data exist */}
        {trades.some(t => t.journal?.ltMarket) && (
          <div className="mt-2 border border-indigo-100 rounded-lg overflow-hidden">
            <button
              onClick={() => setShowMetrics(v => !v)}
              className="w-full flex items-center justify-between px-3 py-2 bg-indigo-50 hover:bg-indigo-100 text-[11px] font-semibold text-indigo-700 transition-colors"
            >
              <span className="flex items-center gap-1.5">
                <BarChart2 size={12} />
                Entry Position Metrics
              </span>
              <span className="text-[10px] text-indigo-400">{showMetrics ? '▲' : '▼'}</span>
            </button>
            {showMetrics && (
              <div className="px-3 pb-3">
                <EntryMetricsDashboard trades={trades} />
              </div>
            )}
          </div>
        )}
        </div>
      </div>
    </div>,
    document.body
  );
}
