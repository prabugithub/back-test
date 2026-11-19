/**
 * @backtest-only
 *
 * Custom Exit Hook — public surface.
 *
 * Nothing outside this folder should import from the individual modules. `run.ts` owns the
 * fail-closed validation and `context.ts` owns the causality guarantees on the window;
 * keeping both behind one barrel is what stops a call site from assembling a half-built
 * context or acting on an unvalidated decision.
 *
 * The user-authored hooks themselves live in `src/strategies/exits/`, which is the only
 * directory anyone needs to edit to write a new trade-management algorithm.
 */
export type {
  ExitHook,
  ExitHookContext,
  ExitHookDecision,
  ExitHookEntry,
  ExitHookMode,
  ExitHookResult,
  ExitPositionView,
  PendingExit,
} from './types';

export {
  buildExitHookContext,
  resolveExitHookLookback,
  DEFAULT_EXIT_HOOK_LOOKBACK,
  EXIT_HOOK_LOOKBACK_MIN,
  EXIT_HOOK_LOOKBACK_MAX,
} from './context';
export type { BuildExitHookContextArgs, ExitHookEnv, ExitHookPositionInput } from './context';

export { runExitHook, createExitHookRunState } from './run';
export type { ExitHookRunState, NormalizedExit, RunExitHookArgs } from './run';
