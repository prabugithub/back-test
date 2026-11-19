import { useMemo, useState } from 'react';
import { ChevronRight, X } from 'lucide-react';
import type { Candle, Trade } from '../../types';
import type { AutoBacktestConfig } from '../../utils/autoBacktestEngine';
import type { ChargesConfig } from '../../utils/charges';
import {
  type DimKey, type ReportFilter, type Stats,
  DIMENSIONS, DEFAULT_GIVEBACK_THRESHOLD_R, applyFilters, attachExcursions, buildReportRows, buildScorecard, computeStats, fmtMoney, fmtPF, fmtR,
  formatDimValue, groupRows, pushFilters, sortDimValues,
  pfColor, pnlColor,
} from '../../utils/strategyReport';
import { ComponentScorecard } from './ComponentScorecard';
import { BreakdownPanel } from './BreakdownPanel';
import { Distribution } from './Distribution';
import { TradeList } from './TradeList';
import { GivebackSection } from './GivebackSection';
import { SectionTitle } from './shared';

interface Props {
  trades: Trade[];
  config: AutoBacktestConfig;
  chargesConfig?: ChargesConfig;
  /** hookDiagnostics.declines of the latest run in this session (undefined after a restore). */
  declines?: Record<string, number>;
  onJump: (tsSec: number) => void;
  /** Loaded candles — the peak-profit (giveback) measures are read off these. */
  candles: Candle[];
}

/** Slicers in the filter bar, in order. Everything else is reachable by drilling. */
const SLICERS: DimKey[] = ['regime', 'direction', 'entryStack', 'exitRule', 'giveback', 'result', 'year'];

const THRESHOLD_KEY = 'bt.report.givebackR';

function readThreshold(): number {
  const v = Number(localStorage.getItem(THRESHOLD_KEY));
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_GIVEBACK_THRESHOLD_R;
}

function Kpi({ label, value, sub, tone = 'text-gray-800' }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="min-w-[84px]">
      <div className="text-[9px] text-gray-400 uppercase tracking-wide">{label}</div>
      <div className={`text-sm font-bold tabular-nums ${tone}`}>{value}</div>
      {sub && <div className="text-[9px] text-gray-400 tabular-nums">{sub}</div>}
    </div>
  );
}

function KpiStrip({ s, net }: { s: Stats; net: boolean }) {
  const expectancyR = s.avgR;
  const payoff = s.avgLoss !== 0 ? Math.abs(s.avgWin / s.avgLoss) : null;
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-2 rounded-lg bg-indigo-50/60 border border-indigo-100 px-3 py-2">
      <Kpi label="Trades" value={String(s.n)} sub={`${s.wins}W / ${s.losses}L`} />
      <Kpi label={net ? 'Net P&L' : 'Gross P&L'} value={fmtMoney(s.net)} tone={pnlColor(s.net)} sub={net ? 'after charges' : 'charges hidden'} />
      <Kpi label="Win rate" value={`${s.winRate.toFixed(1)}%`} sub={`95% CI ${s.ciLow.toFixed(0)}–${s.ciHigh.toFixed(0)}%`} />
      <Kpi label="Profit factor" value={fmtPF(s.pf)} tone={pfColor(s.pf)} />
      <Kpi label="Expectancy" value={fmtMoney(s.avg)} tone={pnlColor(s.avg)} sub={expectancyR === null ? 'per trade' : `${fmtR(expectancyR)} per trade`} />
      <Kpi label="Avg win / loss" value={`${fmtMoney(s.avgWin)} / ${fmtMoney(s.avgLoss)}`} sub={payoff === null ? undefined : `payoff ${payoff.toFixed(2)}×`} />
      <Kpi label="Max drawdown" value={s.maxDD ? fmtMoney(-s.maxDD) : '—'} tone="text-red-600" sub={`${s.maxConsecLosses} losses in a row max`} />
    </div>
  );
}

export function StrategyReport({ trades, config, chargesConfig, declines, onJump, candles }: Props) {
  const [filters, setFilters] = useState<ReportFilter[]>([]);
  const [showTrades, setShowTrades] = useState(true);
  const [thresholdR, setThresholdR] = useState(readThreshold);
  const changeThreshold = (r: number) => {
    setThresholdR(r);
    localStorage.setItem(THRESHOLD_KEY, String(r));
  };

  const baseRows = useMemo(() => buildReportRows(trades, chargesConfig), [trades, chargesConfig]);
  // Separate memo so moving the threshold re-classifies without re-pairing the fills.
  const allRows = useMemo(() => attachExcursions(baseRows, candles, thresholdR), [baseRows, candles, thresholdR]);
  const rows = useMemo(() => applyFilters(allRows, filters), [allRows, filters]);
  const stats = useMemo(() => computeStats(rows), [rows]);
  const sections = useMemo(() => buildScorecard(config, rows, declines), [config, rows, declines]);
  const scale = useMemo(() => sections.reduce((m, sec) => Math.max(m, ...[...sec.entry, ...sec.exit].map(r => Math.abs(r.stats?.net ?? 0))), 0), [sections]);

  // Slicer options come from the rows that survive every OTHER filter, so a slicer never
  // offers a value that would empty the report.
  const slicerOptions = useMemo(() => {
    const out = {} as Record<DimKey, string[]>;
    for (const dim of SLICERS) {
      const others = applyFilters(allRows, filters.filter(f => f.dim !== dim));
      out[dim] = sortDimValues(dim, [...groupRows(others, dim).keys()]);
    }
    return out;
  }, [allRows, filters]);

  const drill = (add: ReportFilter[]) => setFilters(f => pushFilters(f, add));
  const setSlicer = (dim: DimKey, value: string) =>
    setFilters(f => (value ? pushFilters(f, [{ dim, value }]) : f.filter(x => x.dim !== dim)));

  if (allRows.length === 0) {
    return <p className="text-center text-[10px] text-gray-400 py-4">No closed trades in this run.</p>;
  }

  return (
    <div className="mt-2 @container">
      {/* Filter bar — one row of slicers above everything they control */}
      <div className="flex flex-wrap items-center gap-1.5 mb-2">
        {SLICERS.map(dim => {
          const active = filters.find(f => f.dim === dim)?.value ?? '';
          return (
            <select
              key={dim}
              value={active}
              onChange={e => setSlicer(dim, e.target.value)}
              className={`text-[10px] rounded-md border px-1.5 py-1 bg-white ${active ? 'border-indigo-400 text-indigo-700 font-semibold' : 'border-gray-300 text-gray-600'}`}
            >
              <option value="">{DIMENSIONS[dim].label}: all</option>
              {slicerOptions[dim].map(v => <option key={v} value={v}>{formatDimValue(dim, v)}</option>)}
            </select>
          );
        })}
      </div>

      {/* Breadcrumb — the drill path. Click a crumb to step back to it. */}
      <div className="flex flex-wrap items-center gap-1 mb-2 text-[10px]">
        <button
          onClick={() => setFilters([])}
          className={`px-1.5 py-0.5 rounded ${filters.length ? 'text-indigo-600 hover:bg-indigo-50' : 'text-gray-800 font-semibold'}`}
        >
          All trades ({allRows.length})
        </button>
        {filters.map((f, i) => (
          <span key={f.dim} className="flex items-center gap-1">
            <ChevronRight size={10} className="text-gray-300" />
            <span className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full border ${i === filters.length - 1 ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-indigo-700 border-indigo-200'}`}>
              <button onClick={() => setFilters(filters.slice(0, i + 1))} className="capitalize">
                {DIMENSIONS[f.dim].label}: {formatDimValue(f.dim, f.value)}
              </button>
              <button onClick={() => setFilters(filters.filter((_, j) => j !== i))} title="Remove this filter">
                <X size={9} />
              </button>
            </span>
          </span>
        ))}
        {filters.length > 0 && <span className="ml-1 text-gray-400">→ {rows.length} trades</span>}
      </div>

      <KpiStrip s={stats} net={!!chargesConfig} />

      {rows.length === 0 ? (
        <p className="text-center text-[10px] text-gray-400 py-6">No trades match these filters.</p>
      ) : (
        <>
          <SectionTitle right={<span className="text-[9px] text-gray-400">Click a row to drill in</span>}>
            Configured components — what fired and what it earned
          </SectionTitle>
          <ComponentScorecard sections={sections} scale={scale} hasDeclines={!!declines} onDrill={drill} />

          <SectionTitle>Profit giveback — good profit handed back to the market</SectionTitle>
          <GivebackSection rows={rows} thresholdR={thresholdR} onThresholdChange={changeThreshold} onDrill={drill} onJump={onJump} />

          <SectionTitle>Breakdown</SectionTitle>
          <BreakdownPanel rows={rows} pinned={filters.map(f => f.dim)} onDrill={drill} />

          <SectionTitle>Distribution</SectionTitle>
          <Distribution rows={rows} />

          <SectionTitle
            right={
              <button onClick={() => setShowTrades(v => !v)} className="text-[10px] text-indigo-600 hover:underline">
                {showTrades ? 'Hide' : 'Show'}
              </button>
            }
          >
            Trades ({rows.length}) — click one to open it on the chart
          </SectionTitle>
          {showTrades && <TradeList rows={rows} onJump={onJump} />}
        </>
      )}
    </div>
  );
}
