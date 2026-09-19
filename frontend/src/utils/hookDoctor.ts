/**
 * `__hook.doctor()` — answers "why is nothing happening?" in one call.
 *
 * Walks every gate between pressing Run and your hook body executing, in the order the
 * engine applies them, and prints the first one that is blocking. Written because the
 * failure modes are genuinely indistinguishable from the outside: a hook silenced by a
 * structure filter, a hook running on the worker while the breakpoint sits on the main
 * thread, a mode set with no hook selected, and a hook that simply declined every bar all
 * look identical — "the run finished and nothing changed".
 *
 * ── Why this is NOT in strategies/debug.ts ──────────────────────────────────
 *
 * `debug.ts` holds `probe()`, which strategies call — so it is reachable from the batch Web
 * Worker. This module imports the session store (and through it the whole app), which must
 * never be pulled into the worker bundle: it bloats the worker, and a dynamic import here
 * forces code-splitting that Vite's `worker.format: 'iife'` cannot do, breaking the
 * production build outright. Data collection is worker-safe; app introspection is UI-only.
 * Keep that split.
 */
import { useSessionStore } from '../stores/sessionStore';
import { getEntryHook } from '../strategies';
import { getExitHook } from '../strategies/exits';
import { hookProbeStore } from '../strategies/debug';
import { resolveEntryHook, resolveExitHook, type RegimeKey } from './autoBacktestEngine';

function line(ok: boolean | null, label: string, fix?: string): void {
  const mark = ok === null ? '•' : ok ? '✅' : '❌';
  console.log(`${mark} ${label}${!ok && fix ? `\n     → ${fix}` : ''}`);
}

function doctor(): void {
  const s = useSessionStore.getState();
  console.log('%c── entry hook doctor ──', 'font-weight:bold');

  line(s.candles.length > 0, `candles loaded (${s.candles.length})`, 'Load data first.');
  line(s.autoBacktestConfig.enabled, 'auto-backtest is enabled',
    'Flip the Running/Off switch in the panel header.');
  line(s.hookDebugMode, `batch runs on the ${s.hookDebugMode ? 'MAIN THREAD' : 'WORKER'}`,
    'Breakpoints CANNOT pause while the worker runs it. Turn on "Run on main thread".');

  const regimes = ['uptrend', 'downtrend', 'range', 'reversal'] as RegimeKey[];
  const enabled = regimes.filter(k => s.autoBacktestConfig[k].enabled);
  const hooked = enabled.filter(k => resolveEntryHook(s.autoBacktestConfig[k]) !== null);
  const unhooked = enabled.filter(k => resolveEntryHook(s.autoBacktestConfig[k]) === null);

  for (const k of regimes) {
    const r = s.autoBacktestConfig[k];
    const resolved = resolveEntryHook(r);
    if (!resolved) continue;
    console.log(`  ── regime "${k}" · mode ${resolved.mode} · id "${resolved.id}"`);
    line(r.enabled, '  regime enabled', `Turn "${k}" Active in the Market step.`);
    line(!!getEntryHook(resolved.id), `  hook "${resolved.id}" is registered`,
      'Not in ENTRY_HOOKS — this regime takes NO trades. Check src/strategies/index.ts.');
    line((r.htStructureFilter ?? 'any') === 'any', `  HT Structure is Any (${r.htStructureFilter})`,
      'Runs BEFORE the hook — signals outside this structure never reach your code.');
    line((r.ltStructureFilter ?? 'any') === 'any', `  LT Structure is Any (${r.ltStructureFilter ?? 'any'})`,
      'Same — runs before the hook.');
    line(r.direction === 'BOTH', `  direction is ${r.direction}`,
      'A LONG_ONLY regime discards every short your hook returns (and vice versa).');
    if (resolved.mode === 'gate') {
      line(r.entryMode !== 'PIVOT', `  entryMode is ${r.entryMode}`,
        'In Gate mode, Pivot restricts the hook to bars that are BOTH a pivot and an H/L signal.');
    }
  }

  // Mode set with no hook behind it — identity, and the commonest "my filter did nothing".
  const modeNoId = enabled.filter(k => {
    const r = s.autoBacktestConfig[k];
    return (r.entryHookMode ?? 'off') !== 'off' && resolveEntryHook(r) === null;
  });
  if (modeNoId.length > 0) {
    line(false, `mode set but NO hook selected on: ${modeNoId.join(', ')}`,
      'This runs the built-in filters, so results are identical to having no hook. Pick one from the dropdown.');
  }

  if (hooked.length === 0) {
    line(false, 'no enabled regime has a usable hook',
      'Entry step → Custom Entry Hook → set mode to Gate or Replace AND pick a hook.');
  } else if (unhooked.length > 0) {
    // Hooks are per-regime; the others keep trading their own built-in rules.
    line(false, `only ${hooked.join(', ')} uses a hook — ${unhooked.join(', ')} still run the built-in filters`,
      'Their trades land in the same log and are not yours. Disable them, or set the hook on them too.');
  }

  const d = s.lastHookDiagnostics;
  if (!d) {
    console.log('•  no hooked run recorded yet — press Run Full Backtest.');
  } else {
    line(d.callCount > 0, `last run: hook called ${d.callCount}×`,
      'Never reached — a gate above is blocking it, not your logic.');
    if (d.errorCount > 0) line(false, `  ${d.errorCount} threw`, d.error);
    if (d.rejectedCount > 0) line(false, `  ${d.rejectedCount} rejected`, d.rejectReason);
    if (d.callCount > 0 && d.errorCount === 0 && d.rejectedCount === 0) {
      console.log(`•  your hook ran ${d.callCount}× cleanly. Check Trade History: entries it made carry "[hook:<id>]" in the entry sign.`);
    }
  }
  console.log(`•  probe rows captured: ${hookProbeStore.rows.length} (add probe(ctx) to your hook to populate)`);

  exitSection(s);
}

/**
 * The exit half. Kept as its own block rather than folded into the loop above because the
 * gates are genuinely different: an exit hook is not filtered by market structure or entry
 * mode at all — it runs on every bar a trade is open — so almost every "nothing happened"
 * on this side traces back to no trade having been opened in the first place.
 */
function exitSection(s: ReturnType<typeof useSessionStore.getState>): void {
  const regimes = ['uptrend', 'downtrend', 'range', 'reversal'] as RegimeKey[];
  const enabled = regimes.filter(k => s.autoBacktestConfig[k].enabled);
  const hooked = enabled.filter(k => resolveExitHook(s.autoBacktestConfig[k]) !== null);

  console.log('%c── exit hook ──', 'font-weight:bold');

  if (hooked.length === 0) {
    const modeNoId = enabled.filter(k => {
      const r = s.autoBacktestConfig[k];
      return (r.exitHookMode ?? 'off') !== 'off' && resolveExitHook(r) === null;
    });
    if (modeNoId.length > 0) {
      line(false, `mode set but NO exit hook selected on: ${modeNoId.join(', ')}`,
        'This runs the built-in exits, so results are identical to having no exit hook. Pick one from the dropdown.');
    } else {
      console.log('•  no exit hook configured — Exit step → Custom Exit Hook.');
    }
    return;
  }

  for (const k of hooked) {
    const r = s.autoBacktestConfig[k];
    const resolved = resolveExitHook(r)!;
    console.log(`  ── regime "${k}" · mode ${resolved.mode} · id "${resolved.id}"`);
    line(!!getExitHook(resolved.id), `  hook "${resolved.id}" is registered`,
      'Not in EXIT_HOOKS — this regime runs NO signal exits. Check src/strategies/exits/index.ts.');
    if (resolved.mode === 'gate') {
      const builtIns = (r.exitOnReversal ?? false) || (r.exitOnOppSignal ?? false);
      line(builtIns, '  a built-in signal exit is on for Gate mode to gate',
        'With Reversal and Opposite Signal both off there is never a pendingExit — Gate and Replace behave identically.');
    }
  }

  // Exit hooks are per-regime too, and a trade is managed by the regime that OPENED it.
  const unhooked = enabled.filter(k => resolveExitHook(s.autoBacktestConfig[k]) === null);
  if (unhooked.length > 0) {
    line(false, `only ${hooked.join(', ')} uses an exit hook — trades opened by ${unhooked.join(', ')} are managed by the built-in exits`,
      'A trade is managed by the regime that opened it for its whole life. Set the hook on those too, or disable them.');
  }

  const d = s.lastExitHookDiagnostics;
  if (!d) {
    console.log('•  no run with an exit hook recorded yet — press Run Full Backtest.');
    return;
  }
  line(d.callCount > 0, `last run: exit hook called ${d.callCount}×`,
    'Never reached — it only runs while a trade is OPEN, so check the entry side took trades in this regime at all.');
  if (d.errorCount > 0) line(false, `  ${d.errorCount} threw`, d.error);
  if (d.rejectedCount > 0) line(false, `  ${d.rejectedCount} rejected`, d.rejectReason);
  if (d.callCount > 0 && d.errorCount === 0 && d.rejectedCount === 0) {
    console.log(`•  your exit hook ran ${d.callCount}× cleanly. Exits it made carry reason EXIT_HOOK in Trade History.`);
  }
}

/** Attaches `doctor()` onto the existing `window.__hook` store. Called once from the UI. */
export function installHookDoctor(): void {
  if (typeof window === 'undefined') return;
  (window.__hook as unknown as { doctor: () => void }).doctor = doctor;
}
