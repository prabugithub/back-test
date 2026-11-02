import { Bug } from 'lucide-react';
import { useSessionStore } from '../../stores/sessionStore';
import { isHookDebugForcedByUrl } from '../../utils/hookDebugMode';
import { installHookDoctor } from '../../utils/hookDoctor';
import { ToggleSwitch } from './ToggleSwitch';

// Attaches __hook.doctor() once, from the UI side. It must not live in strategies/debug.ts,
// which strategies import and the batch Web Worker therefore pulls in — see hookDoctor.ts.
installHookDoctor();

/**
 * Switches the batch backtest from the Web Worker to the main thread, so breakpoints inside
 * a custom entry hook actually pause.
 *
 * Self-contained (reads and writes the store itself) because it is rendered in two places —
 * the panel footer next to the Run button, and inside the Custom Entry Hook card where the
 * strategy work happens. Duplicating the wiring at both call sites is how the two would
 * drift apart.
 */
export function HookDebugToggle({ compact = false }: { compact?: boolean }) {
  const on = useSessionStore(s => s.hookDebugMode);
  const setOn = useSessionStore(s => s.setHookDebugMode);
  const forced = isHookDebugForcedByUrl();

  return (
    <div
      className={`flex items-center gap-2 rounded border px-2 py-1.5 ${
        on ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-slate-50'
      }`}
    >
      <Bug size={12} className={on ? 'text-amber-700 shrink-0' : 'text-gray-400 shrink-0'} />
      <div className="min-w-0 flex-1">
        <div className={`text-[10px] font-semibold ${on ? 'text-amber-800' : 'text-gray-600'}`}>
          Run on main thread
        </div>
        {!compact && (
          <div className="text-[9px] leading-snug text-gray-500">
            {forced
              ? 'Forced on by ?debugHook in the URL — remove it to use this switch.'
              : on
                ? 'Breakpoints in your hook will pause. The UI freezes while the run completes.'
                : 'Turn on to debug a strategy — the worker cannot pause your breakpoints.'}
          </div>
        )}
      </div>
      <ToggleSwitch
        checked={on}
        onChange={setOn}
        activeColor="bg-amber-500"
        disabled={forced}
      />
    </div>
  );
}
