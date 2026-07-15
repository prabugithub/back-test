import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import type { StepDef } from './RegimeWorkflowSteps';

interface AccordionSectionProps {
  step: StepDef;
  isExpanded: boolean;
  onToggle: () => void;
  /** Passed from the active regime's REGIME_META so the section re-themes per regime tab. */
  accentBg: string;
  accentColor: string;
  children: ReactNode;
}

// Single-open accordion row for the Market/Entry/Confirmation/Exit/Risk workflow —
// replaces the StepNav tab row. Only the expanded section's children are ever passed in,
// so collapsed steps do no work (mirrors the old tab-switcher's unmount-on-inactive behavior).
export function AccordionSection({ step, isExpanded, onToggle, accentBg, accentColor, children }: AccordionSectionProps) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className={`w-full flex items-center gap-2 px-3 py-2.5 text-left transition-colors duration-150 ${
          isExpanded ? `${accentBg} text-white` : `bg-white ${accentColor} hover:bg-gray-50`
        }`}
      >
        {step.icon}
        <span className="text-xs font-semibold flex-1">{step.label}</span>
        {step.badge !== undefined && (
          <span
            className={`text-[9px] font-bold rounded-full px-1.5 min-w-[16px] text-center ${
              isExpanded ? 'bg-white/25 text-white' : 'bg-gray-100 text-gray-500'
            }`}
          >
            {step.badge}
          </span>
        )}
        <ChevronDown size={14} className={`transition-transform duration-150 ${isExpanded ? 'rotate-180' : ''}`} />
      </button>
      {isExpanded && <div className="p-3 border-t border-gray-200">{children}</div>}
    </div>
  );
}
