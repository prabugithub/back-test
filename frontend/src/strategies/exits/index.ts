/**
 * User-authored trade-management algorithms — the exit half of the strategy builder.
 *
 * The mirror of `../index.ts` (entry hooks). Same registry shape, same string-id addressing,
 * same reasons for both.
 *
 * ── How to add one ───────────────────────────────────────────────────────────
 *
 *   1. Write a file in this folder exporting an `ExitHook`:
 *
 *        import type { ExitHook } from '../../utils/exitHook';
 *        export const myExit: ExitHook = ctx => {
 *          if (ctx.position.barsInTrade! < 5) return false;          // give it room
 *          if (ctx.position.openPoints > 0) return { exit: false, sl: ctx.position.entryPrice };
 *          return { reason: 'no progress' };                          // close it
 *        };
 *
 *   2. Register it in EXIT_HOOKS below with a stable id.
 *   3. Pick it per regime in the Auto-Backtest panel (Exit step → Custom Exit Hook), and
 *      choose a mode:
 *        'gate'    — the built-in signal exits (Reversal, Opposite Signal) evaluate first;
 *                    your hook gets their verdict as `ctx.pendingExit` and has the final say,
 *                    including vetoing it with `{ exit: false }`
 *        'replace' — the built-in signal exits are skipped entirely; your hook alone decides
 *                    whether the trade closes
 *
 *      Either way the SL/TP touch check and the Pivot Trailing Stop keep running: those are
 *      price levels, not opinions, and a hook that wants the trail off should turn it off.
 *
 * ── The one gotcha ───────────────────────────────────────────────────────────
 *
 * An object return EXITS the trade unless it says `exit: false`. `return { sl: x }` closes
 * the position at the bar's close; `return { exit: false, sl: x }` moves the stop and holds.
 * `return false` always holds (in 'gate' mode it also lets a pending built-in exit stand).
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
 * `ctx.candles` is the last `exitHookLookback` candles (Session Settings → Exit Hook Candles,
 * default 400), oldest-first, ending at the current bar. The hook runs once per bar per open
 * trade, AFTER that bar's SL/TP touch check — so a bar that already stopped out never reaches
 * it, and a stop the hook moves takes effect from the next bar. See utils/exitHook/types.ts
 * for the full shape.
 */
import type { ExitHook, ExitHookEntry } from '../../utils/exitHook';
import { breakevenThenTrail, holdWinners, timeStop } from './example';
import { legDecayExit } from './legDecay';

export const EXIT_HOOKS: Record<string, ExitHookEntry> = {
  'leg-decay': {
    label: 'Leg Decay',
    description: 'Re-grades the newest completed with-trend leg formed after entry (ER, breaks, EMA21 slope, gap-bar) and closes once enough checks fail. The former built-in Leg Decay Exit, now editable.',
    hook: legDecayExit,
  },
  'breakeven-trail': {
    label: 'Breakeven, then ATR Trail',
    description: 'Stop to entry at +1R, then trails 2 ATR behind the best price seen (ratchet only). Cuts any trade still under +0.3R after 20 bars.',
    hook: breakevenThenTrail,
  },
  'time-stop': {
    label: 'Time Stop (30 bars)',
    description: 'Closes anything still open after 30 bars, win or lose. Pairs with Gate mode — the built-in exits keep working, this only caps duration.',
    hook: timeStop,
  },
  'hold-winners': {
    label: 'Hold Winners (veto only)',
    description: 'Gate mode only. Never exits on its own — vetoes a pending Reversal or Opposite-Signal exit while the trade is still up 1.5R or better.',
    hook: holdWinners,
  },
};

/**
 * Register a hook at runtime, replacing any entry under the same id.
 *
 * The static EXIT_HOOKS map above is the normal way in; this exists for the smoke harness,
 * which needs to install throwaway probe hooks. Note EXIT_HOOK_OPTIONS is a snapshot taken at
 * module load, so hooks added this way are resolvable but do not appear in the config
 * dropdown.
 */
export function registerExitHook(id: string, entry: ExitHookEntry): void {
  EXIT_HOOKS[id] = entry;
}

/** Resolve a configured hook id. Unknown ids return undefined — the engine treats that as a
 *  hard stop rather than a silent pass, so a config referencing a deleted hook manages its
 *  trades with NO signal exits at all instead of quietly reverting to the built-in ones. */
export function getExitHook(id: string | undefined | null): ExitHook | undefined {
  if (!id) return undefined;
  return EXIT_HOOKS[id]?.hook;
}

export function getExitHookLabel(id: string | undefined | null): string | undefined {
  if (!id) return undefined;
  return EXIT_HOOKS[id]?.label;
}

/** Dropdown options for the config UI, sorted by label. */
export const EXIT_HOOK_OPTIONS: Array<{ id: string; label: string; description?: string }> =
  Object.entries(EXIT_HOOKS)
    .map(([id, e]) => ({ id, label: e.label, description: e.description }))
    .sort((a, b) => a.label.localeCompare(b.label));
