export interface SegmentedOption<V extends string> {
  value: V;
  label: string;
  title?: string;
  /** Overrides the default indigo active look, e.g. green for Long, red for Short. */
  activeClassName?: string;
}

interface SegmentedControlProps<V extends string> {
  value: V;
  onChange: (v: V) => void;
  options: SegmentedOption<V>[];
  size?: 'xs' | 'sm';
  fullWidth?: boolean;
  className?: string;
}

// Generic replacement for the hand-rolled `flex gap-1` segmented-button pattern
// previously duplicated across Direction / Entry Mode / SL Method controls.
export function SegmentedControl<V extends string>({
  value,
  onChange,
  options,
  size = 'xs',
  fullWidth = true,
  className = '',
}: SegmentedControlProps<V>) {
  const sizeClasses = size === 'xs' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 text-[11px]';

  return (
    <div className={`flex gap-1 ${className}`}>
      {options.map(opt => (
        <button
          key={opt.value}
          type="button"
          title={opt.title}
          onClick={() => onChange(opt.value)}
          className={`${fullWidth ? 'flex-1' : ''} ${sizeClasses} rounded border font-medium transition-all duration-150 active:scale-[0.97] ${
            value === opt.value
              ? opt.activeClassName ?? 'bg-indigo-600 text-white border-indigo-600'
              : 'bg-gray-50 text-gray-500 border-gray-300 hover:bg-gray-100'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
