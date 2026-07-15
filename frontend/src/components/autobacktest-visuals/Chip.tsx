import type { ReactNode } from 'react';

export type ChipTone = 'neutral' | 'indigo' | 'green' | 'red' | 'amber' | 'purple' | 'gray-muted';

interface ChipProps {
  children: ReactNode;
  tone?: ChipTone;
  icon?: ReactNode;
  size?: 'xs' | 'sm';
  title?: string;
  onClick?: () => void;
  className?: string;
}

const TONE_CLASSES: Record<ChipTone, string> = {
  neutral: 'bg-gray-100 text-gray-600 border-gray-200',
  indigo: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  green: 'bg-green-50 text-green-700 border-green-200',
  red: 'bg-red-50 text-red-700 border-red-200',
  amber: 'bg-amber-50 text-amber-700 border-amber-200',
  purple: 'bg-purple-50 text-purple-700 border-purple-200',
  'gray-muted': 'bg-gray-50 text-gray-400 border-gray-200',
};

// Small pill used by the Strategy Summary bar and status badges — tone maps to the
// same color pairs already used via REGIME_META for visual consistency.
export function Chip({ children, tone = 'neutral', icon, size = 'xs', title, onClick, className = '' }: ChipProps) {
  const sizeClasses = size === 'xs' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-[11px]';
  const interactive = onClick ? 'cursor-pointer hover:brightness-95 active:scale-95' : '';

  return (
    <span
      title={title}
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-full border font-medium transition-all duration-150 ${sizeClasses} ${TONE_CLASSES[tone]} ${interactive} ${className}`}
    >
      {icon}
      {children}
    </span>
  );
}
