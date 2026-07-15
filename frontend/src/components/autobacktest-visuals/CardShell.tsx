import type { ReactNode } from 'react';

interface CardShellProps {
  children: ReactNode;
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  /** De-emphasizes the card — used for read-only shortcut cards pointing elsewhere. */
  muted?: boolean;
  className?: string;
}

// Single source of truth for the "card" visual language across the Strategy Builder
// redesign — subtle shadow, rounded corners, consistent padding/hover state.
export function CardShell({ children, title, subtitle, action, muted, className = '' }: CardShellProps) {
  return (
    <div
      className={`rounded-xl border border-gray-200 bg-white shadow-sm transition-all duration-200 p-3 ${
        muted ? 'opacity-70' : 'hover:shadow-md hover:border-gray-300'
      } ${className}`}
    >
      {(title || action) && (
        <div className="flex items-start justify-between gap-2 mb-2">
          {title && (
            <div>
              <p className="text-[10px] text-gray-400 uppercase tracking-wide font-medium">{title}</p>
              {subtitle && <p className="text-[10px] text-gray-400 mt-0.5">{subtitle}</p>}
            </div>
          )}
          {action}
        </div>
      )}
      {children}
    </div>
  );
}
