import { Fragment, useEffect, useMemo, useState } from 'react';
import { ArrowUpDown, BarChart3, ChevronDown, ChevronRight, Crosshair, Info } from 'lucide-react';
import { useSessionStore } from '../stores/sessionStore';
import { formatTimestamp } from '../utils/formatters';
import {
  RANGE_SUBS, STRUCTURE_SUB_LABELS, TREND_SUBS,
  computeStructureStats, getStructureTimeline, subTransitions, summarize, transitionMatrix,
  type DistSummary, type EpisodeStat, type StructureBroad, type SubKey,
} from '../utils/marketStructure';
import { PageNavTabs, type ActivePage } from './PageNavTabs';

// Descriptive statistics of the pivot market-structure classifier (utils/marketStructure/stats):
// how many up / down / range episodes, how long, how far they moved, how deep the pullbacks
// were, what followed what — summary + per-episode detail, filterable by broad and sub-regime.

type BroadFilter = 'all' | StructureBroad;
type SubBasis = 'dominant' | 'final';
type SortField =
  | 'segmentId' | 'spanBars' | 'labelledBars' | 'confirmLag' | 'move' | 'movePct' | 'capturable'
  | 'giveback' | 'oppositeCount' | 'oppositeMax' | 'oppositeSum' | 'efficiency' | 'failedBreakouts';

const BROADS: StructureBroad[] = ['up', 'down', 'range'];
const BROAD_LABEL: Record<StructureBroad, string> = { up: 'Up trend', down: 'Down trend', range: 'Range' };
const BROAD_TEXT: Record<StructureBroad, string> = { up: 'text-green-700', down: 'text-red-700', range: 'text-blue-700' };
const BROAD_BG: Record<StructureBroad, string> = {
  up: 'bg-green-50 border-green-200', down: 'bg-red-50 border-red-200', range: 'bg-blue-50 border-blue-200',
};
const subLabel = (s: SubKey) => (s === 'forming' ? 'Forming' : STRUCTURE_SUB_LABELS[s]);
const subsFor = (b: BroadFilter): SubKey[] =>
  b === 'range' ? [...RANGE_SUBS, 'forming'] : b === 'all' ? [...TREND_SUBS, ...RANGE_SUBS, 'forming'] : [...TREND_SUBS, 'forming'];

const FILTER_KEY = 'structureStats.filter';
interface SavedFilter { broad: BroadFilter; subs: SubKey[]; basis: SubBasis; minSpan: number; toReplay: boolean }
const DEFAULT_FILTER: SavedFilter = { broad: 'all', subs: [], basis: 'dominant', minSpan: 0, toReplay: false };
function loadFilter(): SavedFilter {
  try {
    const raw = localStorage.getItem(FILTER_KEY);
    return raw ? { ...DEFAULT_FILTER, ...JSON.parse(raw) } : DEFAULT_FILTER;
  } catch { return DEFAULT_FILTER; }
}

const fmt = (n: number | null | undefined, d = 1) => (n === null || n === undefined || !Number.isFinite(n) ? '—' : n.toFixed(d));
const pct = (a: number, b: number) => (b > 0 ? `${((100 * a) / b).toFixed(1)}%` : '—');

interface Props { onNavigate: (page: ActivePage) => void }

export function StructureStatsPage({ onNavigate }: Props) {
  const candles = useSessionStore(s => s.candles);
  const currentIndex = useSessionStore(s => s.currentIndex);
  const config = useSessionStore(s => s.autoBacktestConfig);
  const isLiveMode = useSessionStore(s => s.isLiveMode);
  const indicatorOn = useSessionStore(s => s.primaryIndicators.includes('marketStructure'));
  const toggleIndicator = useSessionStore(s => s.toggleSharedIndicator);
  const scrollToTime = useSessionStore(s => s.scrollToTime);
  const highlightCandle = useSessionStore(s => s.highlightCandle);
  const setCurrentIndex = useSessionStore(s => s.setCurrentIndex);

  const [filter, setFilter] = useState<SavedFilter>(loadFilter);
  const { broad, subs, basis, minSpan, toReplay } = filter;
  const patch = (p: Partial<SavedFilter>) => setFilter(f => ({ ...f, ...p }));
  useEffect(() => {
    try { localStorage.setItem(FILTER_KEY, JSON.stringify(filter)); } catch { /* storage unavailable */ }
  }, [filter]);

  const [sortField, setSortField] = useState<SortField>('segmentId');
  const [sortDesc, setSortDesc] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);

  // Timeline is WeakMap-memoised per (candles, params); stats are a single O(bars) pass.
  const states = useMemo(() => getStructureTimeline(candles, config), [candles, config]);
  const endIndex = toReplay ? Math.min(currentIndex, candles.length - 1) : candles.length - 1;
  const stats = useMemo(
    () => (candles.length ? computeStructureStats(candles, states, endIndex) : null),
    [candles, states, endIndex],
  );

  const subOf = (e: EpisodeStat) => (basis === 'dominant' ? e.dominantSub : e.finalSub);
  const filtered = useMemo(() => {
    if (!stats) return [];
    return stats.episodes.filter(e => {
      const sub = basis === 'dominant' ? e.dominantSub : e.finalSub;
      return (broad === 'all' || e.broad === broad) && (subs.length === 0 || subs.includes(sub)) && e.spanBars >= minSpan;
    });
  }, [stats, broad, subs, basis, minSpan]);

  const byBroad = useMemo(() => {
    const m = { up: [] as EpisodeStat[], down: [] as EpisodeStat[], range: [] as EpisodeStat[] };
    for (const e of filtered) m[e.broad].push(e);
    return m;
  }, [filtered]);

  // Per-bar totals respect the broad + sub chips exactly (bars are labelled one by one).
  const barsFor = (b: StructureBroad) => {
    if (!stats) return 0;
    if (broad !== 'all' && broad !== b) return 0;
    if (subs.length === 0) return stats.barsByBroad[b];
    return subs.reduce((t, s) => t + (stats.barsBySub[b][s] ?? 0), 0);
  };

  const sorted = useMemo(() => {
    const val = (e: EpisodeStat): number => {
      const v = e[sortField];
      return typeof v === 'number' ? v : -Infinity;
    };
    return [...filtered].sort((a, b) => (sortDesc ? val(b) - val(a) : val(a) - val(b)));
  }, [filtered, sortField, sortDesc]);
  const onSort = (f: SortField) => {
    if (f === sortField) setSortDesc(d => !d);
    else { setSortField(f); setSortDesc(true); }
  };

  const jumpTo = (e: EpisodeStat) => {
    if (!candles.length) return;
    if (e.anchorBar > currentIndex) {
      if (isLiveMode) return;
      const ok = window.confirm(
        `This episode starts after the current replay bar. Advance replay to bar ${e.labelEnd + 1}? `
        + 'This reveals the candles in between and runs SL/TP checks for any open position.',
      );
      if (!ok) return;
      setCurrentIndex(e.labelEnd);
    }
    const ts = candles[e.anchorBar].timestamp;
    scrollToTime(ts);
    highlightCandle(ts);
    onNavigate('chart');
  };

  const toggleSub = (s: SubKey) =>
    patch({ subs: subs.includes(s) ? subs.filter(x => x !== s) : [...subs, s] });

  const shownSubs = subsFor(broad);
  const trendEps = [...byBroad.up, ...byBroad.down];
  const totalBars = stats?.totalBars ?? 0;

  return (
    <div className="absolute inset-0 z-[105] bg-slate-50 flex flex-col overflow-hidden font-sans">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-slate-200 shrink-0 gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <PageNavTabs active="structureStats" onNavigate={onNavigate} />
          <div className="w-px h-6 bg-slate-200 hidden md:block" />
          <div className="bg-indigo-600 p-2 rounded-xl text-white shadow-lg shadow-indigo-200 hidden md:block">
            <BarChart3 size={20} />
          </div>
          <div className="hidden md:block">
            <h2 className="text-xl font-bold text-slate-800 tracking-tight">Market Structure Statistics</h2>
            <p className="text-slate-500 text-xs font-medium">
              Pivot structure episodes · {totalBars.toLocaleString()} bars · thresholds from Session Settings → Market Structure
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <label className="flex items-center gap-1.5 text-slate-600 cursor-pointer" title="Only use bars up to the current replay bar (no look-ahead). The last episode is then still open.">
            <input type="checkbox" checked={toReplay} onChange={e => patch({ toReplay: e.target.checked })} />
            Stop at replay bar
          </label>
          <label className="flex items-center gap-1.5 text-slate-600" title="Which sub-regime an episode is filed under. Dominant = the sub it spent the most bars in. Final = its sub on its last bar (hindsight).">
            Episode sub
            <select value={basis} onChange={e => patch({ basis: e.target.value as SubBasis })} className="border border-slate-200 rounded px-1.5 py-1 bg-white">
              <option value="dominant">Dominant</option>
              <option value="final">Final</option>
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-slate-600" title="Hide episodes whose hindsight span is shorter than this many bars.">
            Min span
            <input
              type="number" min={0} value={minSpan}
              onChange={e => patch({ minSpan: Math.max(0, Number(e.target.value) || 0) })}
              className="w-16 border border-slate-200 rounded px-1.5 py-1"
            />
          </label>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-6">
        {/* Filter bar */}
        <div className="bg-white border border-slate-200 rounded-xl p-3 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] text-gray-400 uppercase tracking-wide font-medium w-20">Structure</span>
            {(['all', ...BROADS] as BroadFilter[]).map(b => (
              <button
                key={b}
                type="button"
                onClick={() => patch({ broad: b, subs: subs.filter(s => subsFor(b).includes(s)) })}
                className={`px-2.5 py-1 text-xs rounded border transition-all ${
                  broad === b ? 'bg-indigo-600 border-indigo-600 text-white font-medium' : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                }`}
              >
                {b === 'all' ? 'All' : BROAD_LABEL[b]}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-[10px] text-gray-400 uppercase tracking-wide font-medium w-20 mr-1">
              Sub-regime {subs.length > 0 ? `(${subs.length})` : ''}
            </span>
            <button
              type="button"
              onClick={() => patch({ subs: [] })}
              className={`px-1.5 py-1 text-[10px] rounded border transition-all duration-150 active:scale-95 ${
                subs.length === 0 ? 'bg-indigo-600 border-indigo-600 text-white font-medium' : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
              }`}
            >
              All
            </button>
            {shownSubs.map(s => (
              <button
                key={s}
                type="button"
                onClick={() => toggleSub(s)}
                className={`px-1.5 py-1 text-[10px] rounded border transition-all duration-150 active:scale-95 ${
                  subs.includes(s) ? 'bg-indigo-600 border-indigo-600 text-white font-medium' : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                } ${s === 'forming' ? 'italic' : ''}`}
              >
                {subLabel(s)}
              </button>
            ))}
          </div>
        </div>

        {!indicatorOn && (
          <div className="flex items-center gap-2 text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2">
            <Info size={14} />
            The Market Structure chart layer is off — turn it on to see the bands when jumping to an episode.
            <button onClick={() => toggleIndicator('marketStructure', 'primary')} className="ml-auto px-2 py-1 bg-amber-500 text-white rounded font-semibold">
              Turn on
            </button>
          </div>
        )}

        {!stats || stats.episodes.length === 0 ? (
          <div className="text-center text-slate-400 py-20">No candles loaded.</div>
        ) : (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {BROADS.map(b => {
                const eps = byBroad[b];
                const span = summarize(eps.map(e => e.spanBars));
                const move = summarize(eps.map(e => e.move));
                const movePct = summarize(eps.map(e => e.movePct));
                const bars = barsFor(b);
                return (
                  <div key={b} className={`p-4 rounded-lg border ${BROAD_BG[b]}`}>
                    <div className={`text-sm font-semibold ${BROAD_TEXT[b]}`}>{BROAD_LABEL[b]}</div>
                    <div className="text-2xl font-bold text-slate-800">{eps.length}<span className="text-xs font-medium text-slate-500 ml-1">episodes</span></div>
                    <div className="text-xs text-slate-600 mt-1 space-y-0.5">
                      <div>Candles: <b>{bars.toLocaleString()}</b> ({pct(bars, totalBars)} of all)</div>
                      <div>Span: median <b>{fmt(span.median, 0)}</b> · mean {fmt(span.mean, 1)} bars</div>
                      <div>{b === 'range' ? 'Height' : 'Move'}: median <b>{fmt(move.median, 2)}</b> pts ({fmt(movePct.median, 2)}%) · total {fmt(move.sum, 1)}</div>
                    </div>
                  </div>
                );
              })}
              <div className="p-4 rounded-lg border bg-white border-slate-200">
                <div className="text-sm font-semibold text-slate-700">Opposite moves (pullbacks)</div>
                {(['up', 'down'] as const).map(b => {
                  const eps = byBroad[b];
                  const n = eps.reduce((t, e) => t + e.oppositeCount, 0);
                  const sum = eps.reduce((t, e) => t + e.oppositeSum, 0);
                  const mv = eps.reduce((t, e) => t + e.move, 0);
                  return (
                    <div key={b} className="text-xs text-slate-600 mt-1">
                      <span className={`font-semibold ${BROAD_TEXT[b]}`}>{BROAD_LABEL[b]}:</span> {n} pullbacks · {fmt(sum, 1)} pts
                      {' '}(<b>{pct(sum, mv)}</b> of trend move)
                    </div>
                  );
                })}
                <div className="text-xs text-slate-500 mt-2">
                  Median confirmation lag: <b>{fmt(summarize(filtered.map(e => e.confirmLag)).median, 0)}</b> bars
                </div>
              </div>
            </div>

            {/* Broad summary */}
            <Section title="Summary by structure" hint="median · mean · [p25–p75] · max. Medians are the headline — durations and moves are right-skewed.">
              <BroadSummaryTable byBroad={byBroad} />
            </Section>

            {/* Sub-regime table */}
            <Section title="Sub-regimes" hint="Bars = per-bar label (exact even when an episode changed sub). Episode columns use the Episode-sub basis. Click a row to toggle its chip.">
              <SubTable
                stats={stats}
                episodes={stats.episodes.filter(e => e.spanBars >= minSpan)}
                subOf={subOf}
                selected={subs}
                onToggle={(b, s) => { if (broad !== 'all' && broad !== b) patch({ broad: 'all' }); toggleSub(s); }}
              />
            </Section>

            {/* Transitions */}
            <Section title="What follows what" hint="Next episode after each filtered episode. Range rows also split by the trend that came before (continuation vs reversal).">
              <Transitions episodes={filtered} all={stats.episodes} />
            </Section>

            {/* Top 10 */}
            <Section title="Top 10">
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                <TopList title="Largest up moves" eps={byBroad.up} val={e => e.move} unit="pts" sub={e => `${fmt(e.movePct, 2)}% · ${e.spanBars} bars`} candles={candles} onJump={jumpTo} />
                <TopList title="Largest down moves" eps={byBroad.down} val={e => e.move} unit="pts" sub={e => `${fmt(e.movePct, 2)}% · ${e.spanBars} bars`} candles={candles} onJump={jumpTo} />
                <TopList title="Worst pullback in up trends" eps={byBroad.up} val={e => e.oppositeMax} unit="pts" sub={e => `retrace ${fmt(e.worstRetrace, 2)}× · trend ${fmt(e.move, 1)}`} candles={candles} onJump={jumpTo} />
                <TopList title="Worst pullback in down trends" eps={byBroad.down} val={e => e.oppositeMax} unit="pts" sub={e => `retrace ${fmt(e.worstRetrace, 2)}× · trend ${fmt(e.move, 1)}`} candles={candles} onJump={jumpTo} />
                <TopList title="Longest ranges" eps={byBroad.range} val={e => e.spanBars} unit="bars" sub={e => `height ${fmt(e.move, 1)} · ${e.failedBreakouts} failed BO`} candles={candles} onJump={jumpTo} />
                <TopList title="Most failed breakouts" eps={byBroad.range} val={e => e.failedBreakouts} unit="" sub={e => `${e.spanBars} bars · exit ${e.nextBroad ?? 'open'}`} candles={candles} onJump={jumpTo} digits={0} />
                <TopList title="Largest giveback (trend)" eps={trendEps} val={e => e.giveback ?? -1} unit="pts" sub={e => `${e.broad} · of ${fmt(e.move, 1)} move`} candles={candles} onJump={jumpTo} />
                <TopList title="Longest trends" eps={trendEps} val={e => e.spanBars} unit="bars" sub={e => `${e.broad} · ${fmt(e.move, 1)} pts`} candles={candles} onJump={jumpTo} digits={0} />
              </div>
            </Section>

            {/* Detail */}
            <Section title={`All episodes (${sorted.length})`} hint="Click ⌖ to jump to the chart. Expand a row for its sub path, swings and evidence.">
              <div className="overflow-x-auto bg-white border border-slate-200 rounded-lg">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="p-2 w-6" />
                      <Th label="#" f="segmentId" cur={sortField} onSort={onSort} />
                      <th className="p-2 text-left text-[10px] font-bold text-slate-400 uppercase">Start</th>
                      <th className="p-2 text-left text-[10px] font-bold text-slate-400 uppercase">Structure</th>
                      <Th label="Span" f="spanBars" cur={sortField} onSort={onSort} />
                      <Th label="Labelled" f="labelledBars" cur={sortField} onSort={onSort} />
                      <Th label="Lag" f="confirmLag" cur={sortField} onSort={onSort} />
                      <Th label="Move/Ht" f="move" cur={sortField} onSort={onSort} />
                      <Th label="%" f="movePct" cur={sortField} onSort={onSort} />
                      <Th label="Capturable" f="capturable" cur={sortField} onSort={onSort} />
                      <Th label="Giveback" f="giveback" cur={sortField} onSort={onSort} />
                      <Th label="Pullbacks" f="oppositeCount" cur={sortField} onSort={onSort} />
                      <Th label="Worst PB" f="oppositeMax" cur={sortField} onSort={onSort} />
                      <Th label="PB total" f="oppositeSum" cur={sortField} onSort={onSort} />
                      <Th label="Eff." f="efficiency" cur={sortField} onSort={onSort} />
                      <Th label="Failed BO" f="failedBreakouts" cur={sortField} onSort={onSort} />
                      <th className="p-2 text-left text-[10px] font-bold text-slate-400 uppercase">Next</th>
                      <th className="p-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map(e => {
                      const open = expanded === e.segmentId;
                      const trend = e.broad !== 'range';
                      return (
                        <Fragment key={e.segmentId}>
                          <tr className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer" onClick={() => setExpanded(open ? null : e.segmentId)}>
                            <td className="p-2 text-slate-400">{open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</td>
                            <td className="p-2 font-mono text-slate-500">{e.segmentId}</td>
                            <td className="p-2 whitespace-nowrap">{formatTimestamp(candles[e.anchorBar]?.timestamp)}</td>
                            <td className="p-2 whitespace-nowrap">
                              <span className={`font-semibold ${BROAD_TEXT[e.broad]}`}>{e.broad.toUpperCase()}</span>
                              <span className="text-slate-500"> · {subLabel(subOf(e))}</span>
                              {e.open && <span className="ml-1 text-[9px] px-1 rounded bg-slate-200 text-slate-600">open</span>}
                            </td>
                            <td className="p-2 text-right">{e.spanBars}</td>
                            <td className="p-2 text-right">{e.labelledBars}</td>
                            <td className="p-2 text-right">{e.confirmLag}</td>
                            <td className="p-2 text-right font-semibold">{fmt(e.move, 2)}</td>
                            <td className="p-2 text-right">{fmt(e.movePct, 2)}</td>
                            <td className="p-2 text-right">{trend ? fmt(e.capturable, 2) : '—'}</td>
                            <td className="p-2 text-right">{trend ? fmt(e.giveback, 2) : '—'}</td>
                            <td className="p-2 text-right">{trend ? e.oppositeCount : '—'}</td>
                            <td className="p-2 text-right">{trend ? fmt(e.oppositeMax, 2) : '—'}</td>
                            <td className="p-2 text-right">{trend ? fmt(e.oppositeSum, 2) : '—'}</td>
                            <td className="p-2 text-right">{fmt(e.efficiency, 2)}</td>
                            <td className="p-2 text-right">{trend ? '—' : e.failedBreakouts}</td>
                            <td className="p-2">{e.nextBroad ?? '—'}</td>
                            <td className="p-2">
                              <button onClick={ev => { ev.stopPropagation(); jumpTo(e); }} title="Show on chart" className="text-indigo-600 hover:text-indigo-800">
                                <Crosshair size={14} />
                              </button>
                            </td>
                          </tr>
                          {open && (
                            <tr className="bg-slate-50 border-b border-slate-200">
                              <td colSpan={18} className="p-3"><EpisodeDetail e={e} candles={candles} /></td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Section>
          </>
        )}
      </div>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-baseline gap-2 mb-2">
        <h3 className="text-sm font-bold text-slate-700">{title}</h3>
        {hint && <span className="text-[11px] text-slate-400">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function Th({ label, f, cur, onSort }: { label: string; f: SortField; cur: SortField; onSort: (f: SortField) => void }) {
  return (
    <th className="p-2 text-right text-[10px] font-bold text-slate-400 uppercase cursor-pointer hover:bg-slate-100 whitespace-nowrap" onClick={() => onSort(f)}>
      <span className="inline-flex items-center gap-1">
        {label}
        <ArrowUpDown size={10} className={cur === f ? 'text-indigo-500' : 'opacity-20'} />
      </span>
    </th>
  );
}

const dist = (d: DistSummary, digits = 1) =>
  d.n === 0 ? '—' : `${fmt(d.median, digits)} · ${fmt(d.mean, digits)} · [${fmt(d.p25, digits)}–${fmt(d.p75, digits)}] · ${fmt(d.max, digits)}`;

function BroadSummaryTable({ byBroad }: { byBroad: Record<StructureBroad, EpisodeStat[]> }) {
  const rows: { label: string; tip: string; get: (e: EpisodeStat) => number | null; digits?: number; only?: 'trend' | 'range' }[] = [
    { label: 'Span (bars)', tip: 'Hindsight duration: anchor swing point → next episode’s anchor. For a trend this ends at its extreme.', get: e => e.spanBars, digits: 0 },
    { label: 'Labelled bars', tip: 'Bars the live (causal) label showed this episode.', get: e => e.labelledBars, digits: 0 },
    { label: 'Confirmation lag', tip: 'Bars between the anchor and the first bar the label switched.', get: e => e.confirmLag, digits: 0 },
    { label: 'Move / height (pts)', tip: 'Trend: anchor → extreme pivot. Range: box height.', get: e => e.move, digits: 2 },
    { label: 'Move / height (%)', tip: 'Move as % of the anchor price (range: of the box low).', get: e => e.movePct, digits: 2 },
    { label: 'Capturable (pts)', tip: 'Close on the confirmation bar → extreme: what remained once the label confirmed.', get: e => e.capturable, digits: 2, only: 'trend' },
    { label: 'Giveback (pts)', tip: 'Extreme → last close before the break of structure.', get: e => e.giveback, digits: 2, only: 'trend' },
    { label: 'Pullback count', tip: 'Counter-trend swings ending on/before the extreme.', get: e => e.oppositeCount, digits: 1, only: 'trend' },
    { label: 'Worst pullback (pts)', tip: 'Deepest single counter-trend swing.', get: e => e.oppositeMax, digits: 2, only: 'trend' },
    { label: 'Worst retrace (×)', tip: 'Deepest pullback ÷ the impulse before it.', get: e => e.worstRetrace, digits: 2, only: 'trend' },
    { label: 'Pullback total (pts)', tip: 'Sum of all pullbacks in the episode.', get: e => e.oppositeSum, digits: 2, only: 'trend' },
    { label: 'Avg impulse (pts)', tip: 'Mean with-trend swing.', get: e => e.avgImpulse, digits: 2, only: 'trend' },
    { label: 'Efficiency (0–1)', tip: '|anchor → last close| ÷ total swing path. 1 = straight line.', get: e => e.efficiency, digits: 2 },
    { label: 'Failed breakouts', tip: 'Breakout attempts that closed back inside the box.', get: e => e.failedBreakouts, digits: 1, only: 'range' },
  ];
  return (
    <div className="overflow-x-auto bg-white border border-slate-200 rounded-lg">
      <table className="w-full text-xs">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            <th className="p-2 text-left text-[10px] font-bold text-slate-400 uppercase">Metric</th>
            {BROADS.map(b => (
              <th key={b} className={`p-2 text-left text-[10px] font-bold uppercase ${BROAD_TEXT[b]}`}>{BROAD_LABEL[b]} ({byBroad[b].length})</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.label} className="border-b border-slate-100">
              <td className="p-2 text-slate-600 cursor-help" title={r.tip}>{r.label}</td>
              {BROADS.map(b => {
                const skip = (r.only === 'trend' && b === 'range') || (r.only === 'range' && b !== 'range');
                const vals = byBroad[b].flatMap(e => { const v = r.get(e); return v === null ? [] : [v]; });
                return <td key={b} className="p-2 font-mono text-slate-700 whitespace-nowrap">{skip ? '' : dist(summarize(vals), r.digits)}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SubTable({ stats, episodes, subOf, selected, onToggle }: {
  stats: NonNullable<ReturnType<typeof computeStructureStats>>;
  episodes: EpisodeStat[];
  subOf: (e: EpisodeStat) => SubKey;
  selected: SubKey[];
  onToggle: (b: StructureBroad, s: SubKey) => void;
}) {
  const rows: { b: StructureBroad; s: SubKey }[] = [
    ...(['up', 'down'] as const).flatMap(b => [...TREND_SUBS, 'forming' as const].map(s => ({ b, s }))),
    ...[...RANGE_SUBS, 'forming' as const].map(s => ({ b: 'range' as const, s })),
  ];
  return (
    <div className="overflow-x-auto bg-white border border-slate-200 rounded-lg">
      <table className="w-full text-xs">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            {['Structure · sub', 'Bars', '% of all', 'Episodes', 'Median span', 'Median move/ht', 'Median worst PB', 'Pullbacks (Σ pts)', 'Median eff.', 'Exit up / down'].map(h => (
              <th key={h} className="p-2 text-left text-[10px] font-bold text-slate-400 uppercase whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ b, s }) => {
            const bars = stats.barsBySub[b][s] ?? 0;
            const eps = episodes.filter(e => e.broad === b && subOf(e) === s);
            const trend = b !== 'range';
            const ups = eps.filter(e => e.nextBroad === 'up').length;
            const downs = eps.filter(e => e.nextBroad === 'down').length;
            const empty = bars === 0 && eps.length === 0;
            return (
              <tr
                key={`${b}-${s}`}
                onClick={() => onToggle(b, s)}
                className={`border-b border-slate-100 cursor-pointer hover:bg-slate-50 ${selected.includes(s) ? 'bg-indigo-50' : ''} ${empty ? 'text-slate-300' : ''}`}
              >
                <td className="p-2 whitespace-nowrap">
                  <span className={`font-semibold ${empty ? '' : BROAD_TEXT[b]}`}>{b.toUpperCase()}</span> · {subLabel(s)}
                </td>
                <td className="p-2 font-mono">{bars.toLocaleString()}</td>
                <td className="p-2 font-mono">{pct(bars, stats.totalBars)}</td>
                <td className="p-2 font-mono">{eps.length}</td>
                <td className="p-2 font-mono">{eps.length ? fmt(summarize(eps.map(e => e.spanBars)).median, 0) : '—'}</td>
                <td className="p-2 font-mono">{eps.length ? fmt(summarize(eps.map(e => e.move)).median, 2) : '—'}</td>
                <td className="p-2 font-mono">{trend && eps.length ? fmt(summarize(eps.map(e => e.oppositeMax)).median, 2) : '—'}</td>
                <td className="p-2 font-mono">{trend && eps.length ? `${eps.reduce((t, e) => t + e.oppositeCount, 0)} (${fmt(eps.reduce((t, e) => t + e.oppositeSum, 0), 1)})` : '—'}</td>
                <td className="p-2 font-mono">{eps.length ? fmt(summarize(eps.flatMap(e => e.efficiency ?? [])).median, 2) : '—'}</td>
                <td className="p-2 font-mono">{!trend && eps.length ? `${pct(ups, ups + downs)} / ${pct(downs, ups + downs)}` : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Transitions({ episodes, all }: { episodes: EpisodeStat[]; all: EpisodeStat[] }) {
  const m = transitionMatrix(episodes);
  // Ranges split by the trend before them: did the next trend continue or reverse?
  const cont = (['up', 'down'] as const).map(prev => {
    const rs = episodes.filter(e => e.broad === 'range' && e.prevBroad === prev && e.nextBroad);
    const same = rs.filter(e => e.nextBroad === prev).length;
    return { prev, n: rs.length, same, rev: rs.length - same };
  });
  const subT = [...subTransitions(episodes)].sort((a, b) => b[1] - a[1]).slice(0, 12);
  const label = (k: string) => k.split('→').map(s => subLabel(s as SubKey)).join(' → ');
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="bg-white border border-slate-200 rounded-lg p-3">
        <div className="text-[10px] font-bold text-slate-400 uppercase mb-2">From → next</div>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-slate-400"><th className="text-left">From</th><th>Up</th><th>Down</th><th>Range</th><th>Open</th></tr>
          </thead>
          <tbody>
            {BROADS.map(b => {
              const row = m[b];
              const n = row.up + row.down + row.range + row.open;
              return (
                <tr key={b} className="border-t border-slate-100">
                  <td className={`py-1 font-semibold ${BROAD_TEXT[b]}`}>{BROAD_LABEL[b]} ({n})</td>
                  {(['up', 'down', 'range', 'open'] as const).map(k => (
                    <td key={k} className="text-center font-mono">{row[k] ? `${row[k]} (${pct(row[k], n)})` : '·'}</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="bg-white border border-slate-200 rounded-lg p-3 text-xs space-y-2">
        <div className="text-[10px] font-bold text-slate-400 uppercase">Trend → Range → ?</div>
        {cont.map(c => (
          <div key={c.prev}>
            After <span className={`font-semibold ${BROAD_TEXT[c.prev]}`}>{BROAD_LABEL[c.prev]}</span> ({c.n} ranges):
            {' '}continuation <b>{pct(c.same, c.n)}</b> · reversal <b>{pct(c.rev, c.n)}</b>
          </div>
        ))}
        <div className="text-slate-400 pt-1">Episodes in the dataset: {all.length}</div>
      </div>
      <div className="bg-white border border-slate-200 rounded-lg p-3 text-xs">
        <div className="text-[10px] font-bold text-slate-400 uppercase mb-2">Sub-regime changes inside an episode</div>
        {subT.length === 0 ? <div className="text-slate-400">None</div> : subT.map(([k, n]) => (
          <div key={k} className="flex justify-between py-0.5 border-t border-slate-50"><span>{label(k)}</span><span className="font-mono">{n}</span></div>
        ))}
      </div>
    </div>
  );
}

function TopList({ title, eps, val, unit, sub, candles, onJump, digits = 2 }: {
  title: string; eps: EpisodeStat[]; val: (e: EpisodeStat) => number; unit: string;
  sub: (e: EpisodeStat) => string; candles: { timestamp: number }[]; onJump: (e: EpisodeStat) => void; digits?: number;
}) {
  const top = [...eps].filter(e => val(e) >= 0).sort((a, b) => val(b) - val(a)).slice(0, 10);
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-3">
      <div className="text-xs font-bold text-slate-700 mb-2">{title}</div>
      {top.length === 0 ? <div className="text-xs text-slate-400">None</div> : (
        <ol className="space-y-1">
          {top.map((e, i) => (
            <li key={e.segmentId}>
              <button onClick={() => onJump(e)} className="w-full flex items-center gap-2 text-left text-xs hover:bg-indigo-50 rounded px-1 py-0.5" title="Show on chart">
                <span className="w-4 text-slate-400">{i + 1}</span>
                <span className="flex-1 min-w-0">
                  <span className="text-slate-700">{formatTimestamp(candles[e.anchorBar]?.timestamp)}</span>
                  <span className="block text-[10px] text-slate-400 truncate">{sub(e)}</span>
                </span>
                <span className="font-mono font-semibold text-slate-800">{fmt(val(e), digits)} {unit}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function EpisodeDetail({ e, candles }: { e: EpisodeStat; candles: { timestamp: number; close: number }[] }) {
  const ev = e.evidence;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 text-xs">
      <div className="space-y-1">
        <div className="text-[10px] font-bold text-slate-400 uppercase">Sub path</div>
        <div>{e.subPath.map(r => `${subLabel(r.sub)} (${r.bars})`).join(' → ')}</div>
        <div className="text-[10px] font-bold text-slate-400 uppercase pt-2">Levels</div>
        <div>Anchor {fmt(e.anchorPrice, 2)} @ {formatTimestamp(candles[e.anchorBar]?.timestamp)}</div>
        {e.broad !== 'range' && <div>Extreme {fmt(e.extremePrice, 2)} @ {formatTimestamp(candles[e.extremeBar]?.timestamp)}</div>}
        <div>Box {fmt(e.rangeLow, 2)} – {fmt(e.rangeHigh, 2)}</div>
        <div>Labelled {formatTimestamp(candles[e.labelStart]?.timestamp)} → {formatTimestamp(candles[e.labelEnd]?.timestamp)}</div>
        <div>Previous: {e.prevBroad ?? '—'} · Next: {e.nextBroad ?? 'open'}</div>
      </div>
      <div className="space-y-1">
        <div className="text-[10px] font-bold text-slate-400 uppercase">Evidence (last bar)</div>
        <div>Swings {ev.swingCount} · median swing {fmt(ev.medianSwing, 2)} · buffer {fmt(ev.buffer, 2)}</div>
        <div>Avg retrace {fmt(ev.avgRetrace, 2)} · time ratio {fmt(ev.avgTimeRatio, 2)} · amp ratio {fmt(ev.ampRatio, 2)}</div>
        <div>High slope {fmt(ev.hiSlope, 4)} · low slope {fmt(ev.loSlope, 4)}</div>
        <div>Width {fmt(ev.widthStart, 2)} → {fmt(ev.widthEnd, 2)}</div>
        <div>Impulses {e.impulseCount} · avg {fmt(e.avgImpulse, 2)}</div>
      </div>
      <div>
        <div className="text-[10px] font-bold text-slate-400 uppercase mb-1">Swings ({e.swings.length})</div>
        <div className="max-h-48 overflow-auto">
          <table className="w-full">
            <tbody>
              {e.swings.map((s, i) => {
                const counter = e.broad !== 'range' && s.dir !== e.broad;
                return (
                  <tr key={i} className={`border-t border-slate-100 ${counter ? 'text-amber-700' : ''}`}>
                    <td className="pr-2">{s.dir === 'up' ? '▲' : '▼'}</td>
                    <td className="pr-2 whitespace-nowrap">{formatTimestamp(candles[s.from.barIndex]?.timestamp)}</td>
                    <td className="pr-2 font-mono">{fmt(s.from.price, 2)} → {fmt(s.to.price, 2)}</td>
                    <td className="pr-2 font-mono text-right">{fmt(s.size, 2)}</td>
                    <td className="font-mono text-right">{s.bars}b</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
