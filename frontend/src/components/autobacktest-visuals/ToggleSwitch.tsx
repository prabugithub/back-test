interface ToggleSwitchProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  size?: 'sm' | 'md';
  /** Tailwind bg-* class applied when checked. Defaults to indigo. */
  activeColor?: string;
  disabled?: boolean;
}

const TRACK_SIZE = { sm: 'w-9 h-5', md: 'w-10 h-5' };
const THUMB_TRANSLATE = { sm: 'translate-x-4', md: 'translate-x-5' };

// Extracts the hand-built toggle-switch divs previously duplicated for the regime
// Enable toggle and the header's global Enabled toggle.
export function ToggleSwitch({ checked, onChange, size = 'sm', activeColor = 'bg-indigo-600', disabled }: ToggleSwitchProps) {
  return (
    <div
      role="switch"
      aria-checked={checked}
      onClick={() => !disabled && onChange(!checked)}
      className={`relative ${TRACK_SIZE[size]} rounded-full transition-colors duration-200 ${
        disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
      } ${checked ? activeColor : 'bg-gray-300'}`}
    >
      <div
        className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform duration-200 ${
          checked ? THUMB_TRANSLATE[size] : ''
        }`}
      />
    </div>
  );
}
