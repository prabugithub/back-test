/**
 * @backtest-only
 *
 * Invokes a user exit hook and turns whatever it returned into something the engine can act
 * on — an exit, a stop/target move, or nothing.
 *
 * Validation FAILS CLOSED, the same inversion of the `passesXxx` convention that
 * entryHook/run.ts makes, but the closed position is different on each half of the answer:
 *
 *   • an invalid EXIT is refused — the trade stays open. Booking a fill at a price the bar
 *     never traded is how a backtest starts lying.
 *   • an invalid ADJUSTMENT is dropped — the stop and target keep the values they had. A
 *     stop on the wrong side of price would fire instantly on the next bar and book a
 *     fictional loss.
 *
 * Both halves are validated independently, so a decision with a good exit and a nonsense
 * stop still exits (the stop is irrelevant once the trade is closed), and one with a good
 * stop and a nonsense price holds with the stop moved.
 */
import type {
  ExitHook,
  ExitHookContext,
  ExitHookDecision,
  ExitHookResult,
} from './types';

/** Per-run state: the scratch object hooks write to, plus trapped-error bookkeeping.
 *  Structurally identical to the entry hook's HookRunState and deliberately a separate type —
 *  the two are threaded through the engine independently and reported separately, and
 *  sharing one would make "called 0×" ambiguous about which hook. */
export interface ExitHookRunState {
  /** Handed to every hook as `ctx.state`; persists across bars AND across open trades. */
  state: Record<string, unknown>;
  /** How many (bar, position) pairs actually reached the hook. 0 means no trade was ever
   *  open under a regime with the hook on — a configuration problem, not a logic one. */
  callCount: number;
  /** First trapped exception message, recorded once. */
  error?: string;
  /** How many calls threw. A hook that throws every bar must not spam or abort the run. */
  errorCount: number;
  /** How many decisions (or halves of one) were rejected by validation, and the first why. */
  rejectedCount: number;
  rejectReason?: string;
}

export function createExitHookRunState(): ExitHookRunState {
  return { state: {}, callCount: 0, errorCount: 0, rejectedCount: 0 };
}

/** A validated exit decision. `exit` and `adjust` are independent — either, both, or neither. */
export interface NormalizedExit {
  /** The trade closes this bar. */
  exit: { fillPrice: number; detail: string } | null;
  /** Stop/target moves to apply, whether or not the trade closes. */
  adjust: { stopLoss?: number; target?: number } | null;
  /** True when the hook explicitly vetoed a pending built-in exit (`{ exit: false }`).
   *  Distinct from a silent `false`, which lets the pending exit stand. */
  veto: boolean;
}

export interface RunExitHookArgs {
  hook: ExitHook;
  ctx: ExitHookContext;
  /** Collects ctx.log() output — the same array handed to buildExitHookContext. */
  logs: string[];
  runState: ExitHookRunState;
}

/**
 * Call the hook and normalize its answer. Never throws; a hook that does is trapped, counted,
 * and treated as having said nothing.
 */
export function runExitHook(args: RunExitHookArgs): NormalizedExit {
  const { hook, ctx, logs, runState } = args;
  const nothing: NormalizedExit = { exit: null, adjust: null, veto: false };

  // Counted before the call, so a hook that throws on its very first bar still registers as
  // having been reached — otherwise "0 calls" would wrongly point at the configuration.
  runState.callCount += 1;

  let result: ExitHookResult;
  try {
    result = hook(ctx);
  } catch (err) {
    runState.errorCount += 1;
    if (runState.error === undefined) {
      const msg = err instanceof Error ? err.message : String(err);
      runState.error = `bar ${ctx.absoluteIndex}: ${msg}`;
    }
    return nothing;
  }

  if (result === false || result === null || result === undefined) return nothing;

  const bar = ctx.candle;
  if (result === true) {
    return { exit: { fillPrice: bar.close, detail: detailFrom(undefined, logs) }, adjust: null, veto: false };
  }

  const decision: ExitHookDecision = result;
  if (typeof decision !== 'object') {
    reject(runState, `hook returned ${typeof decision}, expected boolean or object`);
    return nothing;
  }

  // ── Stop / target adjustments ───────────────────────────────────────────────
  // Validated first and independently of the exit: they survive an exit that does not.
  const close = bar.close;
  const isLong = ctx.position.side === 'long';
  const adjust: { stopLoss?: number; target?: number } = {};

  if (decision.sl !== undefined) {
    if (!isPositiveFinite(decision.sl)) {
      reject(runState, `sl must be a positive number, got ${decision.sl}`);
    } else if (isLong ? decision.sl >= close : decision.sl <= close) {
      // A stop already through price fires on the very next bar for a loss that never
      // happened. Refuse rather than clamp.
      reject(runState, `${ctx.position.side} stop ${decision.sl} is on the wrong side of close ${close}`);
    } else {
      adjust.stopLoss = decision.sl;
    }
  }

  if (decision.target !== undefined) {
    if (!isPositiveFinite(decision.target)) {
      reject(runState, `target must be a positive number, got ${decision.target}`);
    } else if (isLong ? decision.target <= close : decision.target >= close) {
      reject(runState, `${ctx.position.side} target ${decision.target} is on the wrong side of close ${close}`);
    } else {
      adjust.target = decision.target;
    }
  }

  const adjustOut = adjust.stopLoss !== undefined || adjust.target !== undefined ? adjust : null;

  // ── Exit ────────────────────────────────────────────────────────────────────
  // Defaults to TRUE, matching the entry hook's `take`. A hook that only meant to trail must
  // say `exit: false`; the registry descriptions and types.ts both call this out.
  if (decision.exit === false) {
    return { exit: null, adjust: adjustOut, veto: true };
  }

  let fillPrice = close;
  if (decision.price !== undefined) {
    if (!isPositiveFinite(decision.price)) {
      reject(runState, `price must be a positive number, got ${decision.price}`);
      return { exit: null, adjust: adjustOut, veto: false };
    }
    // A price the bar never traded through could not have filled.
    if (decision.price > bar.high || decision.price < bar.low) {
      reject(runState, `price ${decision.price} outside bar range [${bar.low}, ${bar.high}]`);
      return { exit: null, adjust: adjustOut, veto: false };
    }
    fillPrice = decision.price;
  }

  return {
    exit: { fillPrice, detail: detailFrom(decision.reason, logs) },
    adjust: adjustOut,
    veto: false,
  };
}

/** Fold the hook's reason and ctx.log() output into the exit's detail string. */
function detailFrom(reason: string | undefined, logs: string[]): string {
  const head = typeof reason === 'string' && reason ? reason : 'hook exit';
  return logs.length > 0 ? `${head} | ${logs.join(' ; ')}` : head;
}

function reject(runState: ExitHookRunState, why: string): void {
  runState.rejectedCount += 1;
  if (runState.rejectReason === undefined) runState.rejectReason = why;
}

function isPositiveFinite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}
