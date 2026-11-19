import { type Stats, LOW_SAMPLE } from '../../utils/strategyReport';

/** Win rate with its Wilson 95% interval drawn as a band behind the point estimate. */
export function WinRateCI({ s }: { s: Stats }) {
  if (s.n === 0) return <span className="text-gray-300">—</span>;
  return (
    <div className="flex items-center gap-1.5" title={`${s.wins}W / ${s.losses}L — 95% CI ${s.ciLow.toFixed(0)}–${s.ciHigh.toFixed(0)}%`}>
      <span className="w-8 text-right font-semibold text-gray-800 tabular-nums">{s.winRate.toFixed(0)}%</span>
      <div className="relative w-16 h-2 bg-gray-100 rounded-full">
        <div
          className="absolute h-2 bg-indigo-200 rounded-full"
          style={{ left: `${s.ciLow}%`, width: `${Math.max(2, s.ciHigh - s.ciLow)}%` }}
        />
        <div className="absolute top-[-1px] w-0.5 h-2.5 bg-indigo-700" style={{ left: `calc(${s.winRate}% - 1px)` }} />
      </div>
    </div>
  );
}

export function LowSampleBadge({ n }: { n: number }) {
  if (n === 0 || n >= LOW_SAMPLE) return null;
  return (
    <span
      className="ml-1 px-1 rounded bg-gray-100 text-[9px] text-gray-500 font-medium"
      title={`Only ${n} trades — win rate and PF are not reliable below ${LOW_SAMPLE}`}
    >
      low n
    </span>
  );
}

/** Share of total |P&L| as a small two-sided bar: green right for profit, red left for loss. */
export function ShareBar({ value, scale }: { value: number; scale: number }) {
  const w = scale > 0 ? Math.min(100, (Math.abs(value) / scale) * 100) : 0;
  return (
    <div className="flex w-24 h-2">
      <div className="w-1/2 flex justify-end bg-gray-50 rounded-l-full overflow-hidden">
        {value < 0 && <div className="h-2 bg-red-400 rounded-l-full" style={{ width: `${w}%` }} />}
      </div>
      <div className="w-px bg-gray-300" />
      <div className="w-1/2 bg-gray-50 rounded-r-full overflow-hidden">
        {value > 0 && <div className="h-2 bg-green-500 rounded-r-full" style={{ width: `${w}%` }} />}
      </div>
    </div>
  );
}

export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mt-4 mb-1.5">
      <h4 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">{children}</h4>
      {right}
    </div>
  );
}
