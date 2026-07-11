import type { ReactNode } from 'react';

export interface ModePickerOption<M extends string> {
  value: M;
  label: string;
}

interface ModePickerControlProps<M extends string> {
  label: string;
  tooltip: string;
  mode: M;
  /** When set, the diagram is hidden for this value (treated as "no filter"). */
  offValue?: M;
  modeOptions: ModePickerOption<M>[];
  onModeChange: (mode: M) => void;
  /** Diagram for the current mode — return null/undefined to render nothing. */
  diagram?: (mode: M) => ReactNode;
  onHoverChange?: (hovering: boolean) => void;
  /** Use a tighter grid instead of a single row when there are many options (e.g. pivot patterns). */
  gridCols?: number;
}

// Sibling to ThresholdFilterControl for filters that pick a category rather than a numeric
// threshold (MA position, pivot sequence, HT structure) — segmented buttons + an optional
// illustrative diagram, no slider.
export function ModePickerControl<M extends string>({
  label,
  tooltip,
  mode,
  offValue,
  modeOptions,
  onModeChange,
  diagram,
  onHoverChange,
  gridCols,
}: ModePickerControlProps<M>) {
  const showDiagram = diagram && mode !== offValue;
  const rendered = showDiagram ? diagram(mode) : null;

  return (
    <div
      className="border border-gray-200 rounded-lg p-2 space-y-2"
      onMouseEnter={() => onHoverChange?.(true)}
      onMouseLeave={() => onHoverChange?.(false)}
      onFocus={() => onHoverChange?.(true)}
      onBlur={() => onHoverChange?.(false)}
    >
      <p className="text-[10px] text-gray-400 uppercase tracking-wide font-medium cursor-help" title={tooltip}>
        {label}
      </p>

      <div className={gridCols ? `grid gap-1` : 'flex gap-1'} style={gridCols ? { gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))` } : undefined}>
        {modeOptions.map(opt => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onModeChange(opt.value)}
            className={`px-1.5 py-1 text-[10px] rounded border transition-colors ${!gridCols ? 'flex-1' : ''} ${
              mode === opt.value
                ? 'bg-indigo-600 border-indigo-600 text-white font-medium'
                : 'bg-white border-gray-200 text-gray-500 hover:border-indigo-300'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {rendered && <div className="flex justify-center">{rendered}</div>}
    </div>
  );
}
