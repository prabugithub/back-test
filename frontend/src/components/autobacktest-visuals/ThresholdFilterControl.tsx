import type { ReactNode } from 'react';

export interface ModeOption<M extends string> {
  value: M;
  /** Plain-language caption — mirrors the option text the old <select> used, no math notation. */
  label: string;
}

interface ThresholdFilterControlProps<M extends string> {
  label: string;
  tooltip: string;
  mode: M;
  offValue: M;
  modeOptions: ModeOption<M>[];
  onModeChange: (mode: M) => void;
  threshold: number;
  onThresholdChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  /** Actual value computed from the currently loaded candles — shown as a tick on the slider. */
  liveValue?: number;
  formatValue?: (v: number) => string;
  onHoverChange?: (hovering: boolean) => void;
  /** Illustrative diagram for the current threshold, supplied by the caller. */
  diagram: ReactNode;
}

// Replaces the old <select> mode + <input type="number"> threshold pair used ~9x in
// AutoBacktestPanel.tsx with segmented mode buttons + a slider whose diagram redraws live,
// so the number never has to be read/typed to understand what it means.
export function ThresholdFilterControl<M extends string>({
  label,
  tooltip,
  mode,
  offValue,
  modeOptions,
  onModeChange,
  threshold,
  onThresholdChange,
  min,
  max,
  step,
  liveValue,
  formatValue = v => v.toFixed(2),
  onHoverChange,
  diagram,
}: ThresholdFilterControlProps<M>) {
  const isActive = mode !== offValue;
  const liveValuePct =
    liveValue !== undefined && max > min ? Math.min(100, Math.max(0, ((liveValue - min) / (max - min)) * 100)) : null;
  // 'min' filters always mean "at least X" and 'max' filters "at most X" (see passesXxx
  // functions in autoBacktestEngine.ts) — this holds across every filter that uses this
  // control, so the operator can be inferred from the mode value itself.
  const operator = String(mode) === 'min' ? '≥' : String(mode) === 'max' ? '≤' : null;

  return (
    <div
      className="border border-gray-200 rounded-lg p-2 space-y-2"
      onMouseEnter={() => onHoverChange?.(true)}
      onMouseLeave={() => onHoverChange?.(false)}
      onFocus={() => onHoverChange?.(true)}
      onBlur={() => onHoverChange?.(false)}
    >
      <div className="flex items-center justify-between">
        <p className="text-[10px] text-gray-400 uppercase tracking-wide font-medium cursor-help" title={tooltip}>
          {label}
        </p>
        {isActive && liveValuePct !== null && (
          <span className="text-[9px] text-gray-400">
            your data: <span className="font-medium text-gray-500">{formatValue(liveValue!)}</span>
          </span>
        )}
      </div>

      <div className="flex gap-1">
        {modeOptions.map(opt => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onModeChange(opt.value)}
            className={`flex-1 px-1.5 py-1 text-[10px] rounded border transition-colors ${
              mode === opt.value
                ? 'bg-indigo-600 border-indigo-600 text-white font-medium'
                : 'bg-white border-gray-200 text-gray-500 hover:border-indigo-300'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {isActive && operator && (
        <p className="text-[11px] text-gray-600">
          Currently requires: <span className="font-mono font-semibold text-indigo-600">{operator} {formatValue(threshold)}</span>
        </p>
      )}

      {isActive && (
        <div className="flex items-center gap-2">
          {diagram}
          <div className="flex-1 min-w-0">
            <div className="relative">
              <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={threshold}
                onChange={e => onThresholdChange(Number(e.target.value))}
                className="w-full accent-indigo-600"
              />
              {liveValuePct !== null && (
                <div
                  className="absolute top-1/2 -translate-y-1/2 w-0.5 h-2.5 bg-amber-500 pointer-events-none"
                  style={{ left: `${liveValuePct}%` }}
                  title="Where your loaded data currently sits"
                />
              )}
            </div>
            <div className="flex justify-between items-center mt-0.5">
              <span className="text-[9px] text-gray-400">{formatValue(min)}</span>
              <input
                type="number"
                min={min}
                max={max}
                step={step}
                value={threshold}
                onChange={e => onThresholdChange(Number(e.target.value))}
                className="w-14 px-1 py-0.5 text-[10px] border rounded text-center"
              />
              <span className="text-[9px] text-gray-400">{formatValue(max)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
