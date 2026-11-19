import { useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { type ReportTrade, fmtMoney } from '../../utils/strategyReport';

const POS = '#16a34a'; // green-600 — profit
const NEG = '#dc2626'; // red-600  — loss
const LINE = '#4f46e5'; // indigo-600 — the single equity series
const AXIS = { fontSize: 9, fill: '#9ca3af' };

/** R-multiple histogram (0.5R bins, clamped to ±5R) and the equity curve of the rows in view. */
export function Distribution({ rows }: { rows: ReportTrade[] }) {
  const hist = useMemo(() => {
    const withR = rows.filter(r => r.r !== null);
    if (withR.length === 0) return [];
    const bins = new Map<number, number>();
    for (const t of withR) {
      const b = Math.max(-5, Math.min(5, Math.floor(t.r! * 2) / 2));
      bins.set(b, (bins.get(b) ?? 0) + 1);
    }
    const lo = Math.min(...bins.keys());
    const hi = Math.max(...bins.keys());
    const out: { bin: number; label: string; count: number }[] = [];
    for (let b = lo; b <= hi + 1e-9; b += 0.5) {
      const k = Math.round(b * 2) / 2;
      out.push({ bin: k, label: `${k >= 0 ? '+' : ''}${k}R`, count: bins.get(k) ?? 0 });
    }
    return out;
  }, [rows]);

  const equity = useMemo(() => {
    const out: { i: number; equity: number; date: string }[] = [];
    let cum = 0;
    for (const t of [...rows].sort((a, b) => a.exitTs - b.exitTs)) {
      cum += t.pnl;
      out.push({ i: out.length + 1, equity: Math.round(cum), date: new Date(t.exitTs).toLocaleDateString('en-IN') });
    }
    return out;
  }, [rows]);

  if (rows.length === 0) return null;

  return (
    <div className="grid grid-cols-1 @3xl:grid-cols-2 gap-3">
      <div>
        <div className="text-[10px] text-gray-500 mb-1">R-multiple distribution <span className="text-gray-400">(0.5R bins, ends clamped at ±5R)</span></div>
        {hist.length === 0 ? (
          <p className="text-[10px] text-gray-400">No trades with an initial stop — R cannot be computed.</p>
        ) : (
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={hist} margin={{ top: 4, right: 4, left: -24, bottom: 0 }} barCategoryGap={2}>
              <CartesianGrid vertical={false} stroke="#f3f4f6" />
              <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={{ stroke: '#e5e7eb' }} interval="preserveStartEnd" />
              <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip
                cursor={{ fill: '#eef2ff' }}
                contentStyle={{ fontSize: 10, padding: '4px 8px' }}
                formatter={(v) => [`${v} trades`, 'Count']}
                labelFormatter={(_, p) => {
                  const b = p?.[0]?.payload?.bin as number | undefined;
                  return b === undefined ? '' : `${b}R to ${b + 0.5}R`;
                }}
              />
              <ReferenceLine x="+0R" stroke="#9ca3af" strokeDasharray="2 2" />
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                {hist.map(h => <Cell key={h.bin} fill={h.bin >= 0 ? POS : NEG} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
      <div>
        <div className="text-[10px] text-gray-500 mb-1">Equity curve <span className="text-gray-400">(cumulative P&amp;L, trade by trade)</span></div>
        <ResponsiveContainer width="100%" height={140}>
          <LineChart data={equity} margin={{ top: 4, right: 4, left: 8, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="#f3f4f6" />
            <XAxis dataKey="i" tick={AXIS} tickLine={false} axisLine={{ stroke: '#e5e7eb' }} />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} tickFormatter={v => `${Math.round(Number(v) / 1000)}k`} />
            <Tooltip
              contentStyle={{ fontSize: 10, padding: '4px 8px' }}
              formatter={(v) => [fmtMoney(Number(v)), 'Equity']}
              labelFormatter={(l, p) => `Trade #${l}${p?.[0]?.payload?.date ? ` · ${p[0].payload.date}` : ''}`}
            />
            <ReferenceLine y={0} stroke="#9ca3af" />
            <Line type="monotone" dataKey="equity" stroke={LINE} strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
