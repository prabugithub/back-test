import { X, Settings2 } from 'lucide-react';
import type { AutoBacktestConfig } from '../../utils/autoBacktestEngine';
import { CardShell } from './CardShell';

interface SessionSettingsPanelProps {
  config: AutoBacktestConfig;
  onChange: (patch: Partial<AutoBacktestConfig>) => void;
  isOpen: boolean;
  onClose: () => void;
}

// Session-wide settings that apply across all regimes (Trading Window, Quantity,
// Square-off, SL/TP Fill Mode, Instrumentation Lookbacks) — moved out of the always-visible
// sidebar into a collapsible drawer, since they aren't part of the per-regime
// Market/Entry/Confirmation/Exit/Risk workflow. Same fields, same onChange calls as before.
export function SessionSettingsPanel({ config, onChange, isOpen, onClose }: SessionSettingsPanelProps) {
  return (
    <>
      <div
        onClick={onClose}
        className={`fixed inset-0 bg-black/20 z-[115] transition-opacity duration-300 ${
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      />
      <div
        className={`fixed inset-y-0 right-0 w-96 bg-white border-l border-slate-200 shadow-2xl z-[120] overflow-y-auto transition-transform duration-300 ease-out ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 sticky top-0 bg-white">
          <div className="flex items-center gap-2">
            <Settings2 size={16} className="text-slate-500" />
            <h3 className="text-sm font-bold text-slate-800">Session Settings</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="p-4 flex flex-col gap-3">
          <CardShell title="Trading Window (IST)">
            <div className="flex items-center gap-2">
              <input
                type="time"
                value={config.tradeStartTime}
                onChange={e => onChange({ tradeStartTime: e.target.value })}
                className="flex-1 px-2 py-1.5 text-xs border rounded-lg"
              />
              <span className="text-xs text-gray-400">→</span>
              <input
                type="time"
                value={config.tradeEndTime}
                onChange={e => onChange({ tradeEndTime: e.target.value })}
                className="flex-1 px-2 py-1.5 text-xs border rounded-lg"
              />
            </div>
          </CardShell>

          <CardShell title="Quantity">
            <label className="flex items-center gap-1.5 cursor-pointer select-none mb-1.5">
              <input
                type="checkbox"
                checked={config.useAutoQty}
                onChange={e => onChange({ useAutoQty: e.target.checked })}
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
                    onChange={e => onChange({ riskPerTrade: Number(e.target.value) })}
                    className="w-full px-1.5 py-1 text-xs border rounded text-right"
                    title="Risk per trade (₹)"
                  />
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-gray-500">Min</span>
                  <input
                    type="number" min={1} value={config.minQuantity}
                    onChange={e => onChange({ minQuantity: Number(e.target.value) })}
                    className="w-14 px-1.5 py-1 text-xs border rounded text-center"
                    title="Minimum quantity — skip trade if auto-qty is below this"
                  />
                </div>
              </div>
            ) : (
              <span className="text-[10px] text-gray-400">Using manual qty from trade panel</span>
            )}
          </CardShell>

          <CardShell title="Square-off">
            <label className="flex items-center gap-1.5 cursor-pointer select-none mb-1.5">
              <input
                type="checkbox"
                checked={config.autoSquareOff}
                onChange={e => onChange({ autoSquareOff: e.target.checked })}
                className="w-3.5 h-3.5"
              />
              <span className="text-xs text-gray-600 font-medium">Auto square-off</span>
            </label>
            {config.autoSquareOff && (
              <div className="flex items-center gap-2">
                <input
                  type="time"
                  value={config.squareOffTime}
                  onChange={e => onChange({ squareOffTime: e.target.value })}
                  className="flex-1 px-2 py-1.5 text-xs border rounded-lg"
                  title="Close any open position at this IST time"
                />
                <span className="text-[10px] text-orange-600 font-medium">IST</span>
              </div>
            )}
          </CardShell>

          <CardShell title="SL/TP Fill Price">
            <select
              value={config.slTpFillMode ?? 'exact'}
              onChange={e => onChange({ slTpFillMode: e.target.value as AutoBacktestConfig['slTpFillMode'] })}
              className="w-full px-2 py-1.5 text-xs border rounded-lg"
              title="Exact: fill at the sl/tp price the instant intrabar high/low touches it. Close: legacy — only fire once candle close crosses the level."
            >
              <option value="exact">Exact touch (no slippage)</option>
              <option value="close">Close cross (legacy)</option>
            </select>
          </CardShell>

          <CardShell title="Instrumentation Lookbacks">
            <div className="grid grid-cols-2 gap-x-3 gap-y-2">
              <div className="flex items-center justify-between gap-1">
                <span className="text-[10px] text-gray-500" title="Bars looked back for bar-overlap instrumentation on trade records">Overlap</span>
                <input
                  type="number" min={2} max={20} value={config.barOverlapLookback}
                  onChange={e => onChange({ barOverlapLookback: Number(e.target.value) })}
                  className="w-12 px-1.5 py-1 text-xs border rounded text-center"
                />
              </div>
              <div className="flex items-center justify-between gap-1">
                <span className="text-[10px] text-gray-500" title="Bars looked back for bull/bear bar-range (trend strength) instrumentation on trade records">Bar Range</span>
                <input
                  type="number" min={5} max={50} value={config.barRangeLookback}
                  onChange={e => onChange({ barRangeLookback: Number(e.target.value) })}
                  className="w-12 px-1.5 py-1 text-xs border rounded text-center"
                />
              </div>
              <div className="flex items-center justify-between gap-1">
                <span className="text-[10px] text-gray-500" title="Bars looked back for Kaufman Efficiency Ratio instrumentation on trade records">Efficiency</span>
                <input
                  type="number" min={3} max={30} value={config.efficiencyRatioLookback}
                  onChange={e => onChange({ efficiencyRatioLookback: Number(e.target.value) })}
                  className="w-12 px-1.5 py-1 text-xs border rounded text-center"
                />
              </div>
              <div className="flex items-center justify-between gap-1">
                <span className="text-[10px] text-gray-500" title="Bars looked back for high/low break-count instrumentation on trade records">Breaks</span>
                <input
                  type="number" min={5} max={50} value={config.barBreakLookback}
                  onChange={e => onChange({ barBreakLookback: Number(e.target.value) })}
                  className="w-12 px-1.5 py-1 text-xs border rounded text-center"
                />
              </div>
              <div className="flex items-center justify-between gap-1">
                <span className="text-[10px] text-gray-500" title="Bars looked back for EMA21 slope instrumentation on trade records">EMA21</span>
                <input
                  type="number" min={3} max={30} value={config.ema21SlopeLookback}
                  onChange={e => onChange({ ema21SlopeLookback: Number(e.target.value) })}
                  className="w-12 px-1.5 py-1 text-xs border rounded text-center"
                />
              </div>
              <div className="flex items-center justify-between gap-1">
                <span className="text-[10px] text-gray-500" title="Bars looked back for EMA50 slope instrumentation on trade records">EMA50</span>
                <input
                  type="number" min={3} max={40} value={config.ema50SlopeLookback}
                  onChange={e => onChange({ ema50SlopeLookback: Number(e.target.value) })}
                  className="w-12 px-1.5 py-1 text-xs border rounded text-center"
                />
              </div>
              <div className="flex items-center justify-between gap-1">
                <span className="text-[10px] text-gray-500" title="Bars looked back for EMA20 gap-bar / always-in interaction instrumentation on trade records">EMA20 Int</span>
                <input
                  type="number" min={5} max={50} value={config.emaInteractionLookback}
                  onChange={e => onChange({ emaInteractionLookback: Number(e.target.value) })}
                  className="w-12 px-1.5 py-1 text-xs border rounded text-center"
                />
              </div>
              <div className="flex items-center justify-between gap-1">
                <span className="text-[10px] text-gray-500" title="Bars looked back when searching for the longest consecutive high/low-break run (Consecutive Breaks filter)">Consecutive</span>
                <input
                  type="number" min={4} max={30} value={config.consecutiveBreakLookback ?? 10}
                  onChange={e => onChange({ consecutiveBreakLookback: Number(e.target.value) })}
                  className="w-12 px-1.5 py-1 text-xs border rounded text-center"
                />
              </div>
              <div className="flex items-center justify-between gap-1">
                <span className="text-[10px] text-gray-500" title="Minimum bars a completed breakout leg needs before its strength metrics count — H/L entries with a shorter (or no) leg are blocked while any leg-strength filter is active">Leg Min Bars</span>
                <input
                  type="number" min={2} max={20} value={config.legMinBarCount ?? 5}
                  onChange={e => onChange({ legMinBarCount: Number(e.target.value) })}
                  className="w-12 px-1.5 py-1 text-xs border rounded text-center"
                />
              </div>
              <div className="flex items-center justify-between gap-1">
                <span className="text-[10px] text-gray-500" title="Longer legs are trimmed to their most recent this-many bars when computing leg-strength metrics (ER, overlap, breaks, ranges, gap-bar, consecutive)">Leg Max Bars</span>
                <input
                  type="number" min={5} max={50} value={config.legMaxBarCount ?? 15}
                  onChange={e => onChange({ legMaxBarCount: Number(e.target.value) })}
                  className="w-12 px-1.5 py-1 text-xs border rounded text-center"
                />
              </div>
            </div>
          </CardShell>
        </div>
      </div>
    </>
  );
}
