/**
 * User-authored entry algorithms.
 *
 * ── How to add one ───────────────────────────────────────────────────────────
 *
 *   1. Write a file in this folder exporting an `EntryHook`:
 *
 *        import type { EntryHook } from '../utils/entryHook';
 *        export const myEntry: EntryHook = ctx => {
 *          if (ctx.trigger.count < 3) return false;      // H3+ / L3+ only
 *          if (ctx.metrics.efficiencyRatio! < 0.4) return false;
 *          return { side: 'short', quantity: 50, slPoints: 30, targetRR: 2.5 };
 *        };
 *
 *   2. Register it in ENTRY_HOOKS below with a stable id.
 *   3. Pick it per regime in the Auto-Backtest panel (Entry step → Custom Entry Hook),
 *      and choose a mode:
 *        'gate'    — the built-in filter chain runs first; your hook has the final say
 *                    and can still override side/qty/SL/target
 *        'replace' — the entire built-in chain is skipped; every H/L signal bar goes
 *                    straight to your hook
 *
 * ── Why a registry and not a function on the config ──────────────────────────
 *
 * The batch simulator runs in a Web Worker and receives only the SERIALIZED config through
 * postMessage. A function cannot cross that boundary, so the config carries a string id and
 * the worker resolves it against this map, which it imports itself. That also means the ids
 * are persisted in saved configurations: renaming one silently disables every saved config
 * that referenced it. Prefer adding a new id over renaming an old one.
 *
 * ── What the hook can rely on ────────────────────────────────────────────────
 *
 * `ctx.candles` is the last `entryHookLookback` candles (Session Settings → Custom Entry
 * Hook, default 1200), oldest-first, ending at the trigger bar. Nothing reachable from
 * `ctx` describes a bar after the trigger. See utils/entryHook/types.ts for the full shape.
 */
import type { EntryHook, EntryHookEntry } from '../utils/entryHook';
import { deepPullbackContinuation, takeEverySignal } from './example';

export const ENTRY_HOOKS: Record<string, EntryHookEntry> = {
  'deep-pullback': {
    label: 'Deep Pullback Continuation',
    description: 'H2+/L2+ with the structure, clean breakout leg, stop beyond the pullback extreme.',
    hook: deepPullbackContinuation,
  },
  'take-every-signal': {
    label: 'Take Every Signal (baseline)',
    description: 'Enters on every H/L signal at any count, using the engine\'s own SL/TP/sizing.',
    hook: takeEverySignal,
  },
};

/**
 * Register a hook at runtime, replacing any entry under the same id.
 *
 * The static ENTRY_HOOKS map above is the normal way in; this exists for the smoke harness,
 * which needs to install throwaway probe hooks, and for anything that generates a hook
 * rather than authoring it. Note ENTRY_HOOK_OPTIONS is a snapshot taken at module load, so
 * hooks added this way are resolvable but do not appear in the config dropdown.
 */
export function registerEntryHook(id: string, entry: EntryHookEntry): void {
  ENTRY_HOOKS[id] = entry;
}

/** Resolve a configured hook id. Unknown ids return undefined — the engine treats that as
 *  a hard stop rather than a silent pass, so a config referencing a deleted hook takes no
 *  trades instead of quietly reverting to the built-in chain. */
export function getEntryHook(id: string | undefined | null): EntryHook | undefined {
  if (!id) return undefined;
  return ENTRY_HOOKS[id]?.hook;
}

export function getEntryHookLabel(id: string | undefined | null): string | undefined {
  if (!id) return undefined;
  return ENTRY_HOOKS[id]?.label;
}

/** Dropdown options for the config UI, sorted by label. */
export const ENTRY_HOOK_OPTIONS: Array<{ id: string; label: string; description?: string }> =
  Object.entries(ENTRY_HOOKS)
    .map(([id, e]) => ({ id, label: e.label, description: e.description }))
    .sort((a, b) => a.label.localeCompare(b.label));
