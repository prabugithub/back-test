import { useState, useEffect, useRef } from 'react';
import { useSessionStore } from '../stores/sessionStore';
import { groupTradesIntoPositions } from '../utils/tradeAnalysis';
import { backtestOptions, nakedBuyBacktest, getOptionLotSize } from '../services/api';
import { formatCurrency } from '../utils/formatters';
import { useNotificationStore } from '../stores/notificationStore';

type StrikeMode = 'ATM' | 'OTM1' | 'OTM2' | 'ITM1' | 'ITM2';

interface OhlcvCandle {
  timestamp: number; // Unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const STRIKE_LABELS: Record<StrikeMode, string> = {
  ATM: 'ATM', OTM1: 'OTM +1', OTM2: 'OTM +2', ITM1: 'ITM +1', ITM2: 'ITM +2'
};
const RR_OPTIONS = [1, 1.5, 2, 3];

function parseNiftyCSV(text: string): OhlcvCandle[] {
  const lines = text.trim().split('\n').filter(l => l.trim());
  if (lines.length === 0) return [];
  // Skip header if first column of first row is not a number
  const startIdx = isNaN(Number(lines[0].split(',')[0].trim())) ? 1 : 0;
  const result: OhlcvCandle[] = [];
  for (const line of lines.slice(startIdx)) {
    const cols = line.split(',');
    if (cols.length < 5) continue;
    const rawDt = cols[0].trim();
    const ts = Math.floor(new Date(rawDt).getTime() / 1000);
    if (isNaN(ts)) continue;
    result.push({
      timestamp: ts,
      open: parseFloat(cols[1]) || 0,
      high: parseFloat(cols[2]) || 0,
      low: parseFloat(cols[3]) || 0,
      close: parseFloat(cols[4]) || 0,
      volume: parseFloat(cols[5] ?? '0') || 0,
    });
  }
  return result;
}

function PnlCell({ value }: { value: number }) {
  const cls = value > 0 ? 'text-green-600' : value < 0 ? 'text-red-600' : 'text-gray-500';
  return <span className={`font-semibold ${cls}`}>{formatCurrency(value)}</span>;
}

function ExitBadge({ reason }: { reason: 'SL' | 'TP' | 'EOD' }) {
  const styles: Record<string, string> = {
    SL: 'bg-red-100 text-red-700',
    TP: 'bg-green-100 text-green-700',
    EOD: 'bg-gray-100 text-gray-600',
  };
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium ${styles[reason]}`}>
      {reason}
    </span>
  );
}

export function OptionBacktestModal({
  isOpen,
  onClose,
  customPositions,
  customInstrument,
}: {
  isOpen: boolean;
  onClose: () => void;
  customPositions?: any[];
  customInstrument?: string;
}) {
  const sessionTrades = useSessionStore((s) => s.trades);
  const sessionInstrument = useSessionStore((s) => s.instrument);
  const notify = useNotificationStore((s) => s.notify);

  // ── Tab ──────────────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<'spread' | 'naked' | 'debug'>('naked');

  // ── Spread config ─────────────────────────────────────────────────────────────
  const [offsetSell, setOffsetSell] = useState(2);
  const [offsetBuy, setOffsetBuy] = useState(4);
  const [spreadResults, setSpreadResults] = useState<any>(null);

  // ── Naked buy config ──────────────────────────────────────────────────────────
  const [expiryFlag, setExpiryFlag] = useState<'WEEK' | 'MONTH'>('WEEK');
  const [strikeMode, setStrikeMode] = useState<StrikeMode>('ATM');
  const [exitMode, setExitMode] = useState<'actual' | 'rr'>('actual');
  const [riskPerTrade, setRiskPerTrade] = useState(10000);
  const [selectedRR, setSelectedRR] = useState<number[]>([1, 2]);
  const [niftyCandles, setNiftyCandles] = useState<OhlcvCandle[]>([]);
  const [csvFileName, setCsvFileName] = useState('');
  const [lotSize, setLotSize] = useState<number | null>(null);
  const [nakedResults, setNakedResults] = useState<any>(null);

  const [isLoading, setIsLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Debug fetch state ─────────────────────────────────────────────────────────
  const [debugParams, setDebugParams] = useState({
    instrument: 'NIFTY',
    optionType: 'CALL' as 'CALL' | 'PUT',
    strike: 'ATM',
    expiryFlag: 'WEEK' as 'WEEK' | 'MONTH',
    expiryCode: 1,
    fromDate: '',
    toDate: '',
    interval: '5',
    filterTime: '',   // e.g. "10:30" to filter candles by IST time
  });
  const [debugCandles, setDebugCandles] = useState<any[]>([]);
  const [debugLoading, setDebugLoading] = useState(false);
  const [debugError, setDebugError] = useState('');

  const handleDebugFetch = async () => {
    setDebugLoading(true);
    setDebugError('');
    setDebugCandles([]);
    try {
      // Strip filterTime — it's frontend-only, not a Dhan param
      const { filterTime, ...apiParams } = debugParams;
      const res = await fetch('/api/options/fetch-single', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(apiParams),
      });
      const text = await res.text();
      let data: any;
      try { data = JSON.parse(text); }
      catch { throw new Error(`Server error (${res.status}): ${text.slice(0, 300)}`); }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setDebugCandles(data.candles ?? []);
    } catch (e: any) {
      setDebugError(e.message);
    } finally {
      setDebugLoading(false);
    }
  };

  // Filter candles by IST time string (e.g. "10:30")
  const filteredDebugCandles = debugParams.filterTime
    ? debugCandles.filter(c => {
        // Dhan candles are true UTC; convert to IST for display
        const d = new Date((c.timestamp + 19800) * 1000);
        const hh = String(d.getUTCHours()).padStart(2, '0');
        const mm = String(d.getUTCMinutes()).padStart(2, '0');
        return `${hh}:${mm}` === debugParams.filterTime;
      })
    : debugCandles;

  const finalInstrument = customInstrument || sessionInstrument;
  const detectedInstrument: 'NIFTY' | 'BANKNIFTY' =
    finalInstrument.toUpperCase().includes('BANKNIFTY') ? 'BANKNIFTY' : 'NIFTY';

  // Fetch lot size when modal opens
  useEffect(() => {
    if (!isOpen) return;
    getOptionLotSize(detectedInstrument)
      .then(r => setLotSize(r.lotSize))
      .catch(() => setLotSize(detectedInstrument === 'NIFTY' ? 25 : 15));
  }, [isOpen, detectedInstrument]);

  const finalPositions = customPositions || groupTradesIntoPositions(sessionTrades);

  // ── CSV upload ────────────────────────────────────────────────────────────────
  const handleCSVUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const candles = parseNiftyCSV(text);
      setNiftyCandles(candles);
      notify(`Loaded ${candles.length} Nifty 5-min candles from ${file.name}`, 'success');
    };
    reader.readAsText(file);
  };

  // ── Spread run ────────────────────────────────────────────────────────────────
  const handleSpreadRun = async () => {
    if (finalPositions.length === 0) { notify('No trades to backtest', 'warning'); return; }
    setIsLoading(true);
    try {
      const data = await backtestOptions({
        spotTrades: [...finalPositions],
        offsetSell,
        offsetBuy,
        instrument: detectedInstrument,
      });
      setSpreadResults(data);
      notify('Spread backtest completed!', 'success');
    } catch (err: any) {
      notify(`Spread backtest failed: ${err.message}`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  // ── Naked buy run ─────────────────────────────────────────────────────────────
  const handleNakedRun = async () => {
    if (finalPositions.length === 0) { notify('No trades to backtest', 'warning'); return; }
    if (exitMode === 'rr' && niftyCandles.length === 0) {
      notify('Please upload Nifty 5-min CSV for RR mode', 'warning');
      return;
    }
    if (exitMode === 'rr' && selectedRR.length === 0) {
      notify('Select at least one RR value', 'warning');
      return;
    }
    setIsLoading(true);
    try {
      const data = await nakedBuyBacktest({
        spotTrades: [...finalPositions],
        instrument: detectedInstrument,
        expiryFlag,
        strikeMode,
        exitMode,
        rrValues: exitMode === 'rr' ? selectedRR : [],
        riskPerTrade,
        niftyCandles: exitMode === 'rr' ? niftyCandles : [],
      });
      setNakedResults(data);
      notify('Naked buy backtest completed!', 'success');
    } catch (err: any) {
      notify(`Naked buy backtest failed: ${err.message}`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 overflow-auto p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-6xl max-h-[92vh] flex flex-col">

        {/* Header */}
        <div className="p-5 border-b flex justify-between items-center bg-gradient-to-r from-indigo-600 to-purple-700 text-white rounded-t-xl">
          <div>
            <h2 className="text-xl font-bold">Options Backtest</h2>
            <p className="text-indigo-200 text-sm mt-0.5">{detectedInstrument} · {finalPositions.length} trades</p>
          </div>
          <button onClick={onClose} className="text-white hover:text-gray-200 text-2xl leading-none">&times;</button>
        </div>

        {/* Tabs */}
        <div className="flex border-b bg-gray-50">
          {(['naked', 'spread', 'debug'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-6 py-3 text-sm font-semibold border-b-2 transition-colors ${
                activeTab === tab
                  ? 'border-indigo-600 text-indigo-700 bg-white'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab === 'naked' ? 'Naked Buy' : tab === 'spread' ? 'Credit Spread' : '🔍 Debug Fetch'}
            </button>
          ))}
        </div>

        <div className="p-6 overflow-y-auto flex-1">

          {/* ─── NAKED BUY TAB ──────────────────────────────────────────────────── */}
          {activeTab === 'naked' && (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                {/* Config */}
                <div className="space-y-5 p-5 bg-gray-50 rounded-xl border border-gray-200">
                  <h3 className="font-semibold text-gray-800 border-b pb-2">Configuration</h3>

                  {/* Lot size */}
                  <div className="flex items-center gap-2 text-sm text-gray-600 bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2">
                    <span className="font-medium text-indigo-700">Lot size:</span>
                    <span className="font-bold text-indigo-900">
                      {lotSize !== null ? `${lotSize} qty / lot (${detectedInstrument})` : 'Loading…'}
                    </span>
                  </div>

                  {/* Expiry */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Expiry</label>
                    <div className="flex gap-2">
                      {(['WEEK', 'MONTH'] as const).map(f => (
                        <button
                          key={f}
                          onClick={() => setExpiryFlag(f)}
                          className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                            expiryFlag === f
                              ? 'bg-indigo-600 text-white border-indigo-600'
                              : 'bg-white text-gray-700 border-gray-300 hover:border-indigo-400'
                          }`}
                        >
                          {f === 'WEEK' ? 'Weekly' : 'Monthly'}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Strike */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Strike Selection</label>
                    <div className="flex flex-wrap gap-2">
                      {(Object.keys(STRIKE_LABELS) as StrikeMode[]).map(s => (
                        <button
                          key={s}
                          onClick={() => setStrikeMode(s)}
                          className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                            strikeMode === s
                              ? 'bg-indigo-600 text-white border-indigo-600'
                              : 'bg-white text-gray-700 border-gray-300 hover:border-indigo-400'
                          }`}
                        >
                          {STRIKE_LABELS[s]}
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-gray-400 mt-1">
                      LONG trades → CE · SHORT trades → PE
                    </p>
                  </div>

                  {/* Exit mode */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Exit Mode</label>
                    <div className="flex gap-2">
                      {(['actual', 'rr'] as const).map(m => (
                        <button
                          key={m}
                          onClick={() => setExitMode(m)}
                          className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                            exitMode === m
                              ? 'bg-purple-600 text-white border-purple-600'
                              : 'bg-white text-gray-700 border-gray-300 hover:border-purple-400'
                          }`}
                        >
                          {m === 'actual' ? 'Actual Entry/Exit' : 'RR-Based'}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* RR options */}
                  {exitMode === 'rr' && (
                    <div className="space-y-4 pl-1 border-l-2 border-purple-200 ml-1">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Risk per Trade (₹)
                        </label>
                        <input
                          type="number"
                          value={riskPerTrade}
                          onChange={e => setRiskPerTrade(Number(e.target.value))}
                          className="w-full border rounded-lg px-3 py-2 text-sm"
                          step={1000}
                          min={1000}
                        />
                        <p className="text-xs text-gray-400 mt-1">
                          Lots = round(risk ÷ SL_points ÷ lot_size)
                        </p>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          RR Values to Test
                        </label>
                        <div className="flex gap-2 flex-wrap">
                          {RR_OPTIONS.map(r => (
                            <button
                              key={r}
                              onClick={() =>
                                setSelectedRR(prev =>
                                  prev.includes(r) ? prev.filter(x => x !== r) : [...prev, r].sort((a, b) => a - b)
                                )
                              }
                              className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                                selectedRR.includes(r)
                                  ? 'bg-purple-600 text-white border-purple-600'
                                  : 'bg-white text-gray-700 border-gray-300 hover:border-purple-400'
                              }`}
                            >
                              1:{r}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Nifty 5-min CSV{' '}
                          <span className="text-red-500">*</span>
                        </label>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => fileInputRef.current?.click()}
                            className="px-3 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                          >
                            Choose CSV
                          </button>
                          <span className="text-xs text-gray-500">
                            {csvFileName
                              ? `${csvFileName} (${niftyCandles.length} candles)`
                              : 'No file — format: datetime,open,high,low,close,volume'}
                          </span>
                        </div>
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept=".csv"
                          className="hidden"
                          onChange={handleCSVUpload}
                        />
                      </div>
                    </div>
                  )}

                  <button
                    onClick={handleNakedRun}
                    disabled={isLoading}
                    className={`w-full py-3 rounded-lg font-bold text-white transition-all shadow ${
                      isLoading
                        ? 'bg-gray-400 cursor-not-allowed'
                        : 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:opacity-90 active:scale-[0.98]'
                    }`}
                  >
                    {isLoading ? 'Running Backtest…' : 'Run Naked Buy Backtest'}
                  </button>
                </div>

                {/* Summary */}
                {nakedResults && (
                  <div className="space-y-4 p-5 bg-indigo-50 rounded-xl border border-indigo-100">
                    <h3 className="font-semibold text-indigo-900 border-b border-indigo-200 pb-2">
                      Summary · {detectedInstrument} · {STRIKE_LABELS[strikeMode]} · {expiryFlag === 'WEEK' ? 'Weekly' : 'Monthly'}
                    </h3>

                    {/* Lot size info */}
                    <div className="text-xs text-indigo-600 bg-white rounded px-3 py-1.5 border border-indigo-100">
                      Lot size: <strong>{nakedResults.lotSize} qty/lot</strong>
                    </div>

                    {/* Spot P&L */}
                    <div className="bg-white p-3 rounded-lg shadow-sm">
                      <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Spot P&amp;L</p>
                      <PnlCell value={nakedResults.summary.spotTotalPnL} />
                    </div>

                    {/* Actual mode */}
                    {exitMode === 'actual' && (
                      <div className="grid grid-cols-2 gap-3">
                        <div className="bg-white p-3 rounded-lg shadow-sm">
                          <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Option P&amp;L</p>
                          <PnlCell value={nakedResults.summary.actualTotalPnL ?? 0} />
                        </div>
                        <div className="bg-white p-3 rounded-lg shadow-sm">
                          <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Win Rate</p>
                          <span className="text-lg font-bold text-blue-600">
                            {(nakedResults.summary.actualWinRate ?? 0).toFixed(1)}%
                          </span>
                        </div>
                      </div>
                    )}

                    {/* RR mode */}
                    {exitMode === 'rr' && nakedResults.summary.rrSummaries && (
                      <div className="space-y-2">
                        {selectedRR.map(rr => {
                          const s = nakedResults.summary.rrSummaries[rr];
                          if (!s) return null;
                          return (
                            <div key={rr} className="bg-white rounded-lg p-3 shadow-sm">
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-semibold text-purple-700 uppercase">1:{rr} RR</span>
                                <PnlCell value={s.totalPnL} />
                              </div>
                              <div className="flex gap-3 text-xs text-gray-500 mt-1">
                                <span>Win: {s.winCount}</span>
                                <span>Loss: {s.lossCount}</span>
                                <span className="font-medium text-blue-600">{s.winRate.toFixed(1)}%</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    <div className="text-xs text-gray-400 mt-2">
                      {nakedResults.trades.filter((t: any) => t.error).length} trades skipped (no data / no SL)
                    </div>
                  </div>
                )}
              </div>

              {/* Results table */}
              {nakedResults && (
                <div>
                  <h3 className="font-bold text-gray-800 mb-3 border-b pb-2">Trade Details</h3>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm divide-y divide-gray-200">
                      <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wider">
                        <tr>
                          <th className="px-3 py-3 text-left">Date</th>
                          <th className="px-3 py-3 text-left">Dir</th>
                          <th className="px-3 py-3 text-left">Option</th>
                          <th className="px-3 py-3 text-right">Entry ₹</th>
                          <th className="px-3 py-3 text-right">Lots</th>
                          <th className="px-3 py-3 text-right">Qty</th>
                          {exitMode === 'actual' && (
                            <>
                              <th className="px-3 py-3 text-right">Exit ₹</th>
                              <th className="px-3 py-3 text-right">Opt P&amp;L</th>
                            </>
                          )}
                          {exitMode === 'rr' &&
                            selectedRR.map(rr => (
                              <th key={rr} className="px-3 py-3 text-right">
                                1:{rr} P&amp;L
                              </th>
                            ))}
                          <th className="px-3 py-3 text-right">Spot P&amp;L</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 bg-white">
                        {nakedResults.trades.map((t: any, idx: number) => (
                          <tr key={idx} className={`hover:bg-gray-50 transition-colors ${t.error ? 'opacity-50' : ''}`}>
                            <td className="px-3 py-2.5 text-xs text-gray-500 whitespace-nowrap">
                              {new Date(t.entryTime).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })}
                            </td>
                            <td className="px-3 py-2.5">
                              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-bold ${
                                t.direction === 'LONG' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                              }`}>
                                {t.direction === 'LONG' ? 'L' : 'S'}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-xs">
                              {t.error ? (
                                <span className="text-gray-400 italic">{t.error}</span>
                              ) : (
                                <div>
                                  <span className={`font-semibold ${t.optionType === 'CALL' ? 'text-green-700' : 'text-red-700'}`}>
                                    {t.optionType === 'CALL' ? 'CE' : 'PE'}
                                  </span>
                                  <span className="text-gray-400 ml-1">{t.strikeLabel}</span>
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-right text-gray-700">
                              {t.entryOptionPrice > 0 ? t.entryOptionPrice.toFixed(2) : '—'}
                            </td>
                            <td className="px-3 py-2.5 text-right text-gray-700">{t.lots || '—'}</td>
                            <td className="px-3 py-2.5 text-right text-gray-700">{t.actualQty || '—'}</td>

                            {exitMode === 'actual' && (
                              <>
                                <td className="px-3 py-2.5 text-right text-gray-700">
                                  {t.exitOptionPrice != null ? t.exitOptionPrice.toFixed(2) : '—'}
                                </td>
                                <td className="px-3 py-2.5 text-right">
                                  {t.pnl != null ? <PnlCell value={t.pnl} /> : <span className="text-gray-400">—</span>}
                                </td>
                              </>
                            )}

                            {exitMode === 'rr' &&
                              selectedRR.map(rr => {
                                const rRes = t.rrResults?.find((r: any) => r.rr === rr);
                                return (
                                  <td key={rr} className="px-3 py-2.5 text-right">
                                    {rRes ? (
                                      <div className="flex flex-col items-end gap-0.5">
                                        <PnlCell value={rRes.pnl} />
                                        <ExitBadge reason={rRes.exitReason} />
                                      </div>
                                    ) : (
                                      <span className="text-gray-400">—</span>
                                    )}
                                  </td>
                                );
                              })}

                            <td className="px-3 py-2.5 text-right">
                              <PnlCell value={t.spotPnL} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ─── SPREAD TAB ─────────────────────────────────────────────────────── */}
          {activeTab === 'spread' && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                <div className="space-y-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
                  <h3 className="font-semibold text-gray-800 border-b pb-2">Spread Configuration</h3>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Sell Strike Offset (OTM)</label>
                      <input
                        type="number"
                        value={offsetSell}
                        onChange={e => setOffsetSell(Number(e.target.value))}
                        className="w-full border rounded px-3 py-2"
                        placeholder="e.g. 2 for 200 pts OTM"
                      />
                      <p className="text-xs text-gray-500 mt-1">Number of 50-pt strikes away from ATM</p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Buy Strike Offset (Hedge)</label>
                      <input
                        type="number"
                        value={offsetBuy}
                        onChange={e => setOffsetBuy(Number(e.target.value))}
                        className="w-full border rounded px-3 py-2"
                        placeholder="e.g. 4 for 400 pts OTM"
                      />
                      <p className="text-xs text-gray-500 mt-1">Must be further from ATM than Sell strike</p>
                    </div>
                    <button
                      onClick={handleSpreadRun}
                      disabled={isLoading}
                      className={`w-full py-3 px-4 rounded-lg font-bold text-white transition-all shadow-md ${
                        isLoading ? 'bg-gray-400' : 'bg-gradient-to-r from-green-500 to-emerald-600 hover:scale-[1.02] active:scale-[0.98]'
                      }`}
                    >
                      {isLoading ? 'Fetching Data...' : 'Run Analysis (5-Year Data)'}
                    </button>
                  </div>
                </div>

                {spreadResults && (
                  <div className="space-y-4 p-4 bg-indigo-50 rounded-lg border border-indigo-100">
                    <h3 className="font-semibold text-indigo-900 border-b border-indigo-200 pb-2">Results Summary</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-white p-3 rounded shadow-sm">
                        <p className="text-xs text-gray-500 uppercase tracking-wider">Spot P&L</p>
                        <p className={`text-lg font-bold ${spreadResults.summary.spotTotalPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {formatCurrency(spreadResults.summary.spotTotalPnL)}
                        </p>
                      </div>
                      <div className="bg-white p-3 rounded shadow-sm">
                        <p className="text-xs text-gray-500 uppercase tracking-wider">Option P&L</p>
                        <p className={`text-lg font-bold ${spreadResults.summary.totalRealizedPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {formatCurrency(spreadResults.summary.totalRealizedPnL)}
                        </p>
                      </div>
                      <div className="bg-white p-3 rounded shadow-sm">
                        <p className="text-xs text-gray-500 uppercase tracking-wider">Win %</p>
                        <p className="text-lg font-bold text-blue-600">{spreadResults.summary.winRate.toFixed(1)}%</p>
                      </div>
                      <div className="bg-white p-3 rounded shadow-sm">
                        <p className="text-xs text-gray-500 uppercase tracking-wider">Trades</p>
                        <p className="text-lg font-bold text-gray-800">{spreadResults.summary.totalTrades}</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {spreadResults && (
                <div className="mt-6">
                  <h3 className="font-bold text-gray-800 mb-4 border-b pb-2">Trade Details</h3>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm divide-y divide-gray-200">
                      <thead className="bg-gray-50 text-gray-600 font-medium">
                        <tr>
                          <th className="px-4 py-3 text-left">Trade</th>
                          <th className="px-4 py-3 text-left">Strategy</th>
                          <th className="px-4 py-3 text-right">Spot P&L</th>
                          <th className="px-4 py-3 text-right">Option P&L</th>
                          <th className="px-4 py-3 text-left">Sell Leg</th>
                          <th className="px-4 py-3 text-left">Buy Leg</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {spreadResults.trades.map((t: any, idx: number) => (
                          <tr key={idx} className="hover:bg-gray-50 transition-colors">
                            <td className="px-4 py-3">
                              <div className="font-medium text-gray-900">{t.direction}</div>
                              <div className="text-xs text-gray-500">{new Date(t.entryTime).toLocaleDateString()}</div>
                            </td>
                            <td className="px-4 py-3">
                              {t.optionResults ? (
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700 border border-blue-100 uppercase">
                                  {t.optionResults.optionType === 'PUT' ? 'Bull Put' : 'Bear Call'}
                                </span>
                              ) : '—'}
                            </td>
                            <td className={`px-4 py-3 text-right font-medium ${t.realizedPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                              {formatCurrency(t.realizedPnL)}
                            </td>
                            <td className={`px-4 py-3 text-right font-bold ${t.optionResults?.totalPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                              {t.optionResults ? formatCurrency(t.optionResults.totalPnL) : (t.error || '—')}
                            </td>
                            <td className="px-4 py-3 text-xs text-gray-600">
                              {t.optionResults ? (
                                <div>
                                  <div className="font-medium">{t.optionResults.sellStrike}</div>
                                  <div>{t.optionResults.l1Entry.toFixed(2)} → {t.optionResults.l1Exit.toFixed(2)}</div>
                                </div>
                              ) : '—'}
                            </td>
                            <td className="px-4 py-3 text-xs text-gray-600">
                              {t.optionResults ? (
                                <div>
                                  <div className="font-medium">{t.optionResults.buyStrike}</div>
                                  <div>{t.optionResults.l2Entry.toFixed(2)} → {t.optionResults.l2Exit.toFixed(2)}</div>
                                </div>
                              ) : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

          {/* ─── DEBUG FETCH TAB ────────────────────────────────────────────────── */}
          {activeTab === 'debug' && (
            <div className="space-y-5">
              <p className="text-sm text-gray-500">Fetch a single option candle series from Dhan API with custom params to verify premium values.</p>

              {/* Params grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {/* Instrument */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Instrument</label>
                  <select value={debugParams.instrument} onChange={e => setDebugParams(p => ({ ...p, instrument: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm">
                    <option>NIFTY</option><option>BANKNIFTY</option>
                  </select>
                </div>
                {/* Option type */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Option Type</label>
                  <select value={debugParams.optionType} onChange={e => setDebugParams(p => ({ ...p, optionType: e.target.value as 'CALL' | 'PUT' }))}
                    className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm">
                    <option>CALL</option><option>PUT</option>
                  </select>
                </div>
                {/* Strike */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Strike</label>
                  <input value={debugParams.strike} onChange={e => setDebugParams(p => ({ ...p, strike: e.target.value }))}
                    placeholder="ATM / ATM+1 / ATM-2"
                    className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm" />
                </div>
                {/* Expiry flag */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Expiry Flag</label>
                  <select value={debugParams.expiryFlag} onChange={e => setDebugParams(p => ({ ...p, expiryFlag: e.target.value as 'WEEK' | 'MONTH' }))}
                    className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm">
                    <option>WEEK</option><option>MONTH</option>
                  </select>
                </div>
                {/* Expiry code */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Expiry Code</label>
                  <input type="number" min={1} value={debugParams.expiryCode}
                    onChange={e => setDebugParams(p => ({ ...p, expiryCode: Number(e.target.value) }))}
                    className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm" />
                </div>
                {/* From date */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">From Date</label>
                  <input type="date" value={debugParams.fromDate} onChange={e => setDebugParams(p => ({ ...p, fromDate: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm" />
                </div>
                {/* To date */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">To Date</label>
                  <input type="date" value={debugParams.toDate} onChange={e => setDebugParams(p => ({ ...p, toDate: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm" />
                </div>
                {/* Interval */}
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Interval (min)</label>
                  <select value={debugParams.interval} onChange={e => setDebugParams(p => ({ ...p, interval: e.target.value }))}
                    className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm">
                    <option value="1">1</option><option value="5">5</option>
                    <option value="15">15</option><option value="25">25</option><option value="60">60</option>
                  </select>
                </div>
              </div>

              {/* Filter + fetch row */}
              <div className="flex items-end gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Filter by IST Time (HH:MM)</label>
                  <input value={debugParams.filterTime} onChange={e => setDebugParams(p => ({ ...p, filterTime: e.target.value }))}
                    placeholder="e.g. 10:30"
                    className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm w-32" />
                </div>
                <button onClick={handleDebugFetch} disabled={debugLoading || !debugParams.fromDate || !debugParams.toDate}
                  className="px-5 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                  {debugLoading ? 'Fetching…' : 'Fetch from Dhan'}
                </button>
                {debugCandles.length > 0 && (
                  <span className="text-xs text-gray-500">{debugCandles.length} candles returned{debugParams.filterTime ? `, ${filteredDebugCandles.length} matching ${debugParams.filterTime} IST` : ''}</span>
                )}
              </div>

              {debugError && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{debugError}</p>}

              {/* Results table */}
              {filteredDebugCandles.length > 0 && (
                <div className="overflow-x-auto rounded-xl border border-gray-200">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                      <tr>
                        <th className="px-3 py-2 text-left">Time (IST)</th>
                        <th className="px-3 py-2 text-right">Open</th>
                        <th className="px-3 py-2 text-right">High</th>
                        <th className="px-3 py-2 text-right">Low</th>
                        <th className="px-3 py-2 text-right font-bold">Close</th>
                        <th className="px-3 py-2 text-right">Volume</th>
                        <th className="px-3 py-2 text-right">IV</th>
                        <th className="px-3 py-2 text-right">OI</th>
                        <th className="px-3 py-2 text-right">Spot</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {filteredDebugCandles.map((c, i) => {
                        const istDate = new Date((c.timestamp + 19800) * 1000);
                        const timeStr = istDate.toUTCString().replace(/ GMT$/, '');
                        return (
                          <tr key={i} className="hover:bg-gray-50">
                            <td className="px-3 py-2 font-mono text-xs text-gray-600 whitespace-nowrap">{timeStr}</td>
                            <td className="px-3 py-2 text-right">{c.open?.toFixed(2) ?? '—'}</td>
                            <td className="px-3 py-2 text-right">{c.high?.toFixed(2) ?? '—'}</td>
                            <td className="px-3 py-2 text-right">{c.low?.toFixed(2) ?? '—'}</td>
                            <td className="px-3 py-2 text-right font-bold text-indigo-700">{c.close?.toFixed(2) ?? '—'}</td>
                            <td className="px-3 py-2 text-right text-gray-500">{c.volume ?? '—'}</td>
                            <td className="px-3 py-2 text-right text-gray-500">{c.iv?.toFixed(2) ?? '—'}</td>
                            <td className="px-3 py-2 text-right text-gray-500">{c.oi ?? '—'}</td>
                            <td className="px-3 py-2 text-right text-gray-500">{c.spot?.toFixed(2) ?? '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

        {/* Footer */}
        <div className="p-4 border-t bg-gray-50 flex justify-end rounded-b-xl">
          <button
            onClick={onClose}
            className="px-6 py-2 bg-white border border-gray-300 rounded-lg text-gray-700 font-semibold hover:bg-gray-50 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
