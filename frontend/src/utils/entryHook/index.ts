/**
 * @backtest-only
 *
 * Custom Entry Hook — public surface.
 *
 * Nothing outside this folder should import from the individual modules. `run.ts` owns the
 * fail-closed validation and `context.ts` owns the causality guarantees on the window;
 * keeping both behind one barrel is what stops a call site from assembling a half-built
 * context or booking an unvalidated decision.
 *
 * The user-authored hooks themselves live in `src/strategies/`, which is the only directory
 * anyone needs to edit to write a new algorithm.
 */
export type {
  EntryHook,
  EntryHookContext,
  EntryHookDecision,
  EntryHookEntry,
  EntryHookMode,
  EntryHookResult,
  HookTrigger,
} from './types';

export {
  buildEntryHookContext,
  hookTriggerAt,
  parseTrigger,
  resolveHookLookback,
  DEFAULT_ENTRY_HOOK_LOOKBACK,
  ENTRY_HOOK_LOOKBACK_MIN,
  ENTRY_HOOK_LOOKBACK_MAX,
} from './context';
export type { BuildHookContextArgs } from './context';

export { runEntryHook, createHookRunState } from './run';
export type { HookDefaults, HookRunState, NormalizedDecision, RunEntryHookArgs } from './run';
