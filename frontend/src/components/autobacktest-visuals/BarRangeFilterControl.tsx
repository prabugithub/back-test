import { BarRangeDominanceDiagram } from './BarRangeDominanceDiagram';

type BarRangeMode = 'none' | 'dominance' | 'min' | 'max';

interface BarRangeFilterControlProps {
  mode: BarRangeMode;
  onModeChange: (mode: BarRangeMode) => void;
  dominanceThreshold: number;
  onDominanceChange: (v: number) => void;
  rangeThreshold: number;
  onRangeChange: (v: number) => void;
  /** Direction-aligned bull/bear average-range ratio computed from loaded data, if available. */
  liveDominance?: number;
  liveRangeAvg?: number;
  onHoverChange?: (hovering: boolean) => void;
}

const MODE_OPTIONS: { value: BarRangeMode; label: string }[] = [
  { value: 'none', label: 'Off' },
  { value: 'dominance', label: 'Bull > Bear' },
  { value: 'min', label: 'Min pts' },
  { value: 'max', label: 'Max pts' },
];

// Bar Range needs two different threshold units depending on mode (a dominance multiplier
// vs. raw price points), which ThresholdFilterControl's single-threshold shape can't express
// cleanly — so it gets its own small control instead of forcing a generic abstraction to fit.
export function BarRangeFilterControl({
  mode,
  onModeChange,
  dominanceThreshold,
  onDominanceChange,
  rangeThreshold,
  onRangeChange,
  liveDominance,
  liveRangeAvg,
  onHoverChange,
}: BarRangeFilterControlProps) {
  return (
    <div
      className="border border-gray-200 rounded-xl p-3 space-y-2 shadow-sm hover:shadow-md hover:border-gray-300 transition-all duration-200"
      onMouseEnter={() => onHoverChange?.(true)}
      onMouseLeave={() => onHoverChange?.(false)}
      onFocus={() => onHoverChange?.(true)}
      onBlur={() => onHoverChange?.(false)}
    >
      <div className="flex items-center justify-between">
        <p
          className="text-[10px] text-gray-400 uppercase tracking-wide font-medium cursor-help"
          title="Average candle size (high-low) over the 'Bar Range' lookback. 'Bull > Bear' requires bars in your trade's direction to be bigger than bars against it, by the multiplier below. Min/Max pts instead gate the overall average bar size in raw points — instrument-scale-dependent."
        >
          Bar Range
        </p>
        {mode === 'dominance' && liveDominance !== undefined && (
          <span className="text-[9px] text-gray-400">
            your data: <span className="font-medium text-gray-500">{liveDominance.toFixed(2)}×</span>
          </span>
        )}
        {(mode === 'min' || mode === 'max') && liveRangeAvg !== undefined && (
          <span className="text-[9px] text-gray-400">
            your data: <span className="font-medium text-gray-500">{liveRangeAvg.toFixed(1)} pts</span>
          </span>
        )}
      </div>

      <div className="flex gap-1">
        {MODE_OPTIONS.map(opt => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onModeChange(opt.value)}
            className={`flex-1 px-1 py-1 text-[10px] rounded border transition-all duration-150 active:scale-95 ${
              mode === opt.value
                ? 'bg-indigo-600 border-indigo-600 text-white font-medium'
                : 'bg-white border-gray-200 text-gray-500 hover:border-indigo-300'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {mode === 'dominance' && (
        <div className="flex items-center gap-2">
          <BarRangeDominanceDiagram dominance={dominanceThreshold} />
          {/* Dominance has only one mode, so no ≥/≤ ambiguity — the × label is unambiguous on its own. */}
          <div className="flex-1 min-w-0">
            <input
              type="range"
              min={1}
              max={3}
              step={0.1}
              value={dominanceThreshold}
              onChange={e => onDominanceChange(Number(e.target.value))}
              className="w-full accent-indigo-600"
            />
            <div className="flex justify-between items-center mt-0.5">
              <span className="text-[9px] text-gray-400">1×</span>
              <input
                type="number"
                min={1}
                max={5}
                step={0.1}
                value={dominanceThreshold}
                onChange={e => onDominanceChange(Number(e.target.value))}
                className="w-14 px-1 py-0.5 text-[10px] border rounded text-center"
              />
              <span className="text-[9px] text-gray-400">3×</span>
            </div>
          </div>
        </div>
      )}

      {(mode === 'min' || mode === 'max') && (
        <div>
          <p className="text-[11px] text-gray-600 mb-1">
            Currently requires: <span className="font-mono font-semibold text-indigo-600">{mode === 'min' ? '≥' : '≤'} {rangeThreshold} pts</span>
          </p>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={rangeThreshold}
            onChange={e => onRangeChange(Number(e.target.value))}
            className="w-full accent-indigo-600"
          />
          <div className="flex justify-between items-center mt-0.5">
            <span className="text-[9px] text-gray-400">0 pts</span>
            <input
              type="number"
              min={0}
              step={1}
              value={rangeThreshold}
              onChange={e => onRangeChange(Number(e.target.value))}
              className="w-14 px-1 py-0.5 text-[10px] border rounded text-center"
            />
            <span className="text-[9px] text-gray-400">100 pts</span>
          </div>
        </div>
      )}
    </div>
  );
}
