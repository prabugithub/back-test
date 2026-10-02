import { Plus, Trash2 } from 'lucide-react';
import { SegmentedControl } from '../SegmentedControl';
import { DEFAULT_RUN_MIN_BRR, type RunCond, type RunSide } from '../../../utils/legPattern';

interface RunCondEditorProps {
  runs: RunCond[];
  onChange: (runs: RunCond[]) => void;
}

/**
 * "N consecutive candles clearing a body-to-range threshold."
 *
 * The only bar-level condition in the engine and usually the most selective one — and the
 * one most likely to match nothing, because real legs are shorter and messier than the
 * ones people picture. On the reference dataset the median bull impulse leg's longest run
 * at BRR ≥ 0.8 was ZERO.
 */
export function RunCondEditor({ runs, onChange }: RunCondEditorProps) {
  const patch = (i: number, p: Partial<RunCond>) =>
    onChange(runs.map((r, k) => (k === i ? { ...r, ...p } : r)));

  return (
    <div className="rounded-lg border border-gray-200 p-2 space-y-1.5">
      <div className="flex items-center justify-between">
        <p className="text-[10px] text-gray-400 uppercase tracking-wide font-medium cursor-help"
           title="Consecutive candles inside the segment whose body-to-range ratio clears the cutoff. Needs per-candle data, which the engine requests automatically when a run condition is present.">
          Conviction runs
        </p>
        <button type="button"
                onClick={() => onChange([...runs, { minBrr: DEFAULT_RUN_MIN_BRR, minRun: 2, side: 'same' }])}
                className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded border border-gray-300 text-gray-600 hover:bg-gray-100">
          <Plus size={11} /> Add
        </button>
      </div>

      {runs.length === 0 && <p className="text-[9px] text-gray-400">None — the segment's candles are not inspected individually.</p>}

      {runs.map((r, i) => (
        <div key={i} className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[9px] text-gray-500">at least</span>
          <input
            type="number" min={1} max={10} step={1} value={r.minRun ?? 2}
            onChange={e => patch(i, { minRun: Math.max(1, Number(e.target.value)) })}
            className="w-11 px-1 py-0.5 text-[10px] border rounded text-center"
          />
          <span className="text-[9px] text-gray-500">candles at BRR ≥</span>
          <input
            type="number" min={0} max={1} step={0.05} value={r.minBrr ?? DEFAULT_RUN_MIN_BRR}
            onChange={e => patch(i, { minBrr: Math.min(1, Math.max(0, Number(e.target.value))) })}
            className="w-14 px-1 py-0.5 text-[10px] border rounded text-center"
          />
          <SegmentedControl<RunSide>
            value={r.side ?? 'same'}
            onChange={v => patch(i, { side: v })}
            options={[
              { value: 'same', label: 'with it', title: "In the segment's own direction." },
              { value: 'opposite', label: 'against', title: 'Counter-direction candles inside the segment.' },
              { value: 'any', label: 'either', title: 'Direction ignored.' },
            ]}
            fullWidth={false}
          />
          <button type="button" onClick={() => onChange(runs.filter((_, k) => k !== i))}
                  className="p-1 text-gray-400 hover:text-red-600 ml-auto">
            <Trash2 size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
