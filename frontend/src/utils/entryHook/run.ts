/**
 * @backtest-only
 *
 * Invokes a user hook and turns whatever it returned into something the engine can book.
 *
 * The validation here FAILS CLOSED, deliberately inverting the "pass on a missing metric"
 * convention the flat `passesXxx` filters follow. That convention is right for a threshold
 * whose input could not be measured; it is wrong for a hand-written algorithm, where an
 * inconsistent stop or a quantity of zero is a bug in the user's code. Booking a malformed
 * trade would quietly corrupt every downstream P&L number, so a decision that does not
 * validate produces no trade at all — and says why.
 */
import type { RegimeRules } from '../autoBacktestEngine';
import type {
  EntryHook,
  EntryHookContext,
  EntryHookDecision,
  EntryHookResult,
} from './types';

/** Per-run state: the scratch object hooks write to, plus trapped-error bookkeeping. */
export interface HookRunState {
  /** Handed to every hook as `ctx.state`; persists across bars within one run. */
  state: Record<string, unknown>;
  /** First trapped exception message, recorded once. */
  error?: string;
  /** How many bars threw. A hook that throws on every bar must not spam or abort the run. */
  errorCount: number;
  /** How many decisions were rejected by validation, and the first reason. */
  rejectedCount: number;
  rejectReason?: string;
}

export function createHookRunState(): HookRunState {
  return { state: {}, errorCount: 0, rejectedCount: 0 };
}

/** The engine's own stop/target for a given side, used as the base a decision overrides. */
export interface HookDefaults {
  /** Returns the engine's sl/tp for this side at this entry price, or null when it cannot
   *  form a valid one (e.g. the computed stop lands on the wrong side of entry). */
  compute(side: 'long' | 'short', entryPrice: number): { sl: number; tp: number } | null;
  entryPrice: number;
}

/** A validated decision, in the shape the engine turns into an AutoSignal. */
export interface NormalizedDecision {
  side: 'long' | 'short';
  entryPrice: number;
  sl: number;
  tp: number;
  /** Absolute quantity when the hook set one; undefined leaves sizing to the engine. */
  quantity?: number;
  /** Replaces the auto-generated reason when the hook set one. */
  reason?: string;
  /** Anything the hook passed to ctx.log(), appended to the Trade's reason. */
  logs: string[];
}

export interface RunEntryHookArgs {
  hook: EntryHook;
  ctx: EntryHookContext;
  rules: Readonly<RegimeRules>;
  defaults: HookDefaults;
  /** Collects ctx.log() output — the same array handed to buildEntryHookContext. */
  logs: string[];
  runState: HookRunState;
}

/**
 * Call the hook and normalize its answer. Returns null for "no trade" — whether because the
 * hook declined, threw, or returned something that does not validate.
 */
export function runEntryHook(args: RunEntryHookArgs): NormalizedDecision | null {
  const { hook, ctx, rules, defaults, logs, runState } = args;

  let result: EntryHookResult;
  try {
    result = hook(ctx);
  } catch (err) {
    runState.errorCount += 1;
    if (runState.error === undefined) {
      const msg = err instanceof Error ? err.message : String(err);
      runState.error = `${ctx.trigger.label} @ bar ${ctx.absoluteIndex}: ${msg}`;
    }
    return null;
  }

  if (result === false || result === null || result === undefined) return null;

  const decision: EntryHookDecision = result === true ? {} : result;
  if (typeof decision !== 'object') {
    return reject(runState, `hook returned ${typeof decision}, expected boolean or object`);
  }
  if (decision.take === false) return null;

  // ── Direction ───────────────────────────────────────────────────────────────
  const side = decision.side ?? ctx.trigger.side;
  if (side !== 'long' && side !== 'short') {
    return reject(runState, `side must be 'long' or 'short', got ${JSON.stringify(decision.side)}`);
  }
  // A hook may fade its trigger, but it may not escape the regime's own direction setting —
  // that is a user-visible switch and silently overriding it would be a surprise.
  if (side === 'long' && rules.direction === 'SHORT_ONLY') return null;
  if (side === 'short' && rules.direction === 'LONG_ONLY') return null;

  // ── Entry price ─────────────────────────────────────────────────────────────
  let entryPrice = defaults.entryPrice;
  if (decision.entryPrice !== undefined) {
    if (!isPositiveFinite(decision.entryPrice)) {
      return reject(runState, `entryPrice must be a positive number, got ${decision.entryPrice}`);
    }
    // A price the trigger bar never traded through could not have filled. Refuse rather
    // than clamp: silently moving a fill is how a backtest starts lying.
    const bar = ctx.candle;
    if (decision.entryPrice > bar.high || decision.entryPrice < bar.low) {
      return reject(runState,
        `entryPrice ${decision.entryPrice} outside bar range [${bar.low}, ${bar.high}]`);
    }
    entryPrice = decision.entryPrice;
  }

  // ── Stop loss ───────────────────────────────────────────────────────────────
  // Defaults are recomputed for the FINAL side: a hook that fades an H trigger into a short
  // must get a short's stop, not the long stop the engine had in hand.
  const base = defaults.compute(side, entryPrice);
  let sl: number;
  if (decision.sl !== undefined) {
    if (!isPositiveFinite(decision.sl)) {
      return reject(runState, `sl must be a positive number, got ${decision.sl}`);
    }
    sl = decision.sl;
  } else if (decision.slPoints !== undefined) {
    if (!isPositiveFinite(decision.slPoints)) {
      return reject(runState, `slPoints must be a positive number, got ${decision.slPoints}`);
    }
    sl = side === 'long' ? entryPrice - decision.slPoints : entryPrice + decision.slPoints;
  } else {
    if (!base) return null; // engine could not form a valid stop here — same as the built-in path
    sl = base.sl;
  }

  const risk = side === 'long' ? entryPrice - sl : sl - entryPrice;
  if (!(risk > 0)) {
    return reject(runState,
      `${side} stop ${sl} is on the wrong side of entry ${entryPrice}`);
  }

  // ── Target ──────────────────────────────────────────────────────────────────
  // Always derived from the FINAL risk, never carried over from `base`: an overridden stop
  // changes the risk, and reusing base.tp would silently retarget a different RR.
  let tp: number;
  if (decision.target !== undefined) {
    if (!isPositiveFinite(decision.target)) {
      return reject(runState, `target must be a positive number, got ${decision.target}`);
    }
    tp = decision.target;
  } else {
    const rr = decision.targetRR ?? rules.targetRR;
    if (!isPositiveFinite(rr)) {
      return reject(runState, `targetRR must be a positive number, got ${rr}`);
    }
    tp = side === 'long' ? entryPrice + risk * rr : entryPrice - risk * rr;
  }

  if (!isPositiveFinite(tp)) {
    return reject(runState, `target resolved to ${tp}`);
  }
  const reward = side === 'long' ? tp - entryPrice : entryPrice - tp;
  if (!(reward > 0)) {
    return reject(runState,
      `${side} target ${tp} is on the wrong side of entry ${entryPrice}`);
  }
  if (sl <= 0) return reject(runState, `stop resolved to ${sl}`);

  // ── Quantity ────────────────────────────────────────────────────────────────
  let quantity: number | undefined;
  if (decision.quantity !== undefined) {
    if (!Number.isFinite(decision.quantity)) {
      return reject(runState, `quantity must be a number, got ${decision.quantity}`);
    }
    quantity = Math.floor(decision.quantity);
    if (quantity < 1) {
      return reject(runState, `quantity ${decision.quantity} floors to ${quantity}, below 1`);
    }
  }

  return {
    side,
    entryPrice,
    sl,
    tp,
    quantity,
    reason: typeof decision.reason === 'string' && decision.reason ? decision.reason : undefined,
    logs: logs.slice(),
  };
}

function reject(runState: HookRunState, why: string): null {
  runState.rejectedCount += 1;
  if (runState.rejectReason === undefined) runState.rejectReason = why;
  return null;
}

function isPositiveFinite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}
