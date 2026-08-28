import type { ReactNode } from 'react';
import { TrendingUp, TrendingDown, Minus, RefreshCw, Settings2 } from 'lucide-react';
import { type RegimeRules, type AutoBacktestConfig, generateBinaryPatterns } from '../../utils/autoBacktestEngine';
import type { FilterPreviewBar, PreviewFilterKey } from '../../hooks/useFilterPreviewData';
import { CardShell } from './CardShell';
import { SegmentedControl } from './SegmentedControl';
import { ToggleSwitch } from './ToggleSwitch';
import { ModePickerControl } from './ModePickerControl';
import { ThresholdFilterControl } from './ThresholdFilterControl';
import { BarRangeFilterControl } from './BarRangeFilterControl';
import { PivotSequencePatternPicker } from './PivotSequencePatternPicker';
import { BarOverlapDiagram } from './BarOverlapDiagram';
import { BreakCountDiagram } from './BreakCountDiagram';
import { EmaSlopeDiagram } from './EmaSlopeDiagram';
import { EmaInteractionDiagram } from './EmaInteractionDiagram';
import { EfficiencyRatioDiagram } from './EfficiencyRatioDiagram';
import { MaPositionDiagram } from './MaPositionDiagram';
import { PivotSeqDiagram } from './PivotSeqDiagram';
import { AtrDepthDiagram } from './AtrDepthDiagram';
import { PivotGapDiagram } from './PivotGapDiagram';

const HIGH_SEQ_PATTERNS = generateBinaryPatterns('HH', 'LH');
const LOW_SEQ_PATTERNS = generateBinaryPatterns('HL', 'LL');

export type WorkflowStep = 'market' | 'entry' | 'confirmation' | 'pattern' | 'exit' | 'risk';

export interface StepDef {
  key: WorkflowStep;
  label: string;
  icon: ReactNode;
  /** Small live count badge, e.g. active-confirmation-filter count. */
  badge?: string | number;
}

export interface RegimeMeta {
  icon: ReactNode;
  color: string;
  bg: string;
  border: string;
  activeBg: string;
}

// Starting-point recommendations, not fixed rules — tune per instrument/timeframe against
// your own batch-backtest results. Trend rows apply to both Uptrend and Downtrend (the
// direction-aligned filters flip automatically for shorts, so the same setting works for both).
export const QUALITY_FILTER_GUIDE: { filter: string; trend: string; range: string; reversal: string }[] = [
  { filter: 'Bar Overlap', trend: '≤0.4 (Clean/Trend)', range: '≥0.5 (Choppy) or None', reversal: 'None — structure still forming' },
  { filter: 'Bar Range', trend: 'Dominance ≥1.0×', range: 'None', reversal: 'Dominance ≥1.0× once turn confirms' },
  { filter: 'Break Count', trend: '≥5 (Persistent)', range: '≤3 (Exhausted/quiet)', reversal: 'None' },
  { filter: 'Consecutive Breaks', trend: '≥4 (strong impulse leg)', range: 'None', reversal: 'None' },
  { filter: 'EMA21 Slope', trend: '≥0 (Favor Trade)', range: '≤0.1 (Flat) or None', reversal: 'None — slope hasn’t turned yet' },
  { filter: 'EMA50 Slope', trend: '≥0 (Favor Trade)', range: '≤0.1 (Flat) or None', reversal: 'None' },
  { filter: 'EMA20 Gap-Bar', trend: '≥0.4 (continuation) or ≤0.3 (pullback entries)', range: '≤0.3 (still touching)', reversal: '≤0.3 (still touching)' },
  { filter: 'EMA20 Bias', trend: '≥0.6 (Sustained)', range: 'None', reversal: '≥0.5 (early confirm)' },
];

export interface RegimeStepProps {
  rules: RegimeRules;
  up: (patch: Partial<RegimeRules>) => void;
  meta: RegimeMeta;
  latestBar: FilterPreviewBar | undefined;
  isShort: boolean;
  isBoth: boolean;
  onHoverFilterKey: (key: PreviewFilterKey | null) => void;
  showGuide: boolean;
  setShowGuide: (updater: boolean | ((v: boolean) => boolean)) => void;
  config: AutoBacktestConfig;
  onOpenSessionSettings: () => void;
}

// Shared diagram for the 5-option structure filters (HT/LT) below.
function structureDiagram(m: 'any' | 'bull_trend' | 'bear_trend' | 'range' | 'reversal') {
  if (m === 'any') return null;
  if (m === 'bull_trend') return <TrendingUp size={22} className="text-green-600" />;
  if (m === 'bear_trend') return <TrendingDown size={22} className="text-red-600" />;
  if (m === 'range') return <Minus size={22} className="text-gray-500" />;
  return <RefreshCw size={22} className="text-amber-600" />;
}

// ─── Market ─────────────────────────────────────────────────────────────────
// Regime enable/direction + Higher-Timeframe structure gate — "what market condition am I trading."
export function MarketStep({ rules, up, meta }: RegimeStepProps) {
  const isShort = rules.direction === 'SHORT_ONLY';

  return (
    <div className="space-y-3">
      <CardShell>
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <ToggleSwitch checked={rules.enabled} onChange={v => up({ enabled: v })} activeColor={meta.activeBg} />
            <span className={`text-xs font-semibold ${rules.enabled ? meta.color : 'text-gray-400'}`}>
              {rules.enabled ? 'Active' : 'Disabled'}
            </span>
          </label>

          <SegmentedControl
            fullWidth={false}
            value={rules.direction}
            onChange={d => up({ direction: d })}
            options={[
              { value: 'LONG_ONLY' as const, label: 'Long', activeClassName: 'bg-green-600 text-white border-green-600' },
              { value: 'SHORT_ONLY' as const, label: 'Short', activeClassName: 'bg-red-600 text-white border-red-600' },
              { value: 'BOTH' as const, label: 'Both', activeClassName: 'bg-purple-600 text-white border-purple-600' },
            ]}
          />
        </div>
      </CardShell>

      <ModePickerControl
        label="HT Structure"
        tooltip="Higher-timeframe structure gate. Note: this is actually an EMA60 slope computed on the same base-timeframe candles, not a true resampled higher-timeframe read — treat it as a longer-term trend confirmation, not independent multi-timeframe confluence."
        mode={rules.htStructureFilter}
        offValue="any"
        gridCols={5}
        modeOptions={[
          { value: 'any', label: 'Any' },
          { value: 'bull_trend', label: 'Bull Trend' },
          { value: 'bear_trend', label: 'Bear Trend' },
          { value: 'range', label: 'Range' },
          { value: 'reversal', label: 'Reversal' },
        ]}
        onModeChange={v => up({ htStructureFilter: v as RegimeRules['htStructureFilter'] })}
        diagram={structureDiagram}
      />

      <ModePickerControl
        label="LT Structure"
        tooltip="Lower-timeframe structure gate — the same ltMarket read used to pick which regime's rules try first (Market/Entry/Confirmation tabs). This filter enforces it as a hard requirement instead of just an ordering preference, so this rule-set won't fire on a bar whose own structure doesn't actually match."
        mode={rules.ltStructureFilter ?? 'any'}
        offValue="any"
        gridCols={5}
        modeOptions={[
          { value: 'any', label: 'Any' },
          { value: 'bull_trend', label: 'Bull Trend' },
          { value: 'bear_trend', label: 'Bear Trend' },
          { value: 'range', label: 'Range' },
          { value: 'reversal', label: 'Reversal' },
        ]}
        onModeChange={v => up({ ltStructureFilter: v as RegimeRules['ltStructureFilter'] })}
        diagram={structureDiagram}
      />
      {isShort && <p className="text-[10px] text-gray-400">Direction is Short — filter labels elsewhere flip automatically to match.</p>}
    </div>
  );
}

// ─── Entry ──────────────────────────────────────────────────────────────────
// How and where a signal fires: entry mode, H/L signal toggles, MA position, single most-recent pivot sequence.
export function EntryStep({ rules, up, isShort, isBoth }: RegimeStepProps) {
  return (
    <div className="space-y-3">
      <CardShell title="Entry Signal">
        <SegmentedControl
          value={rules.entryMode}
          onChange={m => up({ entryMode: m })}
          options={[
            { value: 'PIVOT' as const, label: 'Pivot' },
            { value: 'H_SIGNAL' as const, label: 'H/L Signal' },
            { value: 'CONFLUENCE' as const, label: 'Confluence' },
          ]}
          className="mb-2"
        />

        <div className="flex gap-3 items-center">
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
      </CardShell>

      <div className="grid grid-cols-1 @3xl:grid-cols-2 gap-2">
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
    </div>
  );
}

// ─── Confirmation ───────────────────────────────────────────────────────────
// Optional additional gates layered on top of a valid entry signal.
export function ConfirmationStep({ rules, up, latestBar, onHoverFilterKey, showGuide, setShowGuide }: RegimeStepProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p
          className="text-[10px] text-gray-400 uppercase tracking-wide font-medium cursor-help"
          title="Reject a signal outright unless its market-structure condition holds — not just recorded on the trade, but checked before entry. Directional filters (Break Count, EMA Slope, EMA20 Bias) automatically flip to match whichever side (long/short) is being evaluated, so one setting covers both directions."
        >
          Quality Setup Filters
        </p>
        <button
          onClick={() => setShowGuide(v => !v)}
          className="text-[10px] text-indigo-500 hover:text-indigo-700 font-medium flex items-center gap-0.5 transition-colors"
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

      <div className="grid grid-cols-1 @3xl:grid-cols-2 @6xl:grid-cols-3 gap-2">
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
          onHoverChange={hovering => onHoverFilterKey(hovering ? 'atrDepth' : null)}
          diagram={<AtrDepthDiagram atrMultiple={rules.atrDepthThreshold ?? 1.5} />}
        />

        <ThresholdFilterControl
          label="Efficiency Ratio"
          tooltip="How directly price traveled from A to B over the 'Efficiency' lookback (Kaufman Efficiency Ratio). Near 1 = a straight, efficient trend; near 0 = price zigzagged and cancelled itself out (chop). For H/L-signal entry modes the window ends at the frozen impulse-leg high/low before the pullback (H1/H2 of the same pullback grade the same window); in Pivot mode it ends at the entry bar."
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
          onHoverChange={hovering => onHoverFilterKey(hovering ? 'efficiencyRatio' : null)}
          diagram={<EfficiencyRatioDiagram ratio={rules.efficiencyRatioThreshold ?? 0.3} />}
        />

        <ThresholdFilterControl
          label="Bar Overlap"
          tooltip="How much each bar's range overlaps the previous bar's range, averaged over the 'Overlap' lookback (Instrumentation Lookbacks in Session Settings). Low overlap = clean directional bars; high overlap = choppy/ranging. For H/L-signal entry modes the window ends at the frozen impulse-leg extreme before the pullback; in Pivot mode it ends at the entry bar."
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
          onHoverChange={hovering => onHoverFilterKey(hovering ? 'barOverlap' : null)}
          diagram={<BarOverlapDiagram ratio={rules.barOverlapThreshold ?? 0.4} />}
        />

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
          onHoverChange={hovering => onHoverFilterKey(hovering ? 'barRange' : null)}
        />

        <ThresholdFilterControl
          label="Break Count"
          tooltip="Counts, over the 'Breaks' lookback, how many bars made a new high (for longs) or new low (for shorts) vs. the bar before it — a momentum/persistence check. Persistent requires at least X breaks (momentum still active). Exhausted requires at most X (momentum fading — useful for reversal/fade entries). For H/L-signal entry modes the window ends at the frozen impulse-leg extreme; in Pivot mode it ends at the entry bar."
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
          onHoverChange={hovering => onHoverFilterKey(hovering ? 'barBreak' : null)}
          diagram={<BreakCountDiagram count={rules.barBreakThreshold ?? 5} />}
        />

        <ThresholdFilterControl
          label="Consecutive Breaks"
          tooltip="Longest run of consecutive bars that each broke the prior bar's high without breaking its low (flipped to low-breaks for shorts) — the Brooks impulse micro-channel test, searched over the 'Consecutive' lookback (Session Settings). Unlike Break Count (total breaks, possibly scattered), this demands an unbroken streak, e.g. a 4-bar breakout. Streak Required needs a run of at least X; Streak Capped fades moves whose best run stays at or under X. For H/L-signal entry modes the window ends at the frozen impulse-leg extreme; in Pivot mode it ends at the entry bar."
          mode={rules.consecutiveBreakFilter ?? 'none'}
          offValue="none"
          modeOptions={[
            { value: 'none', label: 'Off' },
            { value: 'min', label: 'Streak Required' },
            { value: 'max', label: 'Streak Capped' },
          ]}
          onModeChange={v => up({ consecutiveBreakFilter: v as RegimeRules['consecutiveBreakFilter'] })}
          threshold={rules.consecutiveBreakThreshold ?? 4}
          onThresholdChange={v => up({ consecutiveBreakThreshold: v })}
          min={2}
          max={10}
          step={1}
          liveValue={rules.direction !== 'SHORT_ONLY' ? latestBar?.metrics.maxConsecutiveHighBreaks : latestBar?.metrics.maxConsecutiveLowBreaks}
          formatValue={v => v.toFixed(0)}
          onHoverChange={hovering => onHoverFilterKey(hovering ? 'consecutiveBreak' : null)}
          diagram={<BreakCountDiagram count={rules.consecutiveBreakThreshold ?? 4} />}
        />

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
          onHoverChange={hovering => onHoverFilterKey(hovering ? 'ema21Slope' : null)}
          diagram={<EmaSlopeDiagram slope={rules.ema21SlopeThreshold ?? 0} min={-2} max={2} />}
        />

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
          onHoverChange={hovering => onHoverFilterKey(hovering ? 'ema50Slope' : null)}
          diagram={<EmaSlopeDiagram slope={rules.ema50SlopeThreshold ?? 0} min={-2} max={2} />}
        />

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
          onHoverChange={hovering => onHoverFilterKey(hovering ? 'ema20GapBar' : null)}
          diagram={<EmaInteractionDiagram ratio={rules.ema20GapBarThreshold ?? 0.5} mode="gapBar" />}
        />

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
          onHoverChange={hovering => onHoverFilterKey(hovering ? 'ema20Bias' : null)}
          diagram={<EmaInteractionDiagram ratio={rules.ema20BiasThreshold ?? 0.5} mode="bias" />}
        />
      </div>

      <p className="text-[10px] text-gray-400 mt-2 mb-1 uppercase tracking-wide font-medium">Pivot Sequence History (last 4)</p>
      <div className="grid grid-cols-1 @3xl:grid-cols-2 gap-2">
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
          onHoverChange={hovering => onHoverFilterKey(hovering ? 'highSeq' : null)}
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
          onHoverChange={hovering => onHoverFilterKey(hovering ? 'lowSeq' : null)}
        />

        <div className="@3xl:col-span-2">
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
            onHoverChange={hovering => onHoverFilterKey(hovering ? 'pivotGap' : null)}
            diagram={<PivotGapDiagram gapBars={rules.pivotGapThreshold ?? 5} />}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Exit ───────────────────────────────────────────────────────────────────
// Target RR, the four price-action exit mechanisms (auto-entered positions only,
// managed by the ENTRY regime's rules for the trade's whole life), and a
// read-only shortcut into the session-wide square-off/fill-mode settings.
export function ExitStep({ rules, up, meta, isShort, config, onOpenSessionSettings }: RegimeStepProps) {
  const opp1 = isShort ? 'H1' : 'L1';
  const opp2 = isShort ? 'H2' : 'L2';
  return (
    <div className="space-y-3">
      <CardShell title="Target Risk:Reward">
        <div className="flex items-center gap-2">
          <input
            type="number" step={0.5} min={0.5} max={10} value={rules.targetRR}
            onChange={e => up({ targetRR: Number(e.target.value) })}
            className="w-20 px-2 py-1.5 text-sm border rounded-lg text-center font-semibold text-indigo-700"
          />
          <span className="text-sm text-gray-400">× risk</span>
        </div>
      </CardShell>

      <p
        className="text-[10px] text-gray-400 uppercase tracking-wide font-medium cursor-help"
        title="Brooks-style trade management for auto-entered positions: exit when the market turns against the trade, trail while it stays strong. Signal exits fill at the bar's close; the trailing stop exits through the normal SL machinery. Manual trades are never touched."
      >
        Price-Action Exit Engine
      </p>

      <CardShell title="Reversal Exit">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <label className="flex items-center gap-2 cursor-pointer select-none"
            title="Exits when the LT market structure (same read as the Trend Reversal flag) turns against the position for N consecutive bars. Fills at bar close, exit reason REVERSAL.">
            <ToggleSwitch checked={rules.exitOnReversal ?? false} onChange={v => up({ exitOnReversal: v })} activeColor={meta.activeBg} />
            <span className={`text-xs font-semibold ${rules.exitOnReversal ? meta.color : 'text-gray-400'}`}>
              {rules.exitOnReversal ? 'On' : 'Off'}
            </span>
          </label>
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-gray-500">Confirm bars:</span>
            <input
              type="number" min={1} max={10} value={rules.exitReversalConfirmBars ?? 1}
              onChange={e => up({ exitReversalConfirmBars: Number(e.target.value) })}
              className="w-10 px-1 py-0.5 text-[10px] border rounded text-center"
            />
          </div>
          <label className="flex items-center gap-1 cursor-pointer"
            title="Only arm the exit after the structure has read WITH the trade at least once. Turn off for counter-trend regimes (range/reversal), which may never see a with-trend read.">
            <input
              type="checkbox" checked={rules.exitReversalRequireWithTrend ?? true}
              onChange={e => up({ exitReversalRequireWithTrend: e.target.checked })}
              className="w-3 h-3"
            />
            <span className="text-[10px] text-gray-500">Require with-trend first</span>
          </label>
        </div>
      </CardShell>

      <CardShell title="Opposite Signal Exit">
        <div className="flex items-center gap-3 flex-wrap">
          <label className="flex items-center gap-2 cursor-pointer select-none"
            title={`Exits when an opposite Brooks pullback signal fires against the position (${opp1}/${opp2} — 3rd+ signals never count). Fills at bar close, exit reason OPP_SIGNAL.`}>
            <ToggleSwitch checked={rules.exitOnOppSignal ?? false} onChange={v => up({ exitOnOppSignal: v })} activeColor={meta.activeBg} />
            <span className={`text-xs font-semibold ${rules.exitOnOppSignal ? meta.color : 'text-gray-400'}`}>
              {rules.exitOnOppSignal ? 'On' : 'Off'}
            </span>
          </label>
          <label className="flex items-center gap-1 cursor-pointer">
            <input
              type="checkbox" checked={rules.exitOppAllow1 ?? false}
              onChange={e => up({ exitOppAllow1: e.target.checked })}
              className="w-3 h-3"
            />
            <span className={`text-xs font-bold ${isShort ? 'text-green-700' : 'text-red-700'}`}>1st ({opp1})</span>
          </label>
          <label className="flex items-center gap-1 cursor-pointer">
            <input
              type="checkbox" checked={rules.exitOppAllow2 ?? true}
              onChange={e => up({ exitOppAllow2: e.target.checked })}
              className="w-3 h-3"
            />
            <span className={`text-xs font-bold ${isShort ? 'text-green-700' : 'text-red-700'}`}>2nd ({opp2})</span>
          </label>
        </div>
      </CardShell>

      <CardShell title="Pivot Trailing Stop">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <label className="flex items-center gap-2 cursor-pointer select-none"
            title="Ratchets the SL behind the swing extreme of the most recent confirmed same-side pivot (never loosens; pivots confirmed through the prior bar only). Exits through the normal SL machinery, trade marked 'trailed'.">
            <ToggleSwitch checked={rules.exitTrailPivot ?? false} onChange={v => up({ exitTrailPivot: v })} activeColor={meta.activeBg} />
            <span className={`text-xs font-semibold ${rules.exitTrailPivot ? meta.color : 'text-gray-400'}`}>
              {rules.exitTrailPivot ? 'On' : 'Off'}
            </span>
          </label>
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-gray-500">Buffer pts:</span>
            <input
              type="number" min={0} step={0.5} value={rules.exitTrailPivotBufferPoints ?? 2}
              onChange={e => up({ exitTrailPivotBufferPoints: Number(e.target.value) })}
              className="w-12 px-1 py-0.5 text-[10px] border rounded text-center"
            />
          </div>
        </div>
      </CardShell>

      <CardShell title="Leg Decay Exit">
        <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
          <label className="flex items-center gap-2 cursor-pointer select-none"
            title="Re-grades the newest completed with-trend leg each bar with the same metrics as the Confirmation filters (only legs formed after entry; windows respect Leg Min/Max Bars in Session Settings). Exits at bar close when enough checks fail, exit reason LEG_DECAY.">
            <ToggleSwitch checked={rules.exitLegDecay ?? false} onChange={v => up({ exitLegDecay: v })} activeColor={meta.activeBg} />
            <span className={`text-xs font-semibold ${rules.exitLegDecay ? meta.color : 'text-gray-400'}`}>
              {rules.exitLegDecay ? 'On' : 'Off'}
            </span>
          </label>
          <div className="flex items-center gap-1" title="No decay exit before this many bars in the trade.">
            <span className="text-[10px] text-gray-500">Min bars in trade:</span>
            <input
              type="number" min={0} max={50} value={rules.exitLegDecayMinBarsInTrade ?? 3}
              onChange={e => up({ exitLegDecayMinBarsInTrade: Number(e.target.value) })}
              className="w-10 px-1 py-0.5 text-[10px] border rounded text-center"
            />
          </div>
          <div className="flex items-center gap-1" title="Exit when at least this many of the enabled checks below fail on the same bar.">
            <span className="text-[10px] text-gray-500">Min fails:</span>
            <input
              type="number" min={1} max={5} value={rules.exitLegDecayMinFails ?? 1}
              onChange={e => up({ exitLegDecayMinFails: Number(e.target.value) })}
              className="w-10 px-1 py-0.5 text-[10px] border rounded text-center"
            />
          </div>
        </div>
        <div className="grid grid-cols-1 @3xl:grid-cols-2 @6xl:grid-cols-3 gap-2">
          <ThresholdFilterControl
            label="Efficiency Ratio"
            tooltip="Kaufman ER of the current with-trend leg. 'Hold ≥' fails the check when the leg's efficiency drops below the threshold (trend losing directness)."
            mode={rules.exitDecayEfficiencyFilter ?? 'none'}
            offValue="none"
            modeOptions={[
              { value: 'none', label: 'Off' },
              { value: 'min', label: 'Hold ≥' },
              { value: 'max', label: 'Stay ≤' },
            ]}
            onModeChange={v => up({ exitDecayEfficiencyFilter: v as RegimeRules['exitDecayEfficiencyFilter'] })}
            threshold={rules.exitDecayEfficiencyThreshold ?? 0.25}
            onThresholdChange={v => up({ exitDecayEfficiencyThreshold: v })}
            diagram={null}
            min={0} max={1} step={0.05}
          />
          <ThresholdFilterControl
            label="Consecutive Breaks"
            tooltip="Longest run of aligned prior-bar breaks in the current leg (micro-channel strength). 'Hold ≥' fails when the newest leg can no longer sustain a run of that length."
            mode={rules.exitDecayConsecBreakFilter ?? 'none'}
            offValue="none"
            modeOptions={[
              { value: 'none', label: 'Off' },
              { value: 'min', label: 'Hold ≥' },
              { value: 'max', label: 'Stay ≤' },
            ]}
            onModeChange={v => up({ exitDecayConsecBreakFilter: v as RegimeRules['exitDecayConsecBreakFilter'] })}
            threshold={rules.exitDecayConsecBreakThreshold ?? 3}
            onThresholdChange={v => up({ exitDecayConsecBreakThreshold: v })}
            diagram={null}
            min={1} max={10} step={1}
          />
          <ThresholdFilterControl
            label="Break Count"
            tooltip="Total aligned prior-bar breaks in the current leg window (momentum persistence). 'Hold ≥' fails when momentum dries up."
            mode={rules.exitDecayBarBreakFilter ?? 'none'}
            offValue="none"
            modeOptions={[
              { value: 'none', label: 'Off' },
              { value: 'min', label: 'Hold ≥' },
              { value: 'max', label: 'Stay ≤' },
            ]}
            onModeChange={v => up({ exitDecayBarBreakFilter: v as RegimeRules['exitDecayBarBreakFilter'] })}
            threshold={rules.exitDecayBarBreakThreshold ?? 4}
            onThresholdChange={v => up({ exitDecayBarBreakThreshold: v })}
            diagram={null}
            min={0} max={20} step={1}
          />
          <ThresholdFilterControl
            label="EMA21 Slope"
            tooltip="Direction-aligned EMA21 slope (flips automatically for shorts). 'Hold ≥' fails when the slope turns against the trade."
            mode={rules.exitDecayEma21SlopeFilter ?? 'none'}
            offValue="none"
            modeOptions={[
              { value: 'none', label: 'Off' },
              { value: 'min', label: 'Hold ≥' },
              { value: 'max', label: 'Stay ≤' },
            ]}
            onModeChange={v => up({ exitDecayEma21SlopeFilter: v as RegimeRules['exitDecayEma21SlopeFilter'] })}
            threshold={rules.exitDecayEma21SlopeThreshold ?? 0}
            onThresholdChange={v => up({ exitDecayEma21SlopeThreshold: v })}
            diagram={null}
            min={-2} max={2} step={0.05}
            formatValue={v => v.toFixed(2)}
          />
          <ThresholdFilterControl
            label="EMA20 Gap-Bar"
            tooltip="Fraction of leg bars not touching the EMA20 (Brooks gap bars — strong trend). 'Hold ≥' fails when price starts hugging the average again."
            mode={rules.exitDecayGapBarFilter ?? 'none'}
            offValue="none"
            modeOptions={[
              { value: 'none', label: 'Off' },
              { value: 'min', label: 'Hold ≥' },
              { value: 'max', label: 'Stay ≤' },
            ]}
            onModeChange={v => up({ exitDecayGapBarFilter: v as RegimeRules['exitDecayGapBarFilter'] })}
            threshold={rules.exitDecayGapBarThreshold ?? 0.3}
            onThresholdChange={v => up({ exitDecayGapBarThreshold: v })}
            diagram={null}
            min={0} max={1} step={0.05}
          />
        </div>
      </CardShell>

      <CardShell muted>
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] text-gray-500">
            Session exit rules: auto square-off{' '}
            <span className="font-medium text-gray-600">{config.autoSquareOff ? `at ${config.squareOffTime} IST` : 'off'}</span> · fill{' '}
            <span className="font-medium text-gray-600">{config.slTpFillMode ?? 'exact'}</span>
          </p>
          <button
            onClick={onOpenSessionSettings}
            className="shrink-0 flex items-center gap-1 text-[10px] font-medium text-indigo-600 hover:text-indigo-800 transition-colors"
          >
            <Settings2 size={11} /> Edit
          </button>
        </div>
      </CardShell>
    </div>
  );
}

// ─── Risk ───────────────────────────────────────────────────────────────────
// SL method/amount + a read-only shortcut into session-wide position-sizing settings.
export function RiskStep({ rules, up, config, onOpenSessionSettings }: RegimeStepProps) {
  return (
    <div className="space-y-3">
      <CardShell title="Stop Loss">
        <div className="flex items-center gap-2 flex-wrap">
          <SegmentedControl
            fullWidth={false}
            value={rules.slMethod}
            onChange={m => up({ slMethod: m })}
            options={[
              { value: 'pivot' as const, label: 'Pivot SL', activeClassName: 'bg-orange-600 text-white border-orange-600' },
              { value: 'atr' as const, label: 'ATR SL', activeClassName: 'bg-orange-600 text-white border-orange-600' },
              { value: 'fixed' as const, label: 'Fixed SL', activeClassName: 'bg-orange-600 text-white border-orange-600' },
            ]}
          />
          {rules.slMethod === 'atr' && (
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-gray-500">×</span>
              <input type="number" step={0.1} min={0.5} max={5} value={rules.slAtrMultiplier}
                onChange={e => up({ slAtrMultiplier: Number(e.target.value) })}
                className="w-14 px-1.5 py-1 text-xs border rounded text-center" />
            </div>
          )}
          {rules.slMethod === 'fixed' && (
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-gray-500">pts</span>
              <input type="number" min={1} value={rules.slFixedPoints}
                onChange={e => up({ slFixedPoints: Number(e.target.value) })}
                className="w-16 px-1.5 py-1 text-xs border rounded text-center" />
            </div>
          )}
        </div>
      </CardShell>

      <CardShell muted>
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] text-gray-500">
            Position sizing:{' '}
            <span className="font-medium text-gray-600">
              {config.useAutoQty ? `Auto · ₹${config.riskPerTrade} risk` : 'Manual qty'}
            </span>
          </p>
          <button
            onClick={onOpenSessionSettings}
            className="shrink-0 flex items-center gap-1 text-[10px] font-medium text-indigo-600 hover:text-indigo-800 transition-colors"
          >
            <Settings2 size={11} /> Edit
          </button>
        </div>
      </CardShell>
    </div>
  );
}
