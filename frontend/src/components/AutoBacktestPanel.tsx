import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Zap, TrendingUp, TrendingDown, Minus, RefreshCw, BarChart2 } from 'lucide-react';
import { useSessionStore } from '../stores/sessionStore';
import { EntryMetricsDashboard } from './EntryMetricsDashboard';
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

function RegimeEditor({ regime, rules, onChange }: RegimeEditorProps) {
  const meta = REGIME_META[regime];
  const up = (patch: Partial<RegimeRules>) => onChange({ ...rules, ...patch });
  const [showGuide, setShowGuide] = useState(false);

  return (
    <div className="space-y-3 pt-1">
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
        <div>
          <p className="text-[10px] text-gray-400 mb-0.5 uppercase tracking-wide font-medium">MA Filter</p>
          <select
            value={rules.maFilter}
            onChange={e => up({ maFilter: e.target.value as RegimeRules['maFilter'] })}
            className="w-full px-1.5 py-1 text-[11px] border rounded"
          >
            {(() => {
              const isShort = rules.direction === 'SHORT_ONLY';
              const isBoth  = rules.direction === 'BOTH';
              return (
                <>
                  <option value="none">None</option>
                  <option value="above_ema21">
                    {isBoth ? 'EMA 21 side' : isShort ? 'Below EMA 21' : 'Above EMA 21'}
                  </option>
                  <option value="on_or_above_ema21">
                    {isBoth ? 'EMA 21 touch' : isShort ? 'On / Below EMA 21' : 'On / Above EMA 21'}
                  </option>
                  <option value="above_ema60">
                    {isBoth ? 'EMA 60 side' : isShort ? 'Below EMA 60' : 'Above EMA 60'}
                  </option>
                </>
              );
            })()}
          </select>
        </div>
        <div>
          <p className="text-[10px] text-gray-400 mb-0.5 uppercase tracking-wide font-medium">Pivot Seq</p>
          <select
            value={rules.ltPivotSequence}
            onChange={e => up({ ltPivotSequence: e.target.value as RegimeRules['ltPivotSequence'] })}
            className="w-full px-1.5 py-1 text-[11px] border rounded"
          >
            <option value="any">Any</option>
            <option value="HH-HL">HH-HL (Bull)</option>
            <option value="LH-HL">LH-HL (Reversal)</option>
            <option value="HH-LL">HH-LL (Mixed)</option>
            <option value="LH-LL">LH-LL (Bear)</option>
          </select>
        </div>
        <div className="col-span-2">
          <p className="text-[10px] text-gray-400 mb-0.5 uppercase tracking-wide font-medium">HT Structure</p>
          <select
            value={rules.htStructureFilter}
            onChange={e => up({ htStructureFilter: e.target.value as RegimeRules['htStructureFilter'] })}
            className="w-full px-1.5 py-1 text-[11px] border rounded"
          >
            <option value="any">Any</option>
            <option value="bull_trend">Bull Trend (HT)</option>
            <option value="bear_trend">Bear Trend (HT)</option>
          </select>
        </div>
        <div>
          <p className="text-[10px] text-gray-400 mb-0.5 uppercase tracking-wide font-medium">ATR Depth</p>
          <select
            value={rules.atrDepthFilter ?? 'none'}
            onChange={e => up({ atrDepthFilter: e.target.value as RegimeRules['atrDepthFilter'] })}
            className="w-full px-1.5 py-1 text-[11px] border rounded"
          >
            <option value="none">None</option>
            <option value="max">≤ X ATR (Trend)</option>
            <option value="min">≥ X ATR (Gap/Range)</option>
          </select>
        </div>
        {(rules.atrDepthFilter ?? 'none') !== 'none' && (
          <div>
            <p className="text-[10px] text-gray-400 mb-0.5 uppercase tracking-wide font-medium">Threshold</p>
            <div className="flex items-center gap-1">
              <input
                type="number" step={0.25} min={0.25} max={10}
                value={rules.atrDepthThreshold ?? 1.5}
                onChange={e => up({ atrDepthThreshold: Number(e.target.value) })}
                className="w-full px-1.5 py-1 text-[11px] border rounded text-center"
              />
              <span className="text-[10px] text-gray-400 whitespace-nowrap">ATR</span>
            </div>
          </div>
        )}
        <div>
          <p className="text-[10px] text-gray-400 mb-0.5 uppercase tracking-wide font-medium">Efficiency Ratio</p>
          <select
            value={rules.efficiencyRatioFilter ?? 'none'}
            onChange={e => up({ efficiencyRatioFilter: e.target.value as RegimeRules['efficiencyRatioFilter'] })}
            className="w-full px-1.5 py-1 text-[11px] border rounded"
          >
            <option value="none">None</option>
            <option value="min">≥ X (Trending)</option>
            <option value="max">≤ X (Choppy)</option>
          </select>
        </div>
        {(rules.efficiencyRatioFilter ?? 'none') !== 'none' && (
          <div>
            <p className="text-[10px] text-gray-400 mb-0.5 uppercase tracking-wide font-medium">ER Threshold</p>
            <input
              type="number" step={0.05} min={0} max={1}
              value={rules.efficiencyRatioThreshold ?? 0.3}
              onChange={e => up({ efficiencyRatioThreshold: Number(e.target.value) })}
              className="w-full px-1.5 py-1 text-[11px] border rounded text-center"
            />
          </div>
        )}
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
          <div>
            <p
              className="text-[10px] text-gray-400 mb-0.5 uppercase tracking-wide font-medium cursor-help"
              title="How much each bar's range overlaps the previous bar's range, averaged over the 'Overlap' lookback (Instrumentation Lookbacks section above). Low overlap = clean directional bars; high overlap = choppy/ranging. 'Clean/Trend' requires overlap below the threshold (only enter clean trends); 'Choppy' requires it above (only enter range conditions)."
            >
              Bar Overlap
            </p>
            <select
              value={rules.barOverlapFilter ?? 'none'}
              onChange={e => up({ barOverlapFilter: e.target.value as RegimeRules['barOverlapFilter'] })}
              className="w-full px-1.5 py-1 text-[11px] border rounded"
            >
              <option value="none">None</option>
              <option value="max">≤ X (Clean/Trend)</option>
              <option value="min">≥ X (Choppy)</option>
            </select>
          </div>
          {(rules.barOverlapFilter ?? 'none') !== 'none' && (
            <div>
              <p
                className="text-[10px] text-gray-400 mb-0.5 uppercase tracking-wide font-medium cursor-help"
                title="Overlap ratio cutoff, 0–1. Lower = stricter (only very clean, non-overlapping bars pass). Default 0.4."
              >
                Overlap Threshold
              </p>
              <input
                type="number" step={0.05} min={0} max={1}
                value={rules.barOverlapThreshold ?? 0.4}
                onChange={e => up({ barOverlapThreshold: Number(e.target.value) })}
                className="w-full px-1.5 py-1 text-[11px] border rounded text-center"
              />
            </div>
          )}

          <div>
            <p
              className="text-[10px] text-gray-400 mb-0.5 uppercase tracking-wide font-medium cursor-help"
              title="Average candle size (high-low) over the 'Bar Range' lookback. 'Bull > Bear × X' (dominance) requires bars in your trade's direction to be bigger than bars against it, by the multiplier below — confirms the trend is expanding in your favor. The 'Avg Range' min/max modes instead require the overall average bar size to clear (min) or stay under (max) a fixed points threshold — useful to avoid low-volatility chop or overextended expansion regardless of direction."
            >
              Bar Range
            </p>
            <select
              value={rules.barRangeFilter ?? 'none'}
              onChange={e => up({ barRangeFilter: e.target.value as RegimeRules['barRangeFilter'] })}
              className="w-full px-1.5 py-1 text-[11px] border rounded"
            >
              <option value="none">None</option>
              <option value="dominance">Bull &gt; Bear × X (Direction)</option>
              <option value="min">≥ X pts (Avg Range)</option>
              <option value="max">≤ X pts (Avg Range)</option>
            </select>
          </div>
          {rules.barRangeFilter === 'dominance' && (
            <div>
              <p
                className="text-[10px] text-gray-400 mb-0.5 uppercase tracking-wide font-medium cursor-help"
                title="How many times bigger the trade-direction average bar range must be vs. the opposite side. 1 = just bigger, 1.5 = 50% bigger. Default 1.0."
              >
                Dominance ×
              </p>
              <input
                type="number" step={0.1} min={1} max={5}
                value={rules.barRangeDominanceThreshold ?? 1.0}
                onChange={e => up({ barRangeDominanceThreshold: Number(e.target.value) })}
                className="w-full px-1.5 py-1 text-[11px] border rounded text-center"
              />
            </div>
          )}
          {(rules.barRangeFilter === 'min' || rules.barRangeFilter === 'max') && (
            <div>
              <p
                className="text-[10px] text-gray-400 mb-0.5 uppercase tracking-wide font-medium cursor-help"
                title="Average bar size cutoff in price points (instrument-specific — set relative to this instrument's typical candle range)."
              >
                Range Threshold (pts)
              </p>
              <input
                type="number" step={1} min={0}
                value={rules.barRangeThreshold ?? 0}
                onChange={e => up({ barRangeThreshold: Number(e.target.value) })}
                className="w-full px-1.5 py-1 text-[11px] border rounded text-center"
              />
            </div>
          )}

          <div>
            <p
              className="text-[10px] text-gray-400 mb-0.5 uppercase tracking-wide font-medium cursor-help"
              title="Counts, over the 'Breaks' lookback, how many bars made a new high (for longs) or new low (for shorts) vs. the bar before it — a momentum/persistence check. 'Persistent' requires at least X breaks (momentum still active). 'Exhausted' requires at most X (momentum fading — useful for reversal/fade entries)."
            >
              Break Count
            </p>
            <select
              value={rules.barBreakFilter ?? 'none'}
              onChange={e => up({ barBreakFilter: e.target.value as RegimeRules['barBreakFilter'] })}
              className="w-full px-1.5 py-1 text-[11px] border rounded"
            >
              <option value="none">None</option>
              <option value="min">≥ X (Persistent)</option>
              <option value="max">≤ X (Exhausted)</option>
            </select>
          </div>
          {(rules.barBreakFilter ?? 'none') !== 'none' && (
            <div>
              <p
                className="text-[10px] text-gray-400 mb-0.5 uppercase tracking-wide font-medium cursor-help"
                title="Number of new-high/new-low breaks required within the lookback window. Default 5."
              >
                Break Threshold
              </p>
              <input
                type="number" step={1} min={0}
                value={rules.barBreakThreshold ?? 5}
                onChange={e => up({ barBreakThreshold: Number(e.target.value) })}
                className="w-full px-1.5 py-1 text-[11px] border rounded text-center"
              />
            </div>
          )}

          <div>
            <p
              className="text-[10px] text-gray-400 mb-0.5 uppercase tracking-wide font-medium cursor-help"
              title="Rate of change (steepness) of the EMA21 over its own lookback, automatically flipped for shorts so this always means 'is the EMA sloping in my trade's favor.' 'Favor Trade' requires the slope to clear the threshold (0 = just needs to point the right way, no steepness required). 'Not Overextended' instead caps how steep it can be — avoids chasing a move that's already run too far."
            >
              EMA21 Slope
            </p>
            <select
              value={rules.ema21SlopeFilter ?? 'none'}
              onChange={e => up({ ema21SlopeFilter: e.target.value as RegimeRules['ema21SlopeFilter'] })}
              className="w-full px-1.5 py-1 text-[11px] border rounded"
            >
              <option value="none">None</option>
              <option value="min">≥ X (Favor Trade)</option>
              <option value="max">≤ X (Not Overextended)</option>
            </select>
          </div>
          {(rules.ema21SlopeFilter ?? 'none') !== 'none' && (
            <div>
              <p
                className="text-[10px] text-gray-400 mb-0.5 uppercase tracking-wide font-medium cursor-help"
                title="Slope cutoff in price points per bar, already direction-aligned. 0 (default) = direction-only, no steepness required. Raw price-points, so this is instrument/timeframe-scale-dependent — a value tuned for Nifty 5-min won't transfer directly to Bank Nifty or a different timeframe."
              >
                EMA21 Threshold
              </p>
              <input
                type="number" step={0.05} value={rules.ema21SlopeThreshold ?? 0}
                onChange={e => up({ ema21SlopeThreshold: Number(e.target.value) })}
                className="w-full px-1.5 py-1 text-[11px] border rounded text-center"
              />
            </div>
          )}

          <div>
            <p
              className="text-[10px] text-gray-400 mb-0.5 uppercase tracking-wide font-medium cursor-help"
              title="Same as EMA21 Slope above, but on the slower EMA50 — a longer-term trend-direction confirmation rather than short-term steepness."
            >
              EMA50 Slope
            </p>
            <select
              value={rules.ema50SlopeFilter ?? 'none'}
              onChange={e => up({ ema50SlopeFilter: e.target.value as RegimeRules['ema50SlopeFilter'] })}
              className="w-full px-1.5 py-1 text-[11px] border rounded"
            >
              <option value="none">None</option>
              <option value="min">≥ X (Favor Trade)</option>
              <option value="max">≤ X (Not Overextended)</option>
            </select>
          </div>
          {(rules.ema50SlopeFilter ?? 'none') !== 'none' && (
            <div>
              <p
                className="text-[10px] text-gray-400 mb-0.5 uppercase tracking-wide font-medium cursor-help"
                title="Slope cutoff in price points per bar, already direction-aligned. 0 (default) = direction-only, no steepness required."
              >
                EMA50 Threshold
              </p>
              <input
                type="number" step={0.05} value={rules.ema50SlopeThreshold ?? 0}
                onChange={e => up({ ema50SlopeThreshold: Number(e.target.value) })}
                className="w-full px-1.5 py-1 text-[11px] border rounded text-center"
              />
            </div>
          )}

          <div>
            <p
              className="text-[10px] text-gray-400 mb-0.5 uppercase tracking-wide font-medium cursor-help"
              title="Fraction of bars over the 'EMA20 Interaction' lookback whose entire range never touches the EMA20 ('gap bars' — a Brooks strong-trend signal). 'Strong Trend' requires at least X of bars to be gap bars. 'Pullback/Touch' instead requires at most X, i.e. price is still interacting with the average — better suited to pullback/mean-reversion entries."
            >
              EMA20 Gap-Bar
            </p>
            <select
              value={rules.ema20GapBarFilter ?? 'none'}
              onChange={e => up({ ema20GapBarFilter: e.target.value as RegimeRules['ema20GapBarFilter'] })}
              className="w-full px-1.5 py-1 text-[11px] border rounded"
            >
              <option value="none">None</option>
              <option value="min">≥ X (Strong Trend)</option>
              <option value="max">≤ X (Pullback/Touch)</option>
            </select>
          </div>
          {(rules.ema20GapBarFilter ?? 'none') !== 'none' && (
            <div>
              <p
                className="text-[10px] text-gray-400 mb-0.5 uppercase tracking-wide font-medium cursor-help"
                title="Fraction of bars required to be gap bars, 0–1. Default 0.5."
              >
                Gap-Bar Threshold
              </p>
              <input
                type="number" step={0.05} min={0} max={1}
                value={rules.ema20GapBarThreshold ?? 0.5}
                onChange={e => up({ ema20GapBarThreshold: Number(e.target.value) })}
                className="w-full px-1.5 py-1 text-[11px] border rounded text-center"
              />
            </div>
          )}

          <div>
            <p
              className="text-[10px] text-gray-400 mb-0.5 uppercase tracking-wide font-medium cursor-help"
              title="Fraction of closes above the EMA20 over the same 'EMA20 Interaction' lookback ('always-in' bias), automatically flipped for shorts so this always means 'is price staying on my trade's side of the average.' 'Sustained Bias' requires at least X (bias holding steady). 'Weak Bias' requires at most X (choppier back-and-forth around the average)."
            >
              EMA20 Bias
            </p>
            <select
              value={rules.ema20BiasFilter ?? 'none'}
              onChange={e => up({ ema20BiasFilter: e.target.value as RegimeRules['ema20BiasFilter'] })}
              className="w-full px-1.5 py-1 text-[11px] border rounded"
            >
              <option value="none">None</option>
              <option value="min">≥ X (Sustained Bias)</option>
              <option value="max">≤ X (Weak Bias)</option>
            </select>
          </div>
          {(rules.ema20BiasFilter ?? 'none') !== 'none' && (
            <div>
              <p
                className="text-[10px] text-gray-400 mb-0.5 uppercase tracking-wide font-medium cursor-help"
                title="Fraction of closes required on the trade's side of the EMA20, 0–1. Default 0.5."
              >
                Bias Threshold
              </p>
              <input
                type="number" step={0.05} min={0} max={1}
                value={rules.ema20BiasThreshold ?? 0.5}
                onChange={e => up({ ema20BiasThreshold: Number(e.target.value) })}
                className="w-full px-1.5 py-1 text-[11px] border rounded text-center"
              />
            </div>
          )}
        </div>
      </div>

      {/* Pivot sequence history + inter-pivot distance */}
      <div>
        <p className="text-[10px] text-gray-400 mb-1 uppercase tracking-wide font-medium">
          Pivot Sequence History (last 4)
        </p>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <p
              className="text-[10px] text-gray-400 mb-0.5 uppercase tracking-wide font-medium cursor-help"
              title="Matches the last 4 bearish-pivot trend labels (swing highs: HH/LH), oldest to newest, against a whitelist of allowed 4-in-a-row patterns. With fewer than 4 pivots recorded yet, this filter passes through."
            >
              High Sequence
            </p>
            <select
              value={rules.highSeqFilter ?? 'none'}
              onChange={e => up({ highSeqFilter: e.target.value as RegimeRules['highSeqFilter'] })}
              className="w-full px-1.5 py-1 text-[11px] border rounded"
            >
              <option value="none">None</option>
              <option value="custom">Custom (pick patterns)</option>
            </select>
          </div>
          <div>
            <p
              className="text-[10px] text-gray-400 mb-0.5 uppercase tracking-wide font-medium cursor-help"
              title="Matches the last 4 bullish-pivot trend labels (swing lows: HL/LL), oldest to newest, against a whitelist of allowed 4-in-a-row patterns. With fewer than 4 pivots recorded yet, this filter passes through."
            >
              Low Sequence
            </p>
            <select
              value={rules.lowSeqFilter ?? 'none'}
              onChange={e => up({ lowSeqFilter: e.target.value as RegimeRules['lowSeqFilter'] })}
              className="w-full px-1.5 py-1 text-[11px] border rounded"
            >
              <option value="none">None</option>
              <option value="custom">Custom (pick patterns)</option>
            </select>
          </div>
          {(rules.highSeqFilter ?? 'none') === 'custom' && (
            <div className="col-span-2">
              <p className="text-[9px] text-gray-400 mb-1">Select allowed high-sequence patterns:</p>
              <div className="grid grid-cols-4 gap-1">
                {HIGH_SEQ_PATTERNS.map(p => {
                  const active = (rules.highSeqPatterns ?? []).includes(p);
                  return (
                    <button
                      key={p}
                      onClick={() => up({
                        highSeqPatterns: active
                          ? (rules.highSeqPatterns ?? []).filter(x => x !== p)
                          : [...(rules.highSeqPatterns ?? []), p],
                      })}
                      className={`px-1 py-0.5 text-[10px] rounded border font-medium ${active ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-gray-50 text-gray-500 border-gray-300 hover:bg-gray-100'}`}
                    >
                      {p}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {(rules.lowSeqFilter ?? 'none') === 'custom' && (
            <div className="col-span-2">
              <p className="text-[9px] text-gray-400 mb-1">Select allowed low-sequence patterns:</p>
              <div className="grid grid-cols-4 gap-1">
                {LOW_SEQ_PATTERNS.map(p => {
                  const active = (rules.lowSeqPatterns ?? []).includes(p);
                  return (
                    <button
                      key={p}
                      onClick={() => up({
                        lowSeqPatterns: active
                          ? (rules.lowSeqPatterns ?? []).filter(x => x !== p)
                          : [...(rules.lowSeqPatterns ?? []), p],
                      })}
                      className={`px-1 py-0.5 text-[10px] rounded border font-medium ${active ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-gray-50 text-gray-500 border-gray-300 hover:bg-gray-100'}`}
                    >
                      {p}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <p
              className="text-[10px] text-gray-400 mb-0.5 uppercase tracking-wide font-medium cursor-help"
              title="Average bar-count gap between consecutive pivots across both the high and low sequences — a trend-pace check. 'Fast' requires the average gap to stay at or below the threshold (pivots forming quickly — accelerating/choppy). 'Slow' requires it to be at or above (pivots spaced out — a slower, more mature trend)."
            >
              Pivot Gap (bars)
            </p>
            <select
              value={rules.pivotGapFilter ?? 'none'}
              onChange={e => up({ pivotGapFilter: e.target.value as RegimeRules['pivotGapFilter'] })}
              className="w-full px-1.5 py-1 text-[11px] border rounded"
            >
              <option value="none">None</option>
              <option value="max">≤ X bars (Fast)</option>
              <option value="min">≥ X bars (Slow)</option>
            </select>
          </div>
          {(rules.pivotGapFilter ?? 'none') !== 'none' && (
            <div>
              <p
                className="text-[10px] text-gray-400 mb-0.5 uppercase tracking-wide font-medium cursor-help"
                title="Bar-count gap cutoff between consecutive pivots. Default 5."
              >
                Gap Threshold (bars)
              </p>
              <input
                type="number" step={1} min={0}
                value={rules.pivotGapThreshold ?? 5}
                onChange={e => up({ pivotGapThreshold: Number(e.target.value) })}
                className="w-full px-1.5 py-1 text-[11px] border rounded text-center"
              />
            </div>
          )}
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
