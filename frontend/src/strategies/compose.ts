/**
 * Hook stacking — combine several registered hooks into one, so a new condition can live in
 * its own file and be layered onto a setup that already works without editing it.
 *
 * Built by resolveEntryHook / resolveExitHook from a regime's primary id plus its
 * `entryHookExtraIds` / `exitHookExtraIds`. The engine only ever sees one hook; everything
 * downstream (runEntryHook / runExitHook validation, the Web Worker, trade reasons) is
 * unchanged.
 *
 * ── Semantics ────────────────────────────────────────────────────────────────
 *
 *   Entry (allOfEntry) — AND. Hooks run in order, primary first, and the first that declines
 *   skips the trade; later hooks are NOT called on that bar (so a stateful extra only sees
 *   bars that got that far). Decision objects merge field by field with EARLIER hooks
 *   winning — the primary's side / qty / SL / target are never overridden by a guard.
 *   A throw is not caught here: it reaches runEntryHook's trap and the bar takes no trade.
 *
 *   Exit (anyOfExit) — OR. Every hook runs, each in its own try/catch so a broken extra can
 *   never block the primary's exit. The first hook that wants out wins; an exit beats a
 *   veto. With no exit, any `{ exit: false }` vetoes (gate mode), carrying the TIGHTEST stop
 *   and the first target offered.
 *
 * ── State ────────────────────────────────────────────────────────────────────
 *
 * Each child sees its own `ctx.state` — a stable per-id sub-object of the run's state — so two
 * hooks that happen to use the same key cannot clobber each other. The child context is made
 * with Object.create so the parent's lazy getters (candles, metrics, ...) stay lazy; spreading
 * it would force every expensive build on every bar.
 */
import type { EntryHook, EntryHookContext, EntryHookDecision } from '../utils/entryHook';
import type { ExitHook, ExitHookContext, ExitHookDecision, ExitHookResult } from '../utils/exitHook';

export interface HookPart<H> {
  id: string;
  hook: H;
}

const STACK_STATE_KEY = '__stack';

function childState(state: Record<string, unknown>, id: string): Record<string, unknown> {
  let bag = state[STACK_STATE_KEY] as Record<string, Record<string, unknown>> | undefined;
  if (!bag) {
    bag = {};
    state[STACK_STATE_KEY] = bag;
  }
  let own = bag[id];
  if (!own) {
    own = {};
    bag[id] = own;
  }
  return own;
}

function childCtx<C extends { state: Record<string, unknown> }>(ctx: C, id: string): C {
  return Object.create(ctx, {
    state: { value: childState(ctx.state, id), enumerable: true },
  }) as C;
}

/** AND-stack entry hooks. A single part returns that hook untouched. */
export function allOfEntry(parts: HookPart<EntryHook>[]): EntryHook {
  if (parts.length === 1) return parts[0].hook;
  return (ctx: EntryHookContext) => {
    let merged: EntryHookDecision | null = null;
    for (const { id, hook } of parts) {
      const r = hook(childCtx(ctx, id));
      if (r === false || r === null || r === undefined) return false;
      if (r === true) {
        merged ??= {};
        continue;
      }
      if (typeof r !== 'object') return r; // let runEntryHook reject it with its own message
      if (r.take === false) return false;
      merged ??= {};
      for (const [k, v] of Object.entries(r) as [keyof EntryHookDecision, unknown][]) {
        if (k === 'take' || v === undefined) continue;
        if (merged[k] === undefined) (merged as Record<string, unknown>)[k] = v;
      }
    }
    return merged ?? false;
  };
}

/** OR-stack exit hooks. A single part returns that hook untouched. */
export function anyOfExit(parts: HookPart<ExitHook>[]): ExitHook {
  if (parts.length === 1) return parts[0].hook;
  return (ctx: ExitHookContext) => {
    const isLong = ctx.position.side === 'long';
    let firstExit: ExitHookResult | undefined;
    let vetoed = false;
    let sl: number | undefined;
    let target: number | undefined;

    for (const { id, hook } of parts) {
      let r: ExitHookResult;
      try {
        r = hook(childCtx(ctx, id));
      } catch (err) {
        ctx.log(`${id} threw: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
      if (r === false || r === null || r === undefined) continue;
      if (r === true || typeof r !== 'object' || r.exit !== false) {
        firstExit ??= r;
        continue;
      }
      // An explicit hold: a veto, possibly carrying stop/target moves.
      vetoed = true;
      if (typeof r.sl === 'number') {
        if (sl === undefined || (isLong ? r.sl > sl : r.sl < sl)) sl = r.sl;
      }
      if (typeof r.target === 'number' && target === undefined) target = r.target;
    }

    if (firstExit !== undefined) return firstExit;
    if (!vetoed) return false;
    const hold: ExitHookDecision = { exit: false };
    if (sl !== undefined) hold.sl = sl;
    if (target !== undefined) hold.target = target;
    return hold;
  };
}
