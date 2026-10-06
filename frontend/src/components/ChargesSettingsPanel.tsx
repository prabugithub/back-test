import { useEffect, useState } from 'react';
import { X, Receipt, RotateCcw } from 'lucide-react';
import { useChargesStore } from '../stores/chargesStore';
import { DEFAULT_FUTURES_CHARGES, type ChargesConfig } from '../utils/charges';

const FIELDS: { key: keyof ChargesConfig; label: string; unit: string; hint: string }[] = [
  { key: 'brokeragePerOrder', label: 'Brokerage', unit: '₹ / order', hint: 'Flat fee per executed order (every entry and exit fill)' },
  { key: 'sttSellPct', label: 'STT', unit: '% sell', hint: 'Securities Transaction Tax — on sell-side turnover only' },
  { key: 'exchangePct', label: 'Exchange txn', unit: '% turnover', hint: 'NSE/BSE transaction charge on buy + sell turnover' },
  { key: 'sebiPerCrore', label: 'SEBI fee', unit: '₹ / crore', hint: 'SEBI turnover fee on buy + sell turnover' },
  { key: 'ipftPerCrore', label: 'IPFT', unit: '₹ / crore', hint: 'NSE Investor Protection Fund Trust charge on buy + sell turnover' },
  { key: 'stampBuyPct', label: 'Stamp duty', unit: '% buy', hint: 'State stamp duty — on buy-side turnover only' },
  { key: 'gstPct', label: 'GST', unit: '%', hint: 'GST on brokerage + exchange + SEBI + IPFT charges' },
];

// Keeps the raw text while typing (so "0.00" on the way to "0.002" isn't snapped back)
// and commits every parseable value straight to the store.
function RateInput({ value, onCommit, title }: { value: number; onCommit: (v: number) => void; title: string }) {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    if (Number(text) !== value) setText(String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      type="number"
      min={0}
      step="any"
      value={text}
      title={title}
      onChange={e => {
        setText(e.target.value);
        const v = Number(e.target.value);
        if (e.target.value !== '' && Number.isFinite(v) && v >= 0) onCommit(v);
      }}
      onBlur={() => setText(String(value))}
      className="w-24 px-2 py-1 text-xs border rounded text-right font-mono"
    />
  );
}

interface ChargesSettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

// Global F&O charge rates (futures model) + the "Show charges" toggle. Opened from the
// Trade Log header and from Auto-Backtest Session Settings — both edit the same store.
export function ChargesSettingsPanel({ isOpen, onClose }: ChargesSettingsPanelProps) {
  const config = useChargesStore(s => s.config);
  const showCharges = useChargesStore(s => s.showCharges);
  const setConfig = useChargesStore(s => s.setConfig);
  const setShowCharges = useChargesStore(s => s.setShowCharges);
  const resetToDefaults = useChargesStore(s => s.resetToDefaults);

  return (
    <>
      <div
        onClick={onClose}
        className={`fixed inset-0 bg-black/20 z-[125] transition-opacity duration-300 ${
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      />
      <div
        className={`fixed inset-y-0 right-0 w-96 bg-white border-l border-slate-200 shadow-2xl z-[130] overflow-y-auto transition-transform duration-300 ease-out ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 sticky top-0 bg-white">
          <div className="flex items-center gap-2">
            <Receipt size={16} className="text-slate-500" />
            <h3 className="text-sm font-bold text-slate-800">Trading Charges (F&amp;O Futures)</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="p-4 flex flex-col gap-3">
          <label className="flex items-center gap-2 cursor-pointer select-none rounded-xl border border-gray-200 p-3">
            <input
              type="checkbox"
              checked={showCharges}
              onChange={e => setShowCharges(e.target.checked)}
              className="w-3.5 h-3.5"
            />
            <span className="text-xs text-gray-700 font-medium">Show charges &amp; net P&amp;L</span>
            <span className="ml-auto text-[10px] text-gray-400">Trade Log + Auto-Backtest</span>
          </label>

          <div className="rounded-xl border border-gray-200 p-3">
            <p className="text-[10px] text-gray-400 uppercase tracking-wide font-medium mb-2">Rates</p>
            <div className="flex flex-col gap-2">
              {FIELDS.map(f => (
                <div key={f.key} className="flex items-center justify-between gap-2" title={f.hint}>
                  <div className="min-w-0">
                    <div className="text-xs text-gray-700 font-medium">{f.label}</div>
                    <div className="text-[10px] text-gray-400">
                      {f.unit} · default {DEFAULT_FUTURES_CHARGES[f.key]}
                    </div>
                  </div>
                  <RateInput value={config[f.key]} onCommit={v => setConfig({ [f.key]: v })} title={f.hint} />
                </div>
              ))}
            </div>
            <button
              onClick={resetToDefaults}
              className="mt-3 flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50"
            >
              <RotateCcw size={12} /> Reset to defaults
            </button>
          </div>

          <p className="text-[10px] text-gray-400 leading-relaxed">
            Turnover per fill = price × quantity. Charges are computed from these rates whenever they are
            shown, so edits apply to every existing trade. Stored trade P&amp;L stays gross.
          </p>
        </div>
      </div>
    </>
  );
}
