import { useState } from 'react';
import type { Trade } from '../types';
import type { GroupedPosition } from '../utils/tradeAnalysis';
import { getRegimeKey, REGIME_LABELS, type RegimeKey } from '../utils/autoBacktestEngine';

// ─── Types ────────────────────────────────────────────────────────────────────

interface RoundTrip {
  entryPos: string;
  ltMarket: string;
  htMarket: string;
  ltRegime: string;
  llhhPivot: string;
  direction: 'Long' | 'Short';
  pnl: number;
  won: boolean;
  exitReason: string;
  entryPrice: number;
  sl: number;
  tp: number;
  atrDepth: number;
}

interface GroupStats {
  count: number;
  wins: number;
  totalPnL: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ENTRY_POS_ORDER = ['gap', 'on-MA', 'gap-opposite', '—'];
const ENTRY_POS_LABEL: Record<string, string> = {
  gap: 'Gap',
  'on-MA': 'On-MA',
  'gap-opposite': 'Gap-Opp',
  '—': '?',
};

const HTF_ORDER = ['Bull-Trend', 'Bear-Trend', 'Range'];
const HTF_LABEL: Record<string, string> = {
  'Bull-Trend': 'Bull HT',
  'Bear-Trend': 'Bear HT',
  Range: 'Range HT',
};

const LTF_REGIME_ORDER: RegimeKey[] = ['uptrend', 'downtrend', 'reversal', 'range'];

const PIVOT_ORDER = ['HH-HL', 'LH-LL', 'HH-LL', 'LH-HL', '—'];

const ATR_DEPTH_ORDER = ['<0.5', '0.5-1', '1-1.5', '1.5-2', '>2'];

function atrBucket(d: number): string {
  if (d < 0.5) return '<0.5';
  if (d < 1.0) return '0.5-1';
  if (d < 1.5) return '1-1.5';
  if (d < 2.0) return '1.5-2';
  return '>2';
}

const EXIT_ORDER = ['TP', 'SL', 'TIME_OVER', 'MANUAL'];
const EXIT_LABEL: Record<string, string> = {
  TP: 'TP Hit',
  SL: 'SL Hit',
  TIME_OVER: 'Time Out',
  MANUAL: 'Manual',
};

// ─── Data helpers ─────────────────────────────────────────────────────────────

function pairTrades(trades: Trade[]): RoundTrip[] {
  const result: RoundTrip[] = [];
  let pending: Trade | null = null;
  for (const t of trades) {
    if (t.journal && t.pnl === undefined) {
      pending = t;
    } else if (t.pnl !== undefined && pending) {
      const regimeKey = getRegimeKey(pending.journal!.ltMarket || '');
      result.push({
        entryPos: pending.journal!.entryPosition || '—',
        ltMarket: pending.journal!.ltMarket || '—',
        htMarket: pending.journal!.htMarket || '—',
        ltRegime: REGIME_LABELS[regimeKey],
        llhhPivot: pending.journal!.llhhPivot || '—',
        direction: pending.type === 'BUY' ? 'Long' : 'Short',
        pnl: t.pnl,
        won: t.pnl > 0,
        exitReason: t.exitReason || '—',
        entryPrice: pending.price,
        sl: pending.stopLoss ?? 0,
        tp: pending.target ?? 0,
        atrDepth: pending.atrDepthAtEntry ?? 0,
      });
      pending = null;
    }
  }
  return result;
}

function groupBy<K extends string>(trips: RoundTrip[], key: (t: RoundTrip) => K): Map<K, GroupStats> {
  const map = new Map<K, GroupStats>();
  for (const t of trips) {
    const k = key(t);
    const s = map.get(k) ?? { count: 0, wins: 0, totalPnL: 0 };
    map.set(k, { count: s.count + 1, wins: s.wins + (t.won ? 1 : 0), totalPnL: s.totalPnL + t.pnl });
  }
  return map;
}

function groupBy2D<R extends string, C extends string>(
  trips: RoundTrip[],
  rowKey: (t: RoundTrip) => R,
  colKey: (t: RoundTrip) => C,
): Map<R, Map<C, GroupStats>> {
  const map = new Map<R, Map<C, GroupStats>>();
  for (const t of trips) {
    const r = rowKey(t);
    const c = colKey(t);
    if (!map.has(r)) map.set(r, new Map());
    const inner = map.get(r)!;
    const s = inner.get(c) ?? { count: 0, wins: 0, totalPnL: 0 };
    inner.set(c, { count: s.count + 1, wins: s.wins + (t.won ? 1 : 0), totalPnL: s.totalPnL + t.pnl });
  }
  return map;
}

function wr(s: GroupStats): number {
  return s.count === 0 ? 0 : (s.wins / s.count) * 100;
}

function pf(trips: RoundTrip[]): string {
  const grossWin = trips.filter(t => t.won).reduce((a, t) => a + t.pnl, 0);
  const grossLoss = Math.abs(trips.filter(t => !t.won).reduce((a, t) => a + t.pnl, 0));
  if (grossLoss === 0) return grossWin > 0 ? '∞' : '—';
  return (grossWin / grossLoss).toFixed(2);
}

function totalStats(trips: RoundTrip[]): GroupStats {
  return { count: trips.length, wins: trips.filter(t => t.won).length, totalPnL: trips.reduce((a, t) => a + t.pnl, 0) };
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

function wrBg(s: GroupStats | undefined): string {
  if (!s || s.count === 0) return 'bg-gray-50 text-gray-300';
  const w = wr(s);
  if (w >= 65) return 'bg-green-200 text-green-900';
  if (w >= 50) return 'bg-green-50 text-green-800';
  if (w >= 40) return 'bg-yellow-50 text-yellow-800';
  if (w >= 25) return 'bg-red-50 text-red-800';
  return 'bg-red-200 text-red-900';
}

function wrColor(w: number): string {
  if (w >= 65) return 'text-green-700';
  if (w >= 50) return 'text-green-600';
  if (w >= 40) return 'text-yellow-600';
  return 'text-red-600';
}

function pnlColor(v: number): string {
  return v > 0 ? 'text-green-700' : v < 0 ? 'text-red-600' : 'text-gray-500';
}

function pfColor(s: string): string {
  if (s === '∞') return 'text-green-700';
  const n = parseFloat(s);
  return isNaN(n) ? 'text-gray-400' : n >= 1.5 ? 'text-green-700' : n >= 1 ? 'text-yellow-600' : 'text-red-600';
}

function fmt(n: number): string {
  return (n >= 0 ? '+' : '') + n.toFixed(0);
}

function WinBar({ w }: { w: number }) {
  const color = w >= 65 ? 'bg-green-500' : w >= 50 ? 'bg-green-400' : w >= 40 ? 'bg-yellow-400' : 'bg-red-400';
  return (
    <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
      <div className={`h-full ${color} rounded-full`} style={{ width: `${Math.min(w, 100)}%` }} />
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1 mt-3">
      {children}
    </p>
  );
}

// ─── Breakdown row component (used in analytics tab) ─────────────────────────

function BreakdownTable({
  rows,
  data,
  labelMap,
}: {
  rows: string[];
  data: Map<string, GroupStats>;
  labelMap?: Record<string, string>;
}) {
  const present = rows.filter(r => (data.get(r)?.count ?? 0) > 0);
  if (present.length === 0) return <p className="text-[10px] text-gray-400">No data</p>;
  return (
    <table className="w-full text-[10px] border-collapse">
      <thead>
        <tr className="border-b border-gray-100">
          <th className="text-left text-gray-400 font-medium pb-0.5 w-20"></th>
          <th className="text-right text-gray-400 font-medium pb-0.5 w-7">N</th>
          <th className="text-right text-gray-400 font-medium pb-0.5 w-9">Win%</th>
          <th className="pb-0.5 px-2">
            <span className="sr-only">bar</span>
          </th>
          <th className="text-right text-gray-400 font-medium pb-0.5">P&L</th>
          <th className="text-right text-gray-400 font-medium pb-0.5 pl-2">Avg</th>
        </tr>
      </thead>
      <tbody>
        {present.map(r => {
          const s = data.get(r)!;
          const w = wr(s);
          const avg = s.totalPnL / s.count;
          return (
            <tr key={r} className="border-b border-gray-50">
              <td className="py-0.5 text-gray-700 font-medium truncate max-w-[76px]">
                {labelMap?.[r] ?? r}
              </td>
              <td className="py-0.5 text-right text-gray-500">{s.count}</td>
              <td className={`py-0.5 text-right font-semibold ${wrColor(w)}`}>{w.toFixed(0)}%</td>
              <td className="py-0.5 px-2">
                <WinBar w={w} />
              </td>
              <td className={`py-0.5 text-right font-medium ${pnlColor(s.totalPnL)}`}>{fmt(s.totalPnL)}</td>
              <td className={`py-0.5 text-right pl-2 ${pnlColor(avg)}`}>{fmt(avg)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ─── Heatmap (used in overview tab) ──────────────────────────────────────────

function Heatmap({
  rows,
  cols,
  rowLabel,
  colLabel,
  data,
}: {
  rows: string[];
  cols: string[];
  rowLabel: (r: string) => string;
  colLabel: (c: string) => string;
  data: Map<string, Map<string, GroupStats>>;
}) {
  const activeCols = cols.filter(c => rows.some(r => (data.get(r)?.get(c)?.count ?? 0) > 0));
  if (activeCols.length === 0) return null;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[10px] border-collapse">
        <thead>
          <tr>
            <th className="text-left pb-1 pr-2 w-16" />
            {activeCols.map(c => (
              <th key={c} className="text-center text-gray-500 font-medium pb-1 px-1 min-w-[54px]">
                {colLabel(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const rowData = data.get(r);
            const hasAny = activeCols.some(c => (rowData?.get(c)?.count ?? 0) > 0);
            if (!hasAny) return null;
            return (
              <tr key={r}>
                <td className="pr-2 py-0.5 text-gray-600 font-medium whitespace-nowrap">{rowLabel(r)}</td>
                {activeCols.map(c => {
                  const s = rowData?.get(c);
                  return (
                    <td
                      key={c}
                      className={`text-center py-0.5 px-1 rounded text-[10px] font-medium ${wrBg(s)}`}
                      title={s ? `${s.wins}W / ${s.count - s.wins}L | P&L ₹${s.totalPnL.toFixed(0)}` : ''}
                    >
                      {s && s.count > 0 ? (
                        <>
                          {wr(s).toFixed(0)}%
                          <span className="opacity-60 ml-0.5">({s.count})</span>
                        </>
                      ) : '—'}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Overview tab ─────────────────────────────────────────────────────────────

function OverviewTab({ trips }: { trips: RoundTrip[] }) {
  const byEntryPos = groupBy(trips, t => t.entryPos);
  const byEntryLTF = groupBy2D(trips, t => t.entryPos, t => t.ltRegime);
  const byEntryHTF = groupBy2D(trips, t => t.entryPos, t => t.htMarket);
  const byLTFHTF = groupBy2D(trips, t => t.ltRegime, t => t.htMarket);
  const ltfRegimeLabels = LTF_REGIME_ORDER.map(k => REGIME_LABELS[k]);
  const all = totalStats(trips);
  const avg = all.totalPnL / all.count;

  return (
    <div className="px-1">
      <SectionHeader>By Entry Position</SectionHeader>
      <table className="w-full text-[10px] border-collapse">
        <thead>
          <tr className="border-b border-gray-200">
            <th className="text-left text-gray-400 font-medium pb-1">Pos</th>
            <th className="text-right text-gray-400 font-medium pb-1">N</th>
            <th className="text-right text-gray-400 font-medium pb-1">Win%</th>
            <th className="text-right text-gray-400 font-medium pb-1">PF</th>
            <th className="text-right text-gray-400 font-medium pb-1">P&L</th>
            <th className="text-right text-gray-400 font-medium pb-1">Avg</th>
          </tr>
        </thead>
        <tbody>
          {ENTRY_POS_ORDER.map(pos => {
            const s = byEntryPos.get(pos);
            if (!s) return null;
            const posTrips = trips.filter(t => t.entryPos === pos);
            const pfVal = pf(posTrips);
            const posAvg = s.totalPnL / s.count;
            const w = wr(s);
            return (
              <tr key={pos} className="border-b border-gray-100">
                <td className="py-0.5 font-medium text-gray-700">{ENTRY_POS_LABEL[pos] ?? pos}</td>
                <td className="py-0.5 text-right text-gray-600">{s.count}</td>
                <td className={`py-0.5 text-right font-semibold ${wrColor(w)}`}>{w.toFixed(0)}%</td>
                <td className={`py-0.5 text-right ${pfColor(pfVal)}`}>{pfVal}</td>
                <td className={`py-0.5 text-right font-medium ${pnlColor(s.totalPnL)}`}>{fmt(s.totalPnL)}</td>
                <td className={`py-0.5 text-right ${pnlColor(posAvg)}`}>{fmt(posAvg)}</td>
              </tr>
            );
          })}
          <tr className="border-t border-gray-300 font-semibold">
            <td className="pt-1 text-gray-600">All</td>
            <td className="pt-1 text-right text-gray-700">{all.count}</td>
            <td className={`pt-1 text-right ${wrColor(wr(all))}`}>{wr(all).toFixed(0)}%</td>
            <td className={`pt-1 text-right ${pfColor(pf(trips))}`}>{pf(trips)}</td>
            <td className={`pt-1 text-right ${pnlColor(all.totalPnL)}`}>{fmt(all.totalPnL)}</td>
            <td className={`pt-1 text-right ${pnlColor(avg)}`}>{fmt(avg)}</td>
          </tr>
        </tbody>
      </table>

      <SectionHeader>Entry Pos × LTF Regime</SectionHeader>
      <Heatmap
        rows={ENTRY_POS_ORDER}
        cols={ltfRegimeLabels}
        rowLabel={r => ENTRY_POS_LABEL[r] ?? r}
        colLabel={c => c}
        data={byEntryLTF as Map<string, Map<string, GroupStats>>}
      />

      <SectionHeader>Entry Pos × HTF</SectionHeader>
      <Heatmap
        rows={ENTRY_POS_ORDER}
        cols={HTF_ORDER}
        rowLabel={r => ENTRY_POS_LABEL[r] ?? r}
        colLabel={c => HTF_LABEL[c] ?? c}
        data={byEntryHTF as Map<string, Map<string, GroupStats>>}
      />

      <SectionHeader>LTF Regime × HTF</SectionHeader>
      <Heatmap
        rows={ltfRegimeLabels}
        cols={HTF_ORDER}
        rowLabel={r => r}
        colLabel={c => HTF_LABEL[c] ?? c}
        data={byLTFHTF as Map<string, Map<string, GroupStats>>}
      />

      <SectionHeader>ATR Depth at Entry</SectionHeader>
      <BreakdownTable
        rows={ATR_DEPTH_ORDER}
        data={groupBy(trips, t => atrBucket(t.atrDepth))}
      />

      <SectionHeader>ATR Depth × LTF Regime</SectionHeader>
      <Heatmap
        rows={ATR_DEPTH_ORDER}
        cols={ltfRegimeLabels}
        rowLabel={r => r}
        colLabel={c => c}
        data={groupBy2D(trips, t => atrBucket(t.atrDepth), t => t.ltRegime) as Map<string, Map<string, GroupStats>>}
      />

      <p className="text-[9px] text-gray-400 mt-2">Cell = Win% (count). Hover for W/L and P&L.</p>
    </div>
  );
}

// ─── Analytics tab ────────────────────────────────────────────────────────────

function AnalyticsTab({ trips, selectedPos, onPosChange }: {
  trips: RoundTrip[];
  selectedPos: string;
  onPosChange: (p: string) => void;
}) {
  const filtered = selectedPos === '__all__' ? trips : trips.filter(t => t.entryPos === selectedPos);
  const ltfRegimeLabels = LTF_REGIME_ORDER.map(k => REGIME_LABELS[k]);

  // available entry positions (only those with data)
  const availablePos = ENTRY_POS_ORDER.filter(p => trips.some(t => t.entryPos === p));

  if (filtered.length === 0) {
    return (
      <div className="px-1">
        <PosFilter pos={availablePos} selected={selectedPos} onChange={onPosChange} />
        <p className="text-[10px] text-gray-400 mt-4 text-center">No trades for this entry position</p>
      </div>
    );
  }

  const s = totalStats(filtered);
  const pfVal = pf(filtered);
  const avgPnL = s.totalPnL / s.count;
  const winners = filtered.filter(t => t.won);
  const losers = filtered.filter(t => !t.won);
  const avgWin = winners.length ? winners.reduce((a, t) => a + t.pnl, 0) / winners.length : 0;
  const avgLoss = losers.length ? losers.reduce((a, t) => a + t.pnl, 0) / losers.length : 0;
  const maxWin = winners.length ? Math.max(...winners.map(t => t.pnl)) : 0;
  const maxLoss = losers.length ? Math.min(...losers.map(t => t.pnl)) : 0;

  const byDirection = groupBy(filtered, t => t.direction);
  const byLTF = groupBy(filtered, t => t.ltRegime);
  const byHTF = groupBy(filtered, t => t.htMarket);
  const byExit = groupBy(filtered, t => t.exitReason);
  const byPivot = groupBy(filtered, t => t.llhhPivot);

  // LTF × HTF for filtered set
  const byLTFHTF = groupBy2D(filtered, t => t.ltRegime, t => t.htMarket);

  return (
    <div className="px-1">
      <PosFilter pos={availablePos} selected={selectedPos} onChange={onPosChange} />

      {/* ── Summary header ── */}
      <div className="mt-2 rounded-lg bg-indigo-50 border border-indigo-100 px-3 py-2">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] font-bold text-indigo-800">
            {selectedPos === '__all__' ? 'All Entries' : ENTRY_POS_LABEL[selectedPos] ?? selectedPos} — {s.count} trades
          </span>
          <span className={`text-[11px] font-bold ${pnlColor(s.totalPnL)}`}>₹{s.totalPnL.toFixed(0)}</span>
        </div>
        <div className="grid grid-cols-4 gap-2">
          <StatPill label="Win%" value={`${wr(s).toFixed(0)}%`} color={wrColor(wr(s))} />
          <StatPill label="PF" value={pfVal} color={pfColor(pfVal)} />
          <StatPill label="Avg P&L" value={`₹${avgPnL.toFixed(0)}`} color={pnlColor(avgPnL)} />
          <StatPill label="W/L" value={`${s.wins}/${s.count - s.wins}`} color="text-gray-700" />
        </div>
      </div>

      {/* ── By Direction ── */}
      <SectionHeader>By Direction</SectionHeader>
      <BreakdownTable
        rows={['Long', 'Short']}
        data={byDirection as Map<string, GroupStats>}
      />

      {/* ── By LTF Regime ── */}
      <SectionHeader>By LTF Regime</SectionHeader>
      <BreakdownTable
        rows={ltfRegimeLabels}
        data={byLTF as Map<string, GroupStats>}
      />

      {/* ── By HTF ── */}
      <SectionHeader>By HTF Trend</SectionHeader>
      <BreakdownTable
        rows={HTF_ORDER}
        data={byHTF as Map<string, GroupStats>}
        labelMap={HTF_LABEL}
      />

      {/* ── LTF × HTF matrix ── */}
      <SectionHeader>LTF × HTF Matrix</SectionHeader>
      <Heatmap
        rows={ltfRegimeLabels}
        cols={HTF_ORDER}
        rowLabel={r => r}
        colLabel={c => HTF_LABEL[c] ?? c}
        data={byLTFHTF as Map<string, Map<string, GroupStats>>}
      />

      {/* ── By Exit Reason ── */}
      <SectionHeader>By Exit Reason</SectionHeader>
      <BreakdownTable
        rows={EXIT_ORDER}
        data={byExit as Map<string, GroupStats>}
        labelMap={EXIT_LABEL}
      />

      {/* ── By Pivot Sequence ── */}
      <SectionHeader>By Pivot Sequence</SectionHeader>
      <BreakdownTable
        rows={PIVOT_ORDER}
        data={byPivot as Map<string, GroupStats>}
      />

      {/* ── Win / Loss Distribution ── */}
      <SectionHeader>Win / Loss Distribution</SectionHeader>
      <table className="w-full text-[10px] border-collapse">
        <thead>
          <tr className="border-b border-gray-100">
            <th className="text-left text-gray-400 font-medium pb-0.5 w-14"></th>
            <th className="text-right text-gray-400 font-medium pb-0.5">Count</th>
            <th className="text-right text-gray-400 font-medium pb-0.5">Avg ₹</th>
            <th className="text-right text-gray-400 font-medium pb-0.5">Best ₹</th>
            <th className="text-right text-gray-400 font-medium pb-0.5">Worst ₹</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-gray-50">
            <td className="py-0.5 font-medium text-green-700">Winners</td>
            <td className="py-0.5 text-right text-gray-600">{winners.length}</td>
            <td className="py-0.5 text-right text-green-700 font-medium">{winners.length ? fmt(avgWin) : '—'}</td>
            <td className="py-0.5 text-right text-green-700">{winners.length ? fmt(maxWin) : '—'}</td>
            <td className="py-0.5 text-right text-green-700">{winners.length ? fmt(Math.min(...winners.map(t => t.pnl))) : '—'}</td>
          </tr>
          <tr>
            <td className="py-0.5 font-medium text-red-600">Losers</td>
            <td className="py-0.5 text-right text-gray-600">{losers.length}</td>
            <td className="py-0.5 text-right text-red-600 font-medium">{losers.length ? fmt(avgLoss) : '—'}</td>
            <td className="py-0.5 text-right text-red-600">{losers.length ? fmt(Math.max(...losers.map(t => t.pnl))) : '—'}</td>
            <td className="py-0.5 text-right text-red-600">{losers.length ? fmt(maxLoss) : '—'}</td>
          </tr>
        </tbody>
      </table>
      {winners.length > 0 && losers.length > 0 && (
        <p className="text-[9px] text-gray-400 mt-1.5">
          Avg win/loss ratio: {(Math.abs(avgWin) / Math.abs(avgLoss)).toFixed(2)}x
        </p>
      )}
    </div>
  );
}

// ─── Entry position filter pills ─────────────────────────────────────────────

function PosFilter({ pos, selected, onChange }: {
  pos: string[];
  selected: string;
  onChange: (p: string) => void;
}) {
  const all = [{ key: '__all__', label: 'All' }, ...pos.map(p => ({ key: p, label: ENTRY_POS_LABEL[p] ?? p }))];
  return (
    <div className="flex gap-1 flex-wrap mt-1">
      {all.map(({ key, label }) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          className={`px-2 py-0.5 text-[10px] rounded-full font-medium border transition-colors ${
            selected === key
              ? 'bg-indigo-600 text-white border-indigo-600'
              : 'bg-white text-gray-600 border-gray-300 hover:border-indigo-400'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// ─── Stat pill (used in analytics header) ────────────────────────────────────

function StatPill({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="text-center">
      <div className={`text-[11px] font-bold ${color}`}>{value}</div>
      <div className="text-[9px] text-indigo-400">{label}</div>
    </div>
  );
}

// ─── Converters ───────────────────────────────────────────────────────────────

function positionsToRoundTrips(positions: GroupedPosition[]): RoundTrip[] {
  return positions
    .filter(p => p.status === 'CLOSED')
    .map(p => {
      const journal = p.executions[0]?.journal;
      const regimeKey = getRegimeKey(journal?.ltMarket || '');
      return {
        entryPos: journal?.entryPosition || '—',
        ltMarket: journal?.ltMarket || '—',
        htMarket: journal?.htMarket || '—',
        ltRegime: REGIME_LABELS[regimeKey],
        llhhPivot: journal?.llhhPivot || '—',
        direction: p.direction === 'LONG' ? 'Long' : 'Short' as 'Long' | 'Short',
        pnl: p.realizedPnL,
        won: p.realizedPnL > 0,
        exitReason: p.exitReason || '—',
        entryPrice: p.avgEntryPrice,
        sl: p.stopLoss ?? 0,
        tp: p.target ?? 0,
      };
    });
}

// ─── Core dashboard (shared by both entry points) ─────────────────────────────

function DashboardCore({ trips, compact = false }: { trips: RoundTrip[]; compact?: boolean }) {
  const [activeTab, setActiveTab] = useState<'overview' | 'analytics'>('analytics');
  const [selectedPos, setSelectedPos] = useState<string>('gap');

  if (trips.length === 0) return (
    <p className={`text-center text-slate-400 text-sm py-12 ${compact ? 'text-[10px] py-4' : ''}`}>
      No completed trades with journal data found.
    </p>
  );

  return (
    <div className={compact ? 'mt-2' : ''}>
      {/* Tab switcher */}
      <div className={`flex rounded-lg border overflow-hidden mb-2 ${compact ? 'border-gray-200' : 'border-slate-200 w-fit'}`}>
        {(['overview', 'analytics'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`py-1 font-semibold transition-colors capitalize ${
              compact ? 'flex-1 text-[10px] px-0' : 'px-5 py-2 text-sm'
            } ${
              activeTab === tab
                ? 'bg-indigo-600 text-white'
                : 'bg-white text-gray-500 hover:bg-gray-50'
            }`}
          >
            {tab === 'analytics' ? 'Performance Analytics' : 'Overview'}
          </button>
        ))}
      </div>

      {activeTab === 'overview' && <OverviewTab trips={trips} />}
      {activeTab === 'analytics' && (
        <AnalyticsTab trips={trips} selectedPos={selectedPos} onPosChange={setSelectedPos} />
      )}
    </div>
  );
}

// ─── Public exports ───────────────────────────────────────────────────────────

export function EntryMetricsDashboard({ trades }: { trades: Trade[] }) {
  const trips = pairTrades(trades);
  return <DashboardCore trips={trips} compact />;
}

export function EntryMetricsDashboardFromPositions({ positions }: { positions: GroupedPosition[] }) {
  const trips = positionsToRoundTrips(positions);
  return <DashboardCore trips={trips} />;
}
