import { PivotSequenceStaircase } from './PivotSequenceStaircase';

interface PivotSequencePatternPickerProps {
  label: string;
  tooltip: string;
  filter: 'none' | 'custom' | undefined;
  onFilterChange: (v: 'none' | 'custom') => void;
  patterns: string[];
  selectedPatterns: string[];
  onTogglePattern: (pattern: string) => void;
  onHoverChange?: (hovering: boolean) => void;
}

// Replaces the plain "HH-HH-HH-HH" text checklist with the same button grid, but each
// button now shows a mini staircase (PivotSequenceStaircase) so the shape of the swing
// history is visible at a glance, not just its four-letter code.
export function PivotSequencePatternPicker({
  label,
  tooltip,
  filter,
  onFilterChange,
  patterns,
  selectedPatterns,
  onTogglePattern,
  onHoverChange,
}: PivotSequencePatternPickerProps) {
  const isCustom = (filter ?? 'none') === 'custom';

  return (
    <div
      className="border border-gray-200 rounded-xl p-3 space-y-2 shadow-sm hover:shadow-md hover:border-gray-300 transition-all duration-200"
      onMouseEnter={() => onHoverChange?.(true)}
      onMouseLeave={() => onHoverChange?.(false)}
      onFocus={() => onHoverChange?.(true)}
      onBlur={() => onHoverChange?.(false)}
    >
      <p className="text-[10px] text-gray-400 uppercase tracking-wide font-medium cursor-help" title={tooltip}>
        {label}
      </p>

      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => onFilterChange('none')}
          className={`flex-1 px-1.5 py-1 text-[10px] rounded border transition-all duration-150 active:scale-95 ${
            !isCustom ? 'bg-indigo-600 border-indigo-600 text-white font-medium' : 'bg-white border-gray-200 text-gray-500 hover:border-indigo-300'
          }`}
        >
          Off
        </button>
        <button
          type="button"
          onClick={() => onFilterChange('custom')}
          className={`flex-1 px-1.5 py-1 text-[10px] rounded border transition-all duration-150 active:scale-95 ${
            isCustom ? 'bg-indigo-600 border-indigo-600 text-white font-medium' : 'bg-white border-gray-200 text-gray-500 hover:border-indigo-300'
          }`}
        >
          Pick patterns
        </button>
      </div>

      {isCustom && (
        <div className="grid grid-cols-4 gap-1">
          {patterns.map(p => {
            const active = selectedPatterns.includes(p);
            return (
              <button
                key={p}
                type="button"
                onClick={() => onTogglePattern(p)}
                title={p}
                className={`flex flex-col items-center gap-0.5 px-1 py-1 rounded border transition-all duration-150 active:scale-95 ${
                  active ? 'bg-indigo-50 border-indigo-400' : 'bg-white border-gray-200 hover:border-indigo-300'
                }`}
              >
                <PivotSequenceStaircase pattern={p} />
                <span className={`text-[8px] leading-none ${active ? 'text-indigo-600 font-medium' : 'text-gray-400'}`}>{p}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
