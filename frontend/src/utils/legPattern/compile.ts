/**
 * @backtest-only
 *
 * Leg-pattern engine — the compiler.
 *
 * Compile once (at config change), evaluate many (per candidate bar). Every compiled
 * predicate closes over its thresholds, so per window the cost is one pass over as many
 * positions as the pattern names — typically two or three.
 *
 * THE PATTERN IS POSITIONAL, and that is what makes this file small. `legs[0]` is the most
 * recent impulse leg, `legs[1]` the one before it: each slot binds to a fixed position, so
 * there is no search, no backtracking, no assignment space to bound and no gap budget to
 * spend. "This is the most recent leg" is not a rule you write — it is what index 0 means.
 *
 * One property to preserve: `boundsTest` returns **null**, not an always-true predicate,
 * when a field constrains nothing. That lets the compiler skip the field entirely rather
 * than paying a no-op call per leg per bar over the whole history.
 */
import { IMPULSE, PULLBACK, maxRunIn, type LegFeature } from './adapter';
import {
  DEFAULT_RUN_MIN_BRR,
  NUMERIC_FIELDS,
  boundsConstrains,
  conditionsConstrain,
  legRuleConstrains,
  pullbackRuleConstrains,
  runCondConstrains,
  type Bounds,
  type LegRule,
  type LegSlot,
  type NumericField,
  type PullbackRule,
  type RunSide,
  type WindowClause,
} from './schema';
import type { WindowAggregates } from './aggregates';

/** Mutable per-evaluation state. Compile-time knowledge (thresholds, sideBasis) is closed
 *  over instead; only what changes per bar lives here. */
export interface EvalCtx {
  feats: LegFeature[];
  /** Feature indices of the impulse legs, newest-first — the addressing scheme. */
  impulseIndices: number[];
  /** Composite scores index-aligned with `feats`, or null when scoring was not run —
   *  in which case a `legScore` condition is UNKNOWN. */
  scores: number[] | null;
  /** Count of conditions that could not be evaluated. Unknown FAILS the condition and is
   *  counted, so `explain()` can tell "your spec is too tight" apart from "your data is
   *  incomplete". Both look identical from the pass/fail alone. */
  unknown: number;
}

/** Lets a nested pullback rule supply a depth measured against its OWN slot's leg,
 *  instead of the generic second-pass value. */
export interface FieldOverride {
  depthRatio?: number;
}

export type LegPred = (ctx: EvalCtx, j: number, override?: FieldOverride) => boolean;

export interface CompileOptions {
  sideBasis: 'realized' | 'struct';
}

// ─── Bounds ───────────────────────────────────────────────────────────────────

/** Returns null when the bounds constrain nothing — see the header note. NaN fails every
 *  comparison here naturally, which is exactly the wanted behaviour for an unmeasurable
 *  quantity: excluded, not waved through. */
export function boundsTest(b: Bounds | undefined): ((v: number) => boolean) | null {
  const hasMin = Number.isFinite(b?.min as number);
  const hasMax = Number.isFinite(b?.max as number);
  if (!hasMin && !hasMax) return null;
  const min = b!.min as number;
  const max = b!.max as number;
  if (hasMin && hasMax) return v => v >= min && v <= max;
  if (hasMin) return v => v >= min;
  return v => v <= max;
}

// ─── Field resolution ─────────────────────────────────────────────────────────

/** Sentinel for a field that exists in the schema but cannot be measured on this segment
 *  with the data at hand. Distinct from 0. */
const UNKNOWN = Symbol('unknown');
type Resolved = number | typeof UNKNOWN;

function resolveField(
  field: NumericField,
  f: LegFeature,
  basisDir: 1 | 0 | -1,
  ctx: EvalCtx,
  j: number,
  override?: FieldOverride
): Resolved {
  switch (field) {
    case 'candles': return f.barCount;
    case 'movePct': return f.absMovePct;
    case 'avgBrr': return f.brr;
    case 'avgDirClv': return f.dirClv;
    case 'breakPersist': return f.breakPersist;
    case 'breakCount': return basisDir >= 0 ? f.highBreakCount : f.lowBreakCount;
    case 'maxBreakRun': return basisDir >= 0 ? f.maxHighBreakRun : f.maxLowBreakRun;
    case 'rangeRatio': return f.rangeRatio;
    // maxRun is derived from the per-candle arrays. Without them it would report 0 and
    // fail silently — indistinguishable from a leg that was measured and found flat.
    case 'maxRun': return f.brrArr && f.dirArr ? f.maxRun : UNKNOWN;
    case 'depthRatio': return override?.depthRatio ?? f.depthRatio;
    case 'legScore': return ctx.scores ? ctx.scores[j] : UNKNOWN;
  }
}

function resolveRunSide(side: RunSide, legDir: 1 | -1): 1 | 0 | -1 {
  switch (side) {
    case 'same': return legDir;
    case 'opposite': return legDir === 1 ? -1 : 1;
    case 'bull': return 1;
    case 'bear': return -1;
    case 'any': return 0;
  }
}

// ─── LegRule ──────────────────────────────────────────────────────────────────

/**
 * Conditions on ONE segment. Returns null when the rule constrains nothing.
 *
 * `sideBasis` picks whether `side` and the direction-dependent fields read the segment's
 * STRUCTURAL intent or its REALIZED displacement. These legitimately disagree often enough
 * to change results, which is why it is a knob rather than an implementation detail.
 */
export function compileLegRule(rule: LegRule, opts: CompileOptions): LegPred | null {
  if (!legRuleConstrains(rule)) return null;

  const wantKind = rule.kind && rule.kind !== 'any' ? (rule.kind === 'pullback' ? PULLBACK : IMPULSE) : null;
  const wantSide = rule.side && rule.side !== 'any' ? rule.side : null;
  const struct = opts.sideBasis === 'struct';

  const fieldTests: Array<{ field: NumericField; test: (v: number) => boolean }> = [];
  for (const def of NUMERIC_FIELDS) {
    const t = boundsTest(rule[def.key]);
    if (t) fieldTests.push({ field: def.key, test: t });
  }

  const runConds = (rule.runs ?? []).filter(runCondConstrains).map(r => ({
    minBrr: Number.isFinite(r.minBrr as number) ? (r.minBrr as number) : DEFAULT_RUN_MIN_BRR,
    minRun: r.minRun as number,
    side: (r.side ?? 'same') as RunSide,
  }));

  return (ctx, j, override) => {
    const f = ctx.feats[j];
    if (!f) return false;

    if (wantKind !== null && f.kind !== wantKind) return false;

    const basisDir = struct ? f.structDir : f.realizedDir;
    if (wantSide === 'bull' && !(basisDir > 0)) return false;
    if (wantSide === 'bear' && !(basisDir < 0)) return false;

    for (const { field, test } of fieldTests) {
      const v = resolveField(field, f, basisDir, ctx, j, override);
      if (v === UNKNOWN) {
        ctx.unknown++;
        return false;
      }
      if (!test(v)) return false;
    }

    if (runConds.length > 0) {
      const legDir: 1 | -1 = basisDir >= 0 ? 1 : -1;
      for (const rc of runConds) {
        const best = maxRunIn(f, rc.minBrr, resolveRunSide(rc.side, legDir));
        if (best < 0) {
          ctx.unknown++;
          return false;
        }
        if (best < rc.minRun) return false;
      }
    }

    return true;
  };
}

// ─── Slot: one position, its leg, and the retrace that followed it ────────────

/**
 * ONE position in the pattern: the leg conditions AND the conditions on the pullback that
 * FOLLOWED that leg.
 *
 * `j` here is a SEGMENT index (the caller resolves `legs[k]` through `impulseIndices`).
 * The window is newest-first, so the retrace that came after the leg at `j` sits at `j-1`.
 *
 * `depthRatio` inside the nested block is measured against THIS slot's leg and passed down
 * as an override, so it is exact by construction rather than depending on the generic
 * "next older impulse" second pass.
 *
 * Returns null when the slot constrains nothing — a wildcard position, which still has to
 * EXIST (the caller enforces that) but places no test on the leg occupying it.
 */
export function compileLegSlot(slot: LegSlot, opts: CompileOptions): LegPred | null {
  // A slot always addresses an impulse leg — that is what the index counts.
  const legTest = compileLegRule({ ...slot, kind: 'impulse', side: slot.side ?? 'any' }, opts);

  const pb: PullbackRule | null = pullbackRuleConstrains(slot.pullback) ? slot.pullback! : null;
  if (!pb) return legTest;

  const presence = pb.presence ?? 'required';
  const allowForming = pb.allowForming !== false;
  // Force kind: the nested block describes a pullback by definition. `side` stays whatever
  // the caller set (default 'any') — legSequence tags a pullback with the direction
  // OPPOSITE the leg it retraces, so pinning it to the leg's own side matches nothing.
  const pbTest = conditionsConstrain(pb) || (pb.side && pb.side !== 'any')
    ? compileLegRule({ ...pb, kind: 'pullback', side: pb.side ?? 'any' }, opts)
    : null;

  return (ctx, j, override) => {
    if (legTest && !legTest(ctx, j, override)) return false;

    const p = j - 1; // the retrace that FOLLOWED this leg
    const present = p >= 0 && ctx.feats[p]?.kind === PULLBACK;

    if (!present) {
      // Two ways to be absent: nothing newer exists, or the next segment is another leg
      // (legs are adjacent when the builder found no gap). 'forbidden' wants exactly this.
      return presence !== 'required';
    }
    if (presence === 'forbidden') return false;

    const pbFeat = ctx.feats[p];
    if (pbFeat.isForming && !allowForming) return false;

    if (!pbTest) return true;

    const leg = ctx.feats[j];
    const depthRatio = leg.absMovePct > 0 ? pbFeat.absMovePct / leg.absMovePct : NaN;
    return pbTest(ctx, p, { depthRatio });
  };
}

// ─── The positional leg list ──────────────────────────────────────────────────

export type LegListPred = (ctx: EvalCtx) => boolean;

export interface CompiledLegList {
  test: LegListPred;
  /** How many impulse legs the window must hold for this pattern to be evaluable. */
  requiredLegs: number;
}

/**
 * The whole ordered pattern: `legs[0]` against the most recent impulse leg, `legs[1]`
 * against the one before it, and so on.
 *
 * A window holding fewer impulse legs than there are slots REJECTS the bar and counts an
 * unknown. "There are only two legs and you described three" is not a match — and letting
 * it through would quietly admit half-formed windows nobody described.
 *
 * Returns null when there are no slots at all.
 */
export function compileLegList(slots: LegSlot[], opts: CompileOptions): CompiledLegList | null {
  if (!slots || slots.length === 0) return null;
  const compiled = slots.map(s => compileLegSlot(s, opts));

  return {
    requiredLegs: slots.length,
    test: ctx => {
      if (ctx.impulseIndices.length < compiled.length) {
        ctx.unknown++;
        return false;
      }
      for (let k = 0; k < compiled.length; k++) {
        const test = compiled[k];
        if (!test) continue; // wildcard position — it exists, nothing more is asked
        if (!test(ctx, ctx.impulseIndices[k])) return false;
      }
      return true;
    },
  };
}

// ─── Window clauses ───────────────────────────────────────────────────────────

/**
 * Coarse conditions on the whole-window aggregates. Cheap and typically very selective, so
 * these run before the positional matcher does.
 *
 * An aggregate of `undefined` is UNMEASURABLE. `is-null` accepts it, `not-null` rejects it,
 * and every numeric operator rejects it — the same convention as an unknown leg field, and
 * deliberately unlike the surrounding `passesXxx` gates in autoBacktestEngine.ts, which
 * pass on missing data. Those guard warm-up gaps; here the window exists and the quantity
 * genuinely has no value, so waving it through would silently widen the filter.
 */
export function compileWindowClause(clause: WindowClause): ((agg: WindowAggregates) => boolean) | null {
  const { field, op } = clause;
  const raw = clause.value;

  if (op === 'is-null') return agg => agg[field] === undefined;
  if (op === 'not-null') return agg => agg[field] !== undefined;

  if (op === 'between') {
    const arr = Array.isArray(raw) ? raw : [];
    if (arr.length < 2 || !Number.isFinite(arr[0]) || !Number.isFinite(arr[1])) return null;
    const lo = Math.min(arr[0], arr[1]);
    const hi = Math.max(arr[0], arr[1]);
    return agg => {
      const v = agg[field];
      return v !== undefined && v >= lo && v <= hi;
    };
  }

  if (op === 'in') {
    const arr = (Array.isArray(raw) ? raw : []).filter(Number.isFinite);
    if (arr.length === 0) return null;
    return agg => {
      const v = agg[field];
      return v !== undefined && arr.includes(v);
    };
  }

  if (!Number.isFinite(raw as number)) return null;
  const n = raw as number;
  switch (op) {
    case 'eq': return agg => agg[field] === n;
    case 'neq': return agg => agg[field] !== undefined && agg[field] !== n;
    case 'gte': return agg => agg[field] !== undefined && (agg[field] as number) >= n;
    case 'gt': return agg => agg[field] !== undefined && (agg[field] as number) > n;
    case 'lte': return agg => agg[field] !== undefined && (agg[field] as number) <= n;
    case 'lt': return agg => agg[field] !== undefined && (agg[field] as number) < n;
    default: return null;
  }
}

/** Exposed so the UI can grey out a clause that will never be applied. */
export function windowClauseConstrains(c: WindowClause): boolean {
  return compileWindowClause(c) !== null;
}

export { conditionsConstrain, boundsConstrains };
