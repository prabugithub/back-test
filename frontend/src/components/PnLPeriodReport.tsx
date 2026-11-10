import { Fragment, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { Trade } from '../types';
import type { ChargesConfig } from '../utils/charges';
import { computePositionsCharges } from '../utils/charges';
import { groupTradesIntoPositions } from '../utils/tradeAnalysis';
import { formatCurrency } from '../utils/formatters';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface Bucket {
  trades: number;
  wins: number;
  gross: number;
  charges: number;
}

interface YearRow extends Bucket {
  year: number;
  months: Map<number, Bucket>;
}

const emptyBucket = (): Bucket => ({ trades: 0, wins: 0, gross: 0, charges: 0 });

function addTo(b: Bucket, gross: number, charges: number) {
  b.trades += 1;
  b.gross += gross;
  b.charges += charges;
  if (gross - charges > 0) b.wins += 1;
}

const pnlTone = (v: number) => (v > 0 ? 'text-green-600' : v < 0 ? 'text-red-600' : 'text-gray-500');

/**
 * Year → month P&L summary of CLOSED positions, bucketed by exit time (local timezone).
 * When `chargesConfig` is passed, charges and net columns are shown and wins are counted on net.
 */
export function PnLPeriodReport({ trades, chargesConfig }: { trades: Trade[]; chargesConfig?: ChargesConfig }) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const { years, total } = useMemo(() => {
    const closed = groupTradesIntoPositions(trades).filter(p => p.status === 'CLOSED' && p.exitTime);
    const byId = chargesConfig ? computePositionsCharges(closed, chargesConfig).byPositionId : null;
    const yearMap = new Map<number, YearRow>();
    const total = emptyBucket();

    for (const p of closed) {
      const ts = p.exitTime!;
      const d = new Date(ts > 1e11 ? ts : ts * 1000);
      const y = d.getFullYear();
      const m = d.getMonth();
      const charges = byId?.get(p.id)?.total ?? 0;

      let row = yearMap.get(y);
      if (!row) {
        row = { year: y, months: new Map(), ...emptyBucket() };
        yearMap.set(y, row);
      }
      let mb = row.months.get(m);
      if (!mb) {
        mb = emptyBucket();
        row.months.set(m, mb);
      }
      addTo(row, p.realizedPnL, charges);
      addTo(mb, p.realizedPnL, charges);
      addTo(total, p.realizedPnL, charges);
    }
    return { years: [...yearMap.values()].sort((a, b) => a.year - b.year), total };
  }, [trades, chargesConfig]);

  if (years.length === 0) {
    return <div className="text-[11px] text-gray-400 py-2">No closed trades yet.</div>;
  }

  const showCharges = !!chargesConfig;
  const toggle = (y: number) =>
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(y)) next.delete(y); else next.add(y);
      return next;
    });
  const allExpanded = expanded.size === years.length;

  const cells = (b: Bucket) => {
    const net = b.gross - b.charges;
    return (
      <>
        <td className="px-2 py-1 text-right tabular-nums">{b.trades}</td>
        <td className="px-2 py-1 text-right tabular-nums">{b.trades ? ((b.wins / b.trades) * 100).toFixed(0) : 0}%</td>
        {showCharges && (
          <>
            <td className={`px-2 py-1 text-right tabular-nums ${pnlTone(b.gross)}`}>{formatCurrency(b.gross)}</td>
            <td className="px-2 py-1 text-right tabular-nums text-amber-600">{formatCurrency(b.charges)}</td>
          </>
        )}
        <td className={`px-2 py-1 text-right tabular-nums font-semibold ${pnlTone(net)}`}>{formatCurrency(net)}</td>
      </>
    );
  };

  return (
    <div className="pt-2">
      <div className="flex justify-end mb-1">
        <button
          onClick={() => setExpanded(allExpanded ? new Set() : new Set(years.map(r => r.year)))}
          className="text-[10px] text-emerald-700 hover:underline"
        >
          {allExpanded ? 'Collapse all' : 'Expand all'}
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-gray-400 border-b border-gray-200">
              <th className="px-2 py-1 text-left font-medium">Period</th>
              <th className="px-2 py-1 text-right font-medium">Trades</th>
              <th className="px-2 py-1 text-right font-medium">Win%</th>
              {showCharges && (
                <>
                  <th className="px-2 py-1 text-right font-medium">Gross</th>
                  <th className="px-2 py-1 text-right font-medium">Charges</th>
                </>
              )}
              <th className="px-2 py-1 text-right font-medium">{showCharges ? 'Net' : 'P&L'}</th>
            </tr>
          </thead>
          <tbody>
            {years.map(row => {
              const isOpen = expanded.has(row.year);
              return (
                <Fragment key={row.year}>
                  <tr
                    onClick={() => toggle(row.year)}
                    className="cursor-pointer border-b border-gray-100 hover:bg-emerald-50/60 font-semibold text-gray-700"
                  >
                    <td className="px-2 py-1">
                      <span className="flex items-center gap-1">
                        {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                        {row.year}
                      </span>
                    </td>
                    {cells(row)}
                  </tr>
                  {isOpen &&
                    [...row.months.entries()]
                      .sort((a, b) => a[0] - b[0])
                      .map(([m, b]) => (
                        <tr key={`${row.year}-${m}`} className="border-b border-gray-50 text-gray-600 bg-gray-50/50">
                          <td className="pl-7 pr-2 py-1">{MONTHS[m]} {row.year}</td>
                          {cells(b)}
                        </tr>
                      ))}
                </Fragment>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-200 font-bold text-gray-800">
              <td className="px-2 py-1">Total</td>
              {cells(total)}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
