/**
 * @backtest-only
 *
 * Leg-pattern engine — the rule tree, compiled once and evaluated per bar.
 *
 * Sections are AND-ed and ordered cheapest-and-most-selective first: window-aggregate
 * clauses are a handful of scalar comparisons and typically reject most windows, so the
 * positional matcher then runs over far fewer of them.
 *
 * `explain()` is not optional polish. A spec that matches zero windows is the NORMAL
 * failure mode of this engine, and per-section verdicts are the only way to see which
 * section did the killing — and, separately, whether it killed on evidence or on missing
 * data. Both ship in the first pass.
 */
import { buildLegWindow, type LegWindow } from './adapter';
import { computeAggregates, retracePct, type WindowAggregates } from './aggregates';
import { compileLegList, compileWindowClause, type EvalCtx } from './compile';
import { describeLegPattern } from './describe';
import { scoreWindow } from './score';
import {
  DEFAULT_LEG_STRENGTH,
  LegPatternConfigError,
  clampLegPatternConfig,
  legPatternActive,
  patternNeedsPerCandle,
  patternNeedsScores,
  type LegPatternConfig,
  type WindowClause,
} from './schema';

export type VerdictSection = 'config' | 'window' | 'direction' | 'legs' | 'retrace';

export interface Verdict {
  section: VerdictSection;
  pass: boolean;
  detail: string;
  /** Conditions that could not be evaluated. Non-zero here means "your data is
   *  incomplete", which looks identical to "your spec is too tight" from pass/fail alone. */
  unknown: number;
}

export interface Matcher {
  test(window: LegWindow, isLong: boolean): boolean;
  explain(window: LegWindow, isLong: boolean): Verdict[];
  describe(): string;
  /** Run conditions and `maxRun` need the per-candle arrays. The caller uses this to build
   *  its sequence at 'full' detail rather than reporting unknown on every bar. */
  needsPerCandle: boolean;
  /** Composite scoring is only worth its cost when something actually reads a score. */
  needsScores: boolean;
  /** Impulse legs the window must hold for the pattern to be evaluable at all. */
  requiredLegs: number;
  /** Set when the config could not be honoured. A matcher in this state REJECTS every
   *  window — see the note in compileLegPattern. */
  error?: string;
}

interface Prepared {
  ctx: EvalCtx;
  agg: WindowAggregates;
}

/** Everything derived from a window that any section might read, computed once. */
function prepare(window: LegWindow, needsScores: boolean, legStrength: number): Prepared {
  const scores = needsScores ? scoreWindow(window) : null;
  return {
    ctx: {
      feats: window.features,
      impulseIndices: window.impulseIndices,
      scores,
      unknown: 0,
    },
    agg: computeAggregates(window, scores, legStrength),
  };
}

function compileTree(cfg: LegPatternConfig) {
  const windowTests: Array<{ clause: WindowClause; test: (a: WindowAggregates) => boolean }> = [];
  for (const clause of cfg.window ?? []) {
    const test = compileWindowClause(clause);
    if (test) windowTests.push({ clause, test });
  }

  const opts = { sideBasis: cfg.sideBasis ?? ('realized' as const) };
  const legs = compileLegList(cfg.legs ?? [], opts);
  const direction = cfg.direction && cfg.direction !== 'any' ? cfg.direction : null;
  const retrace = cfg.retrace?.enabled ? cfg.retrace : null;
  return { windowTests, legs, direction, retrace };
}

function evaluate(
  tree: ReturnType<typeof compileTree>,
  cfg: LegPatternConfig,
  window: LegWindow,
  isLong: boolean,
  needsScores: boolean,
  verdicts: Verdict[] | null
): boolean {
  const { ctx, agg } = prepare(window, needsScores, cfg.thresholds?.legStrength ?? DEFAULT_LEG_STRENGTH);
  let ok = true;

  // 1. Window aggregates — cheap and selective, so they go first.
  for (const { clause, test } of tree.windowTests) {
    const pass = test(agg);
    verdicts?.push({
      section: 'window',
      pass,
      detail: `${clause.field} ${clause.op} ${JSON.stringify(clause.value)} — actual ${agg[clause.field] ?? 'unmeasurable'}`,
      unknown: 0,
    });
    if (!pass) {
      if (!verdicts) return false;
      ok = false;
    }
  }

  // 2. Direction.
  if (tree.direction) {
    const pass = tree.direction === 'long' ? isLong : !isLong;
    verdicts?.push({
      section: 'direction',
      pass,
      detail: `pattern is ${tree.direction}-only, this signal is ${isLong ? 'long' : 'short'}`,
      unknown: 0,
    });
    if (!pass) {
      if (!verdicts) return false;
      ok = false;
    }
  }

  // 3. The ordered leg positions.
  if (tree.legs) {
    const before = ctx.unknown;
    const have = window.impulseIndices.length;
    const pass = tree.legs.test(ctx);
    verdicts?.push({
      section: 'legs',
      pass,
      detail: have < tree.legs.requiredLegs
        ? `window holds ${have} impulse leg${have === 1 ? '' : 's'}, the pattern names ${tree.legs.requiredLegs}`
        : pass
          ? `all ${tree.legs.requiredLegs} positions matched`
          : `one of the ${tree.legs.requiredLegs} positions did not match (window has ${have} legs)`,
      unknown: ctx.unknown - before,
    });
    if (!pass) {
      if (!verdicts) return false;
      ok = false;
    }
  }

  // 4. Retrace at the current bar.
  if (tree.retrace) {
    const pct = retracePct(window, tree.retrace.windowLegs, isLong);
    // NaN fails this comparison naturally — an unmeasurable window is excluded, not
    // waved through.
    const pass = pct <= tree.retrace.maxPct;
    verdicts?.push({
      section: 'retrace',
      pass,
      detail: Number.isNaN(pct)
        ? 'window has no height — retrace is unmeasurable'
        : `retraced ${pct.toFixed(1)}% of the recent range, ceiling ${tree.retrace.maxPct}%`,
      unknown: Number.isNaN(pct) ? 1 : 0,
    });
    if (!pass) {
      if (!verdicts) return false;
      ok = false;
    }
  }

  return ok;
}

/**
 * Compile a config into a matcher. Returns **null** when the pattern constrains nothing —
 * an unconfigured tree compiles to no predicate at all, and callers read null as "every
 * window matches" without paying for a pass. The engine must be a no-op until configured.
 *
 * A config that cannot be honoured (unsupported version, malformed blocks) does NOT throw
 * and does not brick the enclosing session restore. It returns a matcher whose `error` is
 * set and whose `test` REJECTS every window: the user asked for a filter, so trading on as
 * though no filter existed is the one outcome that must not happen silently. The error
 * string is surfaced in explain() and in the UI.
 */
export function compileLegPattern(raw: LegPatternConfig | undefined | null): Matcher | null {
  if (!raw || !raw.enabled) return null;

  let cfg: LegPatternConfig;
  try {
    cfg = clampLegPatternConfig(raw);
  } catch (e) {
    const message = e instanceof LegPatternConfigError ? e.message : String(e);
    return {
      test: () => false,
      explain: () => [{ section: 'config', pass: false, detail: message, unknown: 1 }],
      describe: () => `Configuration error — ${message}`,
      needsPerCandle: false,
      needsScores: false,
      requiredLegs: 0,
      error: message,
    };
  }

  if (!legPatternActive(cfg)) return null;

  const tree = compileTree(cfg);
  const needsScores = patternNeedsScores(cfg);
  const needsPerCandle = patternNeedsPerCandle(cfg);
  const described = describeLegPattern(cfg);

  return {
    test: (window, isLong) => evaluate(tree, cfg, window, isLong, needsScores, null),
    explain: (window, isLong) => {
      const verdicts: Verdict[] = [];
      evaluate(tree, cfg, window, isLong, needsScores, verdicts);
      return verdicts;
    },
    describe: () => described,
    needsPerCandle,
    needsScores,
    requiredLegs: tree.legs?.requiredLegs ?? 0,
  };
}

/**
 * Compile once, evaluate many.
 *
 * Keyed on the config OBJECT IDENTITY. The regime editor spreads `RegimeRules` on every
 * keystroke, but `rules.legPattern`'s identity survives edits to unrelated fields — so an
 * unrelated keystroke does not recompile, and a batch run over a frozen config compiles
 * exactly once for the whole run.
 */
const matcherCache = new WeakMap<LegPatternConfig, { matcher: Matcher | null }>();

export function getMatcher(cfg: LegPatternConfig | undefined | null): Matcher | null {
  if (!cfg) return null;
  const hit = matcherCache.get(cfg);
  if (hit) return hit.matcher;
  const matcher = compileLegPattern(cfg);
  matcherCache.set(cfg, { matcher });
  return matcher;
}

export { buildLegWindow };
export type { LegWindow };
