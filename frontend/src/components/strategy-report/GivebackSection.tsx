import { useMemo, useState } from 'react';
import { CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from 'recharts';
import {
  type ReportFilter, type ReportTrade,
  GIVEBACK_BANDS, computeGiveback, fmtMoney, fmtPct, fmtR, givebackLabel, pnlColor,
} from '../../utils/strategyReport';
import { LowSampleBadge, ShareBar } from './shared';

const POS = '#16a34a'; // green-600 — trade ended in profit
const NEG = '#dc2626'; // red-600  — trade ended in loss
const AXIS = { fontSize: 9, fill: '#9ca3af' };

interface Props {
  rows: ReportTrade[];
  thresholdR: number;
  onThresholdChange: (r: number) => void;
  onDrill: (filters: ReportFilter[]) => void;
  onJump: (tsSec: number) => void;
}

function Kpi({ label, value, sub, tone = 'text-gray-800', title }: { label: string; value: string; sub?: string; tone?: string; title?: string }) {
  return (
    <div className="min-w-[96px]" title={title}>
      <div className="text-[9px] text-gray-400 uppercase tracking-wide">{label}</div>
      <div className={`text-sm font-bold tabular-nums ${tone}`}>{value}</div>
      {sub && <div className="text-[9px] text-gray-400">{sub}</div>}
    </div>
  );
}

interface Point { x: number; y: number; t: ReportTrade }

function ScatterTip({ active, payload, thresholdR }: { active?: boolean; payload?: { payload: Point }[]; thresholdR: number }) {
  if (!active || !payload?.length) return null;
  const { t } = payload[0].payload;
  return (
    <div className="bg-white border border-gray-200 rounded shadow-sm px-2 py-1 text-[10px] leading-4">
      <div className="font-semibold text-gray-800">{t.direction} · {new Date(t.entryTs).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}</div>
      <div className="text-gray-600">{givebackLabel(t.scenario, thresholdR)}</div>
      <div className="text-gray-600">Peak {fmtR(t.mfeR)} ({fmtMoney(t.mfeRs ?? 0)}) → final {fmtR(t.finalR)} ({fmtMoney(t.grossPnl)})</div>
      <div className="text-gray-600">Given back {fmtMoney(-(t.givebackRs ?? 0))} · exit {t.exitRule}</div>
      <div className="text-gray-400">Click to open on the chart</div>
    </div>
  );
}

/**
 * Peak open profit vs what each trade kept. Peak = best high/low strictly between the entry
 * and exit bars (utils/strategyReport attachExcursions); all ₹ here are GROSS of charges.
 */
export function GivebackSection({ rows, thresholdR, onThresholdChange, onDrill, onJump }: Props) {
  const g = useMemo(() => computeGiveback(rows), [rows]);
  // Scatter-only filter: show trades that gave back ≥ minGivebackR (peak − profit kept, in R). 0 = all.
  const [minGivebackR, setMinGivebackR] = useState(0);
  const allPoints = useMemo<Point[]>(
    () => rows.filter(t => t.mfeR !== null && t.finalR !== null).map(t => ({ x: t.mfeR!, y: t.finalR!, t })),
    [rows],
  );
  const points = useMemo(
    () => minGivebackR > 0 ? allPoints.filter(p => p.x - Math.max(p.y, 0) >= minGivebackR) : allPoints,
    [allPoints, minGivebackR],
  );
  const maxX = points.reduce((m, p) => Math.max(m, p.x), 0);

  if (g.measured === 0) {
    return (
      <p className="text-[10px] text-gray-400">
        Peak profit can't be measured: these trades have no initial stop, or their candles aren't loaded (another symbol or date range is on the chart).
      </p>
    );
  }

  const givenShare = g.peakRs > 0 ? g.givebackRs / g.peakRs : null;
  const reachedScen = g.scenarios.filter(s => s.scenario.startsWith('peak→'));
  const scale = g.scenarios.reduce((m, s) => Math.max(m, s.givebackRs), 0);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-2 text-[10px] text-gray-500">
        <label className="flex items-center gap-1">
          Good profit = peak ≥
          <input
            type="number" min={0.1} step={0.25} value={thresholdR}
            onChange={e => { const v = Number(e.target.value); if (v > 0) onThresholdChange(v); }}
            className="w-14 border border-gray-300 rounded px-1 py-0.5 text-[10px] text-gray-800"
          />
          R
        </label>
        <span className="text-gray-400">
          Peak = best high/low between the entry and exit bars (exit bar excluded). ₹ are gross of charges.
          {g.notMeasurable > 0 && ` ${g.notMeasurable} trade(s) not measurable (no stop, or candles not loaded).`}
        </span>
      </div>

      <div className="flex flex-wrap gap-x-5 gap-y-2 rounded-lg bg-amber-50/60 border border-amber-100 px-3 py-2">
        <Kpi label="Peak profit available" value={fmtMoney(g.peakRs)} sub={`${g.measured} trades, sum of each peak`} title="Σ of every trade's best open profit" />
        <Kpi label="Realized (gross)" value={fmtMoney(g.realizedGross)} tone={pnlColor(g.realizedGross)} />
        <Kpi
          label="Given back to market"
          value={fmtMoney(-g.givebackRs)}
          tone="text-red-600"
          sub={givenShare === null ? undefined : `${fmtPct(givenShare)} of peak profit`}
          title="Σ (peak profit − profit kept). A loser's whole peak counts; the loss beyond entry is not added (see 'Swing to exit')."
        />
        <Kpi label="Capture" value={fmtPct(g.capture)} sub="realized ÷ peak" tone={g.capture !== null && g.capture >= 0.5 ? 'text-green-700' : 'text-amber-700'} />
        <Kpi
          label={`Reached ≥ ${thresholdR}R`}
          value={`${g.reachedT} trades`}
          sub={reachedScen.length ? reachedScen.map(s => `${s.n} ${s.scenario.replace('peak→', '→ ')}`).join(' · ') : undefined}
        />
        <Kpi label="…of which given back" value={fmtMoney(-g.reachedTGivebackRs)} tone="text-red-600" sub="by trades that reached good profit" />
      </div>

      <div className="overflow-x-auto mt-2">
        <table className="w-full text-[10px] border-collapse">
          <thead>
            <tr className="text-gray-400 border-b border-gray-200">
              <th className="text-left font-medium pb-1 pl-2">Scenario</th>
              <th className="text-right font-medium pb-1">Trades</th>
              <th className="text-right font-medium pb-1">Avg peak</th>
              <th className="text-right font-medium pb-1">Avg final</th>
              <th className="text-right font-medium pb-1" title="Σ (peak − profit kept)">Profit given back</th>
              <th className="text-right font-medium pb-1" title="Σ (peak − final), including the loss beyond entry">Swing to exit</th>
              <th className="text-right font-medium pb-1">Net P&amp;L</th>
              <th className="text-right font-medium pb-1" title="Average bars from entry to the peak bar">Bars to peak</th>
              <th className="text-right font-medium pb-1" title="Average bars from the peak bar to the exit">Peak → exit</th>
              <th className="text-left font-medium pb-1 pl-3">Given back</th>
            </tr>
          </thead>
          <tbody>
            {g.scenarios.map(s => (
              <tr
                key={s.scenario}
                onClick={() => onDrill([{ dim: 'giveback', value: s.scenario }])}
                className={`border-b border-gray-50 cursor-pointer hover:bg-indigo-50/60 ${s.scenario.startsWith('peak→') ? '' : 'text-gray-500'}`}
              >
                <td className="py-1 pl-2 font-medium text-gray-800">{givebackLabel(s.scenario, thresholdR)}<LowSampleBadge n={s.n} /></td>
                <td className="py-1 text-right tabular-nums">{s.n}</td>
                <td className="py-1 text-right tabular-nums">{fmtR(s.avgPeakR)}</td>
                <td className={`py-1 text-right tabular-nums ${s.avgFinalR === null ? '' : pnlColor(s.avgFinalR)}`}>{fmtR(s.avgFinalR)}</td>
                <td className="py-1 text-right tabular-nums font-semibold text-red-600">{s.givebackRs ? fmtMoney(-s.givebackRs) : '—'}</td>
                <td className="py-1 text-right tabular-nums text-gray-600">{s.swingRs ? fmtMoney(-s.swingRs) : '—'}</td>
                <td className={`py-1 text-right tabular-nums ${pnlColor(s.net)}`}>{fmtMoney(s.net)}</td>
                <td className="py-1 text-right tabular-nums text-gray-600">{s.avgBarsToPeak === null ? '—' : s.avgBarsToPeak.toFixed(0)}</td>
                <td className="py-1 text-right tabular-nums text-gray-600">{s.avgBarsPeakToExit === null ? '—' : s.avgBarsPeakToExit.toFixed(0)}</td>
                <td className="py-1 pl-3"><ShareBar value={-s.givebackRs} scale={scale} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-1 text-[9px] text-gray-400">
          Bands for trades that reached {thresholdR}R: full stop = final ≤ {GIVEBACK_BANDS.stopR}R; breakeven = within ±{GIVEBACK_BANDS.breakevenR}R;
          small profit = kept under {Math.round(GIVEBACK_BANDS.keptCapture * 100)}% of the peak. Click a scenario to drill in.
        </p>
      </div>

      <div className="mt-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-gray-500 mb-1">
          <span>
            Peak R vs final R <span className="text-gray-400">— the diagonal is "exited at the peak"; the further below it, the more was given back. Dashed line = {thresholdR}R.</span>
          </span>
          <label className="flex items-center gap-1 ml-auto" title="Show only trades whose peak − profit kept is at least this many R (a loser's whole peak counts). 0 = all trades.">
            Given back ≥
            <input
              type="number" min={0} step={0.5} value={minGivebackR}
              onChange={e => { const v = Number(e.target.value); if (v >= 0) setMinGivebackR(v); }}
              className="w-14 border border-gray-300 rounded px-1 py-0.5 text-[10px] text-gray-800"
            />
            R
            <span className="text-gray-400 tabular-nums">· {points.length}/{allPoints.length} trades</span>
          </label>
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <ScatterChart margin={{ top: 6, right: 8, left: -16, bottom: 4 }}>
            <CartesianGrid stroke="#f3f4f6" />
            <XAxis type="number" dataKey="x" name="Peak" tick={AXIS} tickLine={false} axisLine={{ stroke: '#e5e7eb' }} tickFormatter={v => `${v}R`} domain={[0, 'auto']} />
            <YAxis type="number" dataKey="y" name="Final" tick={AXIS} tickLine={false} axisLine={false} tickFormatter={v => `${v}R`} />
            <Tooltip content={<ScatterTip thresholdR={thresholdR} />} cursor={{ strokeDasharray: '2 2' }} />
            <ReferenceLine y={0} stroke="#9ca3af" />
            <ReferenceLine x={thresholdR} stroke="#d97706" strokeDasharray="4 3" />
            <ReferenceLine segment={[{ x: 0, y: 0 }, { x: Math.max(maxX, thresholdR), y: Math.max(maxX, thresholdR) }]} stroke="#9ca3af" strokeDasharray="2 2" />
            <Scatter
              data={points}
              isAnimationActive={false}
              onClick={(d: unknown) => {
                const p = (d as { payload?: Point })?.payload;
                if (p) onJump(p.t.entryTsSec);
              }}
              className="cursor-pointer"
            >
              {points.map(p => <Cell key={p.t.id} fill={p.t.grossPnl > 0 ? POS : NEG} fillOpacity={0.7} stroke="#fff" strokeWidth={1} />)}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
