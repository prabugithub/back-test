import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Crosshair } from 'lucide-react';
import { type ReportTrade, fmtMoney, fmtR, regimeLabel, stackLabel, pnlColor } from '../../utils/strategyReport';


type SortKey = 'entryTs' | 'pnl' | 'r' | 'barsHeld';
const PAGE = 50;

/** Drill-through: the trades behind whatever is filtered. Clicking a row jumps the chart. */
export function TradeList({ rows, onJump }: { rows: ReportTrade[]; onJump: (tsSec: number) => void }) {
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'entryTs', desc: true });
  const [limit, setLimit] = useState(PAGE);

  const sorted = useMemo(() => {
    const v = (t: ReportTrade) => (t[sort.key] ?? -Infinity) as number;
    return [...rows].sort((a, b) => (sort.desc ? v(b) - v(a) : v(a) - v(b)));
  }, [rows, sort]);

  const header = (key: SortKey, label: string, align = 'text-right') => (
    <th
      className={`${align} font-medium pb-1 cursor-pointer select-none hover:text-gray-600`}
      onClick={() => setSort(s => ({ key, desc: s.key === key ? !s.desc : true }))}
    >
      {label}
      {sort.key === key && (sort.desc ? <ArrowDown size={9} className="inline ml-0.5" /> : <ArrowUp size={9} className="inline ml-0.5" />)}
    </th>
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[10px] border-collapse">
        <thead>
          <tr className="text-gray-400 border-b border-gray-200">
            {header('entryTs', 'Entry', 'text-left pl-2')}
            <th className="text-left font-medium pb-1">Dir</th>
            <th className="text-left font-medium pb-1">Regime</th>
            <th className="text-left font-medium pb-1">Trigger</th>
            <th className="text-left font-medium pb-1">Entry stack</th>
            <th className="text-left font-medium pb-1">Exit rule</th>
            {header('barsHeld', 'Bars')}
            {header('r', 'R')}
            {header('pnl', 'P&L')}
            <th className="text-left font-medium pb-1 pl-3">Exit detail</th>
          </tr>
        </thead>
        <tbody>
          {sorted.slice(0, limit).map(t => (
            <tr
              key={t.id}
              onClick={() => onJump(t.entryTsSec)}
              title={`${t.entryReason}\n— click to show this trade on the chart`}
              className="border-b border-gray-50 cursor-pointer hover:bg-indigo-50/60 group"
            >
              <td className="py-0.5 pl-2 whitespace-nowrap text-gray-700 tabular-nums">
                <Crosshair size={9} className="inline mr-1 text-gray-300 group-hover:text-indigo-500" />
                {new Date(t.entryTs).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}
              </td>
              <td className={`py-0.5 font-medium ${t.direction === 'Long' ? 'text-green-700' : 'text-red-600'}`}>{t.direction}</td>
              <td className="py-0.5 text-gray-600">{regimeLabel(t.regime)}</td>
              <td className="py-0.5 text-gray-600">{t.trigger}</td>
              <td className="py-0.5 text-gray-600 max-w-[140px] truncate">{stackLabel(t.entryStack)}</td>
              <td className="py-0.5 text-gray-700 capitalize">{t.exitRule}</td>
              <td className="py-0.5 text-right tabular-nums text-gray-600">{t.barsHeld ?? '—'}</td>
              <td className={`py-0.5 text-right tabular-nums ${t.r === null ? 'text-gray-300' : pnlColor(t.r)}`}>{fmtR(t.r)}</td>
              <td className={`py-0.5 text-right tabular-nums font-semibold ${pnlColor(t.pnl)}`}>{fmtMoney(t.pnl)}</td>
              <td className="py-0.5 pl-3 text-gray-400 max-w-[260px] truncate" title={t.exitDetail}>{t.exitDetail || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {sorted.length > limit && (
        <button onClick={() => setLimit(l => l + PAGE * 2)} className="mt-1.5 text-[10px] text-indigo-600 hover:underline">
          Show more ({sorted.length - limit} remaining)
        </button>
      )}
    </div>
  );
}
