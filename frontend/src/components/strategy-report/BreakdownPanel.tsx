import { useMemo, useState } from 'react';
import {
  type DimKey, type ReportFilter, type ReportTrade,
  BREAKDOWN_DIMS, DIMENSIONS, computeStats, fmtMoney, fmtPF, fmtR, formatDimValue, groupRows, sortDimValues,
  pfColor, pnlColor,
} from '../../utils/strategyReport';
import { LowSampleBadge, ShareBar, WinRateCI } from './shared';

interface Props {
  rows: ReportTrade[];
  /** Dimensions already pinned by a filter — a breakdown by them would be a single row. */
  pinned: DimKey[];
  onDrill: (filters: ReportFilter[]) => void;
}

function DimSelect({ value, onChange, options, allowNone }: {
  value: DimKey | ''; onChange: (v: DimKey | '') => void; options: DimKey[]; allowNone?: boolean;
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value as DimKey | '')}
      className="text-[10px] border border-gray-300 rounded px-1.5 py-0.5 bg-white"
    >
      {allowNone && <option value="">— none —</option>}
      {options.map(d => <option key={d} value={d}>{DIMENSIONS[d].label}</option>)}
    </select>
  );
}

/** Background for a heatmap cell: sequential on avg P&L, sign picks the hue. */
function cellBg(avg: number, maxAbs: number): string {
  if (maxAbs <= 0 || avg === 0) return 'bg-gray-50';
  const t = Math.abs(avg) / maxAbs;
  if (avg > 0) return t > 0.66 ? 'bg-green-300' : t > 0.33 ? 'bg-green-200' : 'bg-green-50';
  return t > 0.66 ? 'bg-red-300' : t > 0.33 ? 'bg-red-200' : 'bg-red-50';
}

export function BreakdownPanel({ rows, pinned, onDrill }: Props) {
  const options = BREAKDOWN_DIMS.filter(d => !pinned.includes(d));
  const [dimA, setDimA] = useState<DimKey>('exitRule');
  const [dimB, setDimB] = useState<DimKey | ''>('');
  const a = options.includes(dimA) ? dimA : options[0];
  const b = dimB && dimB !== a && options.includes(dimB) ? dimB : '';

  const table = useMemo(() => {
    if (!a) return [];
    const groups = groupRows(rows, a);
    return sortDimValues(a, [...groups.keys()]).map(v => ({ value: v, stats: computeStats(groups.get(v)!) }));
  }, [rows, a]);

  const matrix = useMemo(() => {
    if (!a || !b) return null;
    const groupsA = groupRows(rows, a);
    const colValues = sortDimValues(b, [...groupRows(rows, b).keys()]);
    const rowValues = sortDimValues(a, [...groupsA.keys()]);
    let maxAbs = 0;
    const cells = rowValues.map(rv => {
      const byB = groupRows(groupsA.get(rv)!, b);
      return colValues.map(cv => {
        const list = byB.get(cv);
        const s = list ? computeStats(list) : null;
        if (s) maxAbs = Math.max(maxAbs, Math.abs(s.avg));
        return s;
      });
    });
    return { rowValues, colValues, cells, maxAbs };
  }, [rows, a, b]);

  if (!a) return null;
  const scale = table.reduce((m, r) => Math.max(m, Math.abs(r.stats.net)), 0);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5 mb-1.5 text-[10px] text-gray-500">
        Break down by <DimSelect value={a} onChange={v => v && setDimA(v)} options={options} />
        × <DimSelect value={b} onChange={setDimB} options={options.filter(d => d !== a)} allowNone />
      </div>

      {!matrix ? (
        <div className="overflow-x-auto">
          <table className="w-full text-[10px] border-collapse">
            <thead>
              <tr className="text-gray-400 border-b border-gray-200">
                <th className="text-left font-medium pb-1 pl-2">{DIMENSIONS[a].label}</th>
                <th className="text-right font-medium pb-1">Trades</th>
                <th className="text-left font-medium pb-1 pl-3">Win% (95% CI)</th>
                <th className="text-right font-medium pb-1">Net P&amp;L</th>
                <th className="text-right font-medium pb-1">Avg</th>
                <th className="text-right font-medium pb-1">Avg R</th>
                <th className="text-right font-medium pb-1">PF</th>
                <th className="text-right font-medium pb-1">Max DD</th>
                <th className="text-left font-medium pb-1 pl-3">P&amp;L</th>
              </tr>
            </thead>
            <tbody>
              {table.map(({ value, stats: s }) => (
                <tr key={value} onClick={() => onDrill([{ dim: a, value }])} className="border-b border-gray-50 cursor-pointer hover:bg-indigo-50/60">
                  <td className="py-1 pl-2 font-medium text-gray-800 capitalize">
                    {formatDimValue(a, value)}<LowSampleBadge n={s.n} />
                  </td>
                  <td className="py-1 text-right tabular-nums">{s.n}</td>
                  <td className="py-1 pl-3"><WinRateCI s={s} /></td>
                  <td className={`py-1 text-right tabular-nums font-semibold ${pnlColor(s.net)}`}>{fmtMoney(s.net)}</td>
                  <td className={`py-1 text-right tabular-nums ${pnlColor(s.avg)}`}>{fmtMoney(s.avg)}</td>
                  <td className={`py-1 text-right tabular-nums ${s.avgR === null ? 'text-gray-300' : pnlColor(s.avgR)}`}>{fmtR(s.avgR)}</td>
                  <td className={`py-1 text-right tabular-nums ${pfColor(s.pf)}`}>{fmtPF(s.pf)}</td>
                  <td className="py-1 text-right tabular-nums text-gray-600">{s.maxDD ? fmtMoney(-s.maxDD) : '—'}</td>
                  <td className="py-1 pl-3"><ShareBar value={s.net} scale={scale} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="text-[10px] border-separate border-spacing-0.5">
            <thead>
              <tr>
                <th className="text-left text-gray-400 font-medium pr-2">{DIMENSIONS[a].label} \ {DIMENSIONS[b as DimKey].label}</th>
                {matrix.colValues.map(c => (
                  <th key={c} className="text-center text-gray-500 font-medium px-1 min-w-[64px] capitalize">{formatDimValue(b as DimKey, c)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.rowValues.map((rv, i) => (
                <tr key={rv}>
                  <td className="pr-2 text-gray-700 font-medium whitespace-nowrap capitalize">{formatDimValue(a, rv)}</td>
                  {matrix.cells[i].map((s, j) => (
                    <td
                      key={matrix.colValues[j]}
                      onClick={s ? () => onDrill([{ dim: a, value: rv }, { dim: b as DimKey, value: matrix.colValues[j] }]) : undefined}
                      title={s ? `${s.n} trades · ${s.wins}W/${s.losses}L · net ${fmtMoney(s.net)} · avg ${fmtMoney(s.avg)} · PF ${fmtPF(s.pf)}` : 'No trades'}
                      className={`text-center rounded px-1 py-1 tabular-nums ${s ? `${cellBg(s.avg, matrix.maxAbs)} cursor-pointer hover:ring-1 hover:ring-indigo-400` : 'bg-white text-gray-200'}`}
                    >
                      {s ? (
                        <>
                          <div className="font-semibold text-gray-800">{fmtMoney(s.avg)}</div>
                          <div className="text-[9px] text-gray-600">{s.winRate.toFixed(0)}% · n {s.n}</div>
                        </>
                      ) : '—'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-[9px] text-gray-400">Cell = average P&amp;L per trade (colour), win% and count. Click a cell to drill into it.</p>
        </div>
      )}
    </div>
  );
}
