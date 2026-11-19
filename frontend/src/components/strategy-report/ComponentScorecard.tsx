import { ChevronRight } from 'lucide-react';
import { type RegimeSection, type ReportFilter, type ScoreRow, fmtMoney, fmtPF, fmtPct, fmtR, pfColor, pnlColor } from '../../utils/strategyReport';
import { LowSampleBadge, ShareBar, WinRateCI } from './shared';

interface Props {
  sections: RegimeSection[];
  /** Sum of |net| over all rows in view — the scale of the share bars. */
  scale: number;
  hasDeclines: boolean;
  onDrill: (filters: ReportFilter[]) => void;
}

function Row({ row, scale, onDrill }: { row: ScoreRow; scale: number; onDrill: Props['onDrill'] }) {
  const s = row.stats;
  const drillable = row.drill.length > 0 && !!s && s.n > 0;
  const dead = s && s.n === 0;
  return (
    <tr
      onClick={drillable ? () => onDrill(row.drill) : undefined}
      className={`border-b border-gray-50 ${drillable ? 'cursor-pointer hover:bg-indigo-50/60' : ''} ${dead ? 'text-gray-400' : ''}`}
    >
      <td className="py-1 pl-2 pr-2">
        <div className="flex items-center gap-1">
          <span className={`font-medium ${dead ? 'text-gray-400' : 'text-gray-800'} capitalize`}>{row.label}</span>
          {s && <LowSampleBadge n={s.n} />}
          {drillable && <ChevronRight size={10} className="text-gray-300" />}
        </div>
        <div className="text-[9px] text-gray-400">
          {row.role}
          {row.params.length > 0 && <span className="text-gray-500"> · {row.params.join(' · ')}</span>}
        </div>
      </td>
      {s ? (
        <>
          <td className="py-1 text-right tabular-nums">{s.n === 0 ? <span className="text-gray-300">0 hits</span> : s.n}</td>
          <td className="py-1 pl-3"><WinRateCI s={s} /></td>
          <td className={`py-1 text-right tabular-nums font-semibold ${pnlColor(s.net)}`}>{s.n ? fmtMoney(s.net) : '—'}</td>
          <td className={`py-1 text-right tabular-nums ${pnlColor(s.avg)}`}>{s.n ? fmtMoney(s.avg) : '—'}</td>
          <td className={`py-1 text-right tabular-nums ${s.avgR === null ? 'text-gray-300' : pnlColor(s.avgR)}`}>{fmtR(s.avgR)}</td>
          <td className={`py-1 text-right tabular-nums ${pfColor(s.pf)}`}>{s.n ? fmtPF(s.pf) : '—'}</td>
          <td className="py-1 text-right tabular-nums text-gray-600">{fmtR(s.avgPeakR)}</td>
          <td className="py-1 text-right tabular-nums text-red-600">{s.givebackRs ? fmtMoney(-s.givebackRs) : '—'}</td>
          <td className="py-1 text-right tabular-nums text-gray-600">{fmtPct(s.capture)}</td>
          <td className="py-1 pl-3"><ShareBar value={s.net} scale={scale} /></td>
        </>
      ) : (
        <td colSpan={10} className="py-1 text-[10px] text-gray-500">
          {row.blocked === null || row.blocked === undefined
            ? <span className="text-gray-400" title="Block counts come from the latest run in this browser session">Blocks not recorded (re-run to see)</span>
            : <>Blocked <b className="text-gray-800 tabular-nums">{row.blocked.toLocaleString('en-IN')}</b> trigger bar(s) in the last run</>}
        </td>
      )}
    </tr>
  );
}

export function ComponentScorecard({ sections, scale, hasDeclines, onDrill }: Props) {
  if (sections.length === 0) return <p className="text-[10px] text-gray-400">No enabled regimes and no trades.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[10px] border-collapse">
        <thead>
          <tr className="text-gray-400 border-b border-gray-200">
            <th className="text-left font-medium pb-1 pl-2">Component</th>
            <th className="text-right font-medium pb-1">Trades</th>
            <th className="text-left font-medium pb-1 pl-3" title="Point = win rate; band = Wilson 95% interval">Win% (95% CI)</th>
            <th className="text-right font-medium pb-1">Net P&amp;L</th>
            <th className="text-right font-medium pb-1">Avg</th>
            <th className="text-right font-medium pb-1">Avg R</th>
            <th className="text-right font-medium pb-1">PF</th>
            <th className="text-right font-medium pb-1" title="Average best open profit, in R (peak between entry and exit bars)">Avg peak</th>
            <th className="text-right font-medium pb-1" title="Σ (peak open profit − profit kept), gross">Given back</th>
            <th className="text-right font-medium pb-1" title="Σ gross P&L ÷ Σ peak open profit">Capture</th>
            <th className="text-left font-medium pb-1 pl-3">Share of P&amp;L</th>
          </tr>
        </thead>
        {sections.map(sec => (
          <tbody key={sec.regime}>
            <tr
              className="bg-slate-50 border-y border-slate-200 cursor-pointer hover:bg-indigo-50"
              onClick={() => sec.stats.n > 0 && onDrill([{ dim: 'regime', value: sec.regime }])}
            >
              <td className="py-1.5 pl-2">
                <span className="font-bold text-slate-800 text-[11px]">{sec.label}</span>
                <span className="ml-2 text-[9px] text-slate-500">{sec.summary.join(' · ')}</span>
              </td>
              <td className="py-1.5 text-right font-semibold tabular-nums">{sec.stats.n}</td>
              <td className="py-1.5 pl-3"><WinRateCI s={sec.stats} /></td>
              <td className={`py-1.5 text-right font-bold tabular-nums ${pnlColor(sec.stats.net)}`}>{sec.stats.n ? fmtMoney(sec.stats.net) : '—'}</td>
              <td className={`py-1.5 text-right tabular-nums ${pnlColor(sec.stats.avg)}`}>{sec.stats.n ? fmtMoney(sec.stats.avg) : '—'}</td>
              <td className="py-1.5 text-right tabular-nums">{fmtR(sec.stats.avgR)}</td>
              <td className={`py-1.5 text-right tabular-nums ${pfColor(sec.stats.pf)}`}>{sec.stats.n ? fmtPF(sec.stats.pf) : '—'}</td>
              <td className="py-1.5 text-right tabular-nums text-gray-600">{fmtR(sec.stats.avgPeakR)}</td>
              <td className="py-1.5 text-right tabular-nums text-red-600">{sec.stats.givebackRs ? fmtMoney(-sec.stats.givebackRs) : '—'}</td>
              <td className="py-1.5 text-right tabular-nums text-gray-600">{fmtPct(sec.stats.capture)}</td>
              <td className="py-1.5 pl-3"><ShareBar value={sec.stats.net} scale={scale} /></td>
            </tr>
            <tr><td colSpan={11} className="pt-1 pl-2 text-[9px] font-semibold text-indigo-500 uppercase tracking-wide">Entry</td></tr>
            {sec.entry.length === 0
              ? <tr><td colSpan={11} className="pl-2 text-[10px] text-gray-400">—</td></tr>
              : sec.entry.map(r => <Row key={r.key} row={r} scale={scale} onDrill={onDrill} />)}
            <tr><td colSpan={11} className="pt-1 pl-2 text-[9px] font-semibold text-indigo-500 uppercase tracking-wide">Exit — what closed the trades</td></tr>
            {sec.exit.map(r => <Row key={r.key} row={r} scale={scale} onDrill={onDrill} />)}
          </tbody>
        ))}
      </table>
      {!hasDeclines && (
        <p className="mt-1 text-[9px] text-gray-400">Guard block counts exist only for a run made in this browser session.</p>
      )}
    </div>
  );
}
