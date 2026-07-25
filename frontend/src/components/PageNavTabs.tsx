import { LineChart, ClipboardList, Zap, Activity } from 'lucide-react';

/** Every full-page view the app can switch between. Kept mounted (hidden, not unmounted) once
 * visited so scroll position, filters, expanded rows, etc. survive navigating away and back. */
export type ActivePage = 'chart' | 'tradeLog' | 'backtest' | 'dashboard';

const PAGES: { key: ActivePage; label: string; icon: React.ReactNode }[] = [
  { key: 'chart', label: 'Chart', icon: <LineChart size={14} /> },
  { key: 'tradeLog', label: 'Trade Log', icon: <ClipboardList size={14} /> },
  { key: 'backtest', label: 'Backtest', icon: <Zap size={14} /> },
  { key: 'dashboard', label: 'Dashboard', icon: <Activity size={14} /> },
];

interface PageNavTabsProps {
  active: ActivePage;
  onNavigate: (page: ActivePage) => void;
  className?: string;
}

/** Persistent page switcher rendered in the header of every full-page view (chart controls bar,
 * Trade Log, Backtest, Dashboard) so any page is reachable directly from any other. */
export function PageNavTabs({ active, onNavigate, className = '' }: PageNavTabsProps) {
  return (
    <div className={`flex bg-slate-100 p-1 rounded-lg border border-slate-200 ${className}`}>
      {PAGES.map((p) => (
        <button
          key={p.key}
          onClick={() => onNavigate(p.key)}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-md transition-all ${
            active === p.key ? 'text-blue-700 bg-white shadow-sm' : 'text-slate-500 hover:text-slate-700'
          }`}
          title={p.label}
        >
          {p.icon}
          {p.label}
        </button>
      ))}
    </div>
  );
}
