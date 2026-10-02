/**
 * @backtest-only
 *
 * Leg-pattern rule engine — configuration schema.
 *
 * The engine answers one question: "does the price action leading into this bar match a
 * shape I described?" over the leg sequence `buildLegSequence` already produces.
 *
 * TWO STRUCTURAL DECISIONS, stated here because everything else follows from them:
 *
 * 1. THE PATTERN IS POSITIONAL. `legs[0]` is the most recent impulse leg, `legs[1]` the one
 *    before it, and so on — a direct binding to a position, not a search. There is no
 *    backtracking, no gap budget and no bull/bear split: you describe leg 0, leg 1, leg 2
 *    in order, and each one says what direction it must be.
 *
 *    The index counts IMPULSE LEGS ONLY. Pullbacks are skipped in the numbering, because
 *    indexing raw segments is unstable: measured over 529 windows of real NSE 5m data,
 *    segment 0 is a pullback 100% of the time and segment 1 a leg 100% of the time, but
 *    segment 2 is a leg only 75% of the time and segment 3 only 25% — legs are sometimes
 *    adjacent with no pullback between them, so the alternation drifts. Indexing legs
 *    keeps every position meaningful (each of leg[0..3] runs about 46% bull / 54% bear,
 *    so "is leg[0] bull?" genuinely splits the data).
 *
 * 2. NOTHING IS LOST BY SKIPPING PULLBACKS, because each leg slot carries the retrace that
 *    FOLLOWED it in `slot.pullback`. The window is newest-first, so a leg at segment index
 *    `j` binds its pullback at `j-1` (verified against legSequence.ts's build order: after
 *    the final `.reverse()`, the retrace of the leg at `i+1` sits at `i`). That nesting is
 *    what makes depth exact — measured against the very leg the slot names, never against
 *    "whichever leg happened to be nearby". The trailing pullback running into the current
 *    bar is simply `legs[0].pullback`.
 *
 * Ordering trap to keep in mind everywhere below: the segment array is NEWEST-FIRST, while
 * the per-candle arrays inside each segment are OLDEST-FIRST. Both conventions are real and
 * both are load-bearing; the adapter is the single place that reconciles them.
 */

// ─── Primitives ───────────────────────────────────────────────────────────────

/** An inclusive numeric range. Either end may be absent — absent constrains nothing.
 *  `null` and `undefined` both mean "unset"; the UI writes `null`, JSON round-trips it. */
export interface Bounds {
  min?: number | null;
  max?: number | null;
}

export type SegKind = 'impulse' | 'pullback' | 'any';
export type SideSel = 'bull' | 'bear' | 'any';

/** Which candles inside a leg a run condition is allowed to count.
 *  'same'/'opposite' resolve against the leg's own direction at match time. */
export type RunSide = 'same' | 'opposite' | 'bull' | 'bear' | 'any';

/** "N consecutive candles clearing a body-to-range threshold." Needs per-candle data —
 *  without it the condition is UNKNOWN, which fails and is counted, never silently passes. */
export interface RunCond {
  minBrr?: number;  // default 0.5
  minRun?: number;  // unset means the condition is skipped entirely
  side?: RunSide;   // default 'same'
}

// ─── Numeric field table ──────────────────────────────────────────────────────

export type NumericField =
  | 'candles'
  | 'movePct'
  | 'avgBrr'
  | 'avgDirClv'
  | 'breakPersist'
  | 'breakCount'
  | 'maxBreakRun'
  | 'rangeRatio'
  | 'maxRun'
  | 'depthRatio'
  | 'legScore';

/** Data richness a field needs. Tier 0 works from leg geometry alone; tier 1 needs the
 *  quality aggregates (always present); tier 2 needs the per-candle arrays, which exist
 *  only in 'full' detail and are stripped before Firestore. */
export type FieldTier = 0 | 1 | 2;

export interface NumericFieldDef {
  key: NumericField;
  label: string;
  reads: string;
  step: number;
  int: boolean;
  tier: FieldTier;
  /** Slider bounds for the UI. Not a validation limit. */
  uiMin: number;
  uiMax: number;
  unit: 'count' | 'percent' | 'fraction';
  tooltip: string;
}

/**
 * ONE table, read by both the compiler and the UI. A new condition is one entry here,
 * not two hand-maintained lists that drift apart.
 */
export const NUMERIC_FIELDS: readonly NumericFieldDef[] = [
  {
    key: 'candles', label: 'Candles', reads: 'barCount', step: 1, int: true, tier: 0,
    uiMin: 1, uiMax: 40, unit: 'count',
    tooltip: 'How many candles the segment spans.',
  },
  {
    key: 'movePct', label: 'Move %', reads: 'absMovePct', step: 0.05, int: false, tier: 0,
    uiMin: 0, uiMax: 3, unit: 'percent',
    tooltip: 'Absolute % travelled from the segment open to its close. Always unsigned — direction is handled by the leg own Bull/Bear setting.',
  },
  {
    key: 'avgBrr', label: 'Avg BRR', reads: 'brr', step: 0.05, int: false, tier: 1,
    uiMin: 0, uiMax: 1, unit: 'fraction',
    tooltip: 'Mean body-to-range ratio across the segment. High = conviction candles, low = doji-ish chop.',
  },
  {
    key: 'avgDirClv', label: 'Avg dir CLV', reads: 'dirClv', step: 0.05, int: false, tier: 1,
    uiMin: 0, uiMax: 1, unit: 'fraction',
    tooltip: 'Mean close-location value, mirrored for down segments so higher is always better. High = candles closed with the move.',
  },
  {
    key: 'breakPersist', label: 'Break persistence', reads: 'breakPersist', step: 0.05, int: false, tier: 1,
    uiMin: 0, uiMax: 1, unit: 'fraction',
    tooltip: 'FRACTION of the segment candles that made a new extreme in the direction it travelled. 1.00 = every candle broke the previous one. Prefer this over Break count when the candle count is a range.',
  },
  {
    key: 'breakCount', label: 'Break count', reads: '@breakCount', step: 1, int: true, tier: 1,
    uiMin: 0, uiMax: 20, unit: 'count',
    tooltip: 'RAW COUNT of candles that broke the prior candle high (or low, for a down segment). Not necessarily consecutive.',
  },
  {
    key: 'maxBreakRun', label: 'Consecutive breaks', reads: '@maxBreakRun', step: 1, int: true, tier: 0,
    uiMin: 0, uiMax: 20, unit: 'count',
    tooltip: 'Longest run of BACK-TO-BACK candles each breaking the previous candle extreme, in the direction the segment travelled. An outside bar (breaking both ways) resets the run.',
  },
  {
    key: 'rangeRatio', label: 'Range ratio', reads: 'rangeRatio', step: 0.1, int: false, tier: 0,
    uiMin: 0, uiMax: 4, unit: 'fraction',
    tooltip: 'Mean candle range inside the segment against the recent 20-bar baseline. Above 1 is oversized — this is the climax guard.',
  },
  {
    key: 'maxRun', label: 'Conviction run', reads: 'maxRun', step: 1, int: true, tier: 2,
    uiMin: 0, uiMax: 10, unit: 'count',
    tooltip: 'Longest run of consecutive same-direction candles at the fixed BRR >= 0.5 cutoff. For a tunable cutoff add a run condition instead. Needs per-candle data.',
  },
  {
    key: 'depthRatio', label: 'Depth ratio', reads: 'depthRatio', step: 0.05, int: false, tier: 0,
    uiMin: 0, uiMax: 2, unit: 'fraction',
    tooltip: 'How much of the leg the retrace gave back (0.5 = half). Meaningful on pullbacks only. Inside a nested pullback block it is measured against that slot own leg.',
  },
  {
    key: 'legScore', label: 'Leg score', reads: '@legScore', step: 0.05, int: false, tier: 1,
    uiMin: 0, uiMax: 1, unit: 'fraction',
    tooltip: 'Composite 0..1 strength from the weighted components. Lets a rule say "strong leg" without enumerating what strong means.',
  },
] as const;

export const NUMERIC_FIELD_BY_KEY: Readonly<Record<NumericField, NumericFieldDef>> =
  Object.fromEntries(NUMERIC_FIELDS.map(f => [f.key, f])) as Record<NumericField, NumericFieldDef>;

// ─── Conditions on one segment ────────────────────────────────────────────────

/** Bounds on a segment's numeric fields, plus bar-level run conditions. Every field is
 *  optional; a block with nothing set constrains nothing and is skipped by the compiler
 *  entirely (no no-op call per leg — this runs per candidate bar over the whole history). */
export interface LegConditions {
  candles?: Bounds;
  movePct?: Bounds;
  avgBrr?: Bounds;
  avgDirClv?: Bounds;
  breakPersist?: Bounds;
  breakCount?: Bounds;
  maxBreakRun?: Bounds;
  rangeRatio?: Bounds;
  maxRun?: Bounds;
  depthRatio?: Bounds;
  legScore?: Bounds;
  runs?: RunCond[];
}

/** Internal: a LegConditions block that also selects which segments it applies to.
 *  Not part of the user-facing config — the compiler builds these. */
export interface LegRule extends LegConditions {
  kind?: SegKind;
  side?: SideSel;
}

/**
 * The retrace that FOLLOWED this slot's leg — segment index `j-1`, newest-first.
 *
 * `presence` covers the two ways it can be absent: the leg is the newest segment (nothing
 * newer exists), or the next segment is another leg (legs are adjacent when the builder
 * found no gap). 'forbidden' is how you say "this leg ran straight on, no retrace yet".
 *
 * `side` defaults to 'any' deliberately. legSequence.ts tags a pullback with the direction
 * OPPOSITE the leg it retraces, so `side: 'bull'` on the pullback under a bull leg would
 * match nothing. Leave it alone unless you want that inverted convention.
 */
export interface PullbackRule extends LegConditions {
  presence?: 'required' | 'optional' | 'forbidden'; // default 'required'
  side?: SideSel;                                   // default 'any'
  /** The newest segment runs up to and including the current bar, so its stats grow every
   *  bar. Set false to require a completed retrace. Default true. */
  allowForming?: boolean;
}

/**
 * One POSITION in the pattern. `legs[0]` is the most recent impulse leg, `legs[1]` the one
 * before it, and so on — the index IS the position, so there is nothing to search for and
 * no gap rule to write.
 *
 * A slot with no conditions at all is a wildcard: it still occupies its position (so
 * `legs[2]` keeps meaning "the third most recent leg") but places no requirement on it.
 */
export interface LegSlot extends LegConditions {
  /** The direction test for this position — "is leg[0] bull?". Default 'any'. */
  side?: SideSel;
  /** The retrace that followed THIS leg. */
  pullback?: PullbackRule;
}

// ─── Window aggregates ────────────────────────────────────────────────────────

export type WindowField =
  | 'legCount' | 'impulseCount' | 'barsCovered'
  | 'nBull' | 'nBear' | 'legBalance'
  | 'dominance' | 'legEfficiency' | 'netMovePct' | 'sumAbsMove'
  | 'pullbackDepth' | 'moveEfficiency'
  | 'avgBrr' | 'avgDirClv' | 'maxGoodRun' | 'goodLegPct';

export type WindowOp =
  | 'between' | 'in' | 'eq' | 'neq' | 'gte' | 'gt' | 'lte' | 'lt' | 'is-null' | 'not-null';

export interface WindowClause {
  field: WindowField;
  op: WindowOp;
  value?: number | number[] | null;
}

export interface WindowFieldDef {
  key: WindowField;
  label: string;
  step: number;
  int: boolean;
  uiMin: number;
  uiMax: number;
  tooltip: string;
}

export const WINDOW_FIELDS: readonly WindowFieldDef[] = [
  { key: 'legCount', label: 'Segments', step: 1, int: true, uiMin: 0, uiMax: 25,
    tooltip: 'Total segments in the window — impulse legs and pullbacks together.' },
  { key: 'impulseCount', label: 'Impulse legs', step: 1, int: true, uiMin: 0, uiMax: 20,
    tooltip: 'Impulse legs only — the things the pattern indexes over.' },
  { key: 'barsCovered', label: 'Bars covered', step: 1, int: true, uiMin: 0, uiMax: 300,
    tooltip: 'Candles spanned by the whole window.' },
  { key: 'nBull', label: 'Bull legs', step: 1, int: true, uiMin: 0, uiMax: 20,
    tooltip: 'Impulse legs that travelled up.' },
  { key: 'nBear', label: 'Bear legs', step: 1, int: true, uiMin: 0, uiMax: 20,
    tooltip: 'Impulse legs that travelled down.' },
  { key: 'legBalance', label: 'Leg balance', step: 1, int: true, uiMin: -10, uiMax: 10,
    tooltip: 'Bull legs minus bear legs — signed one-sidedness.' },
  { key: 'dominance', label: 'Dominance', step: 0.05, int: false, uiMin: 0, uiMax: 1,
    tooltip: 'Share of total impulse movement that went up. 0.5 = balanced, 1 = all up, 0 = all down.' },
  { key: 'legEfficiency', label: 'Leg efficiency', step: 0.05, int: false, uiMin: 0, uiMax: 1,
    tooltip: 'Net displacement across the window over the total path walked. Near 1 = clean trend, near 0 = chop. NOT the Kaufman efficiency ratio used elsewhere — different window, different question.' },
  { key: 'netMovePct', label: 'Net move %', step: 0.05, int: false, uiMin: 0, uiMax: 10,
    tooltip: 'Absolute % from the oldest segment open to the newest segment close.' },
  { key: 'sumAbsMove', label: 'Path travelled %', step: 0.05, int: false, uiMin: 0, uiMax: 30,
    tooltip: 'Sum of every segment absolute % move — the total distance walked.' },
  { key: 'pullbackDepth', label: 'Avg pullback depth', step: 0.05, int: false, uiMin: 0, uiMax: 2,
    tooltip: 'Mean depth ratio across the window pullbacks.' },
  { key: 'moveEfficiency', label: 'Recent move / bar', step: 0.01, int: false, uiMin: 0, uiMax: 1,
    tooltip: 'The most recent impulse leg % move divided by its candle count.' },
  { key: 'avgBrr', label: 'Window avg BRR', step: 0.05, int: false, uiMin: 0, uiMax: 1,
    tooltip: 'Mean body-to-range ratio over every segment.' },
  { key: 'avgDirClv', label: 'Window avg dir CLV', step: 0.05, int: false, uiMin: 0, uiMax: 1,
    tooltip: 'Mean direction-mirrored close-location value over every segment.' },
  { key: 'maxGoodRun', label: 'Best run in window', step: 1, int: true, uiMin: 0, uiMax: 12,
    tooltip: 'Longest conviction run found in any segment. Needs per-candle data.' },
  { key: 'goodLegPct', label: 'Strong-leg share', step: 0.05, int: false, uiMin: 0, uiMax: 1,
    tooltip: 'Share of impulse legs scoring at or above the leg-strength threshold. Undefined when the window has no impulse legs.' },
] as const;

export const WINDOW_FIELD_BY_KEY: Readonly<Record<WindowField, WindowFieldDef>> =
  Object.fromEntries(WINDOW_FIELDS.map(f => [f.key, f])) as Record<WindowField, WindowFieldDef>;

// ─── Composite leg score ──────────────────────────────────────────────────────

export type ScoreComponent =
  | 'brr' | 'dirClv' | 'breakPersist' | 'moveVsMedian' | 'runLength' | 'overlap' | 'climax';

export type ScoreWeights = Record<ScoreComponent, number>;

/** A starting point to disagree with, not a discovered constant. Negative weights are
 *  penalties. Retuning these keeps saved thresholds meaningful only because the score is
 *  span-normalised — see score.ts. */
export const DEFAULT_SCORE_WEIGHTS: ScoreWeights = {
  brr: 0.30,
  dirClv: 0.25,
  breakPersist: 0.15,
  moveVsMedian: 0.15,
  runLength: 0.10,
  overlap: -0.10,
  climax: -0.05,
};

// ─── Retrace gate ─────────────────────────────────────────────────────────────

export interface RetraceGate {
  enabled: boolean;
  windowLegs: number; // clamped to [2, 20] — counts SEGMENTS
  maxPct: number;     // clamped to [0, RETRACE_MAX_PCT_CAP]
}

export const RETRACE_WINDOW_MIN = 2;
export const RETRACE_WINDOW_MAX = 20;
/** A ceiling this loose stops being a filter; not overridable from a hand-edited config. */
export const RETRACE_MAX_PCT_CAP = 50;

/** Positions a pattern may pin down. Beyond this the window rarely holds enough legs. */
export const MAX_LEG_SLOTS = 8;

// ─── The whole config ─────────────────────────────────────────────────────────

/** Bumped from 1: `legs` changed from {bull, bear} sections to a positional array.
 *  Nothing shipped on v1, so there is no migration path — a v1 doc is refused. */
export const LEG_PATTERN_VERSION = 2;

/** Evidence a config carries about how it was fitted. */
export interface LegPatternEvidence {
  dataset?: string;
  inSample?: { n: number; result: number };
  outOfSample?: { n: number; result: number };
}

export interface LegPatternConfig {
  version: number;
  enabled: boolean;
  name?: string;
  /** Whether `side` and the direction-dependent fields read the leg's STRUCTURAL intent
   *  (what the leg machine labelled it) or its REALIZED displacement. These legitimately
   *  disagree; it is a tunable knob, not an implementation detail. */
  sideBasis?: 'realized' | 'struct';
  weights?: Partial<ScoreWeights>;
  thresholds?: { legStrength?: number };
  window?: WindowClause[];
  direction?: 'any' | 'long' | 'short';
  /**
   * POSITIONAL. `legs[0]` is the most recent impulse leg, `legs[1]` the one before it.
   * Pullbacks are skipped in the numbering and reached through each slot's `pullback`.
   * A window holding fewer impulse legs than there are slots REJECTS the bar.
   */
  legs: LegSlot[];
  retrace?: RetraceGate;
  evidence?: LegPatternEvidence;
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

export const DEFAULT_LEG_STRENGTH = 0.6;
export const DEFAULT_RUN_MIN_BRR = 0.5;

/** A brand-new pattern: disabled, no slots — compiles to no predicate and accepts every
 *  window until something is actually configured. */
export function defaultLegPatternConfig(): LegPatternConfig {
  return {
    version: LEG_PATTERN_VERSION,
    enabled: false,
    sideBasis: 'realized',
    weights: { ...DEFAULT_SCORE_WEIGHTS },
    thresholds: { legStrength: DEFAULT_LEG_STRENGTH },
    window: [],
    direction: 'any',
    legs: [],
    retrace: { enabled: false, windowLegs: 10, maxPct: 32 },
  };
}

export function defaultLegSlot(side: SideSel = 'any'): LegSlot {
  return { side };
}

export function defaultPullbackRule(): PullbackRule {
  return { presence: 'required', side: 'any', allowForming: true };
}

// ─── Predicates the compiler and the UI both need ─────────────────────────────

export function boundsConstrains(b: Bounds | undefined | null): boolean {
  if (!b) return false;
  return Number.isFinite(b.min as number) || Number.isFinite(b.max as number);
}

export function runCondConstrains(r: RunCond | undefined | null): boolean {
  return !!r && Number.isFinite(r.minRun as number) && (r.minRun as number) > 0;
}

/** Does this block constrain anything at all? Used to skip compilation entirely rather
 *  than paying for a no-op predicate per leg. */
export function conditionsConstrain(c: LegConditions | undefined | null): boolean {
  if (!c) return false;
  for (const def of NUMERIC_FIELDS) {
    if (boundsConstrains(c[def.key])) return true;
  }
  return (c.runs ?? []).some(runCondConstrains);
}

export function legRuleConstrains(r: LegRule | undefined | null): boolean {
  if (!r) return false;
  if (r.kind && r.kind !== 'any') return true;
  if (r.side && r.side !== 'any') return true;
  return conditionsConstrain(r);
}

/** A nested pullback block does something even with no bounds set, as long as it declares
 *  a presence requirement other than the permissive default. */
export function pullbackRuleConstrains(p: PullbackRule | undefined | null): boolean {
  if (!p) return false;
  if (p.presence === 'required' || p.presence === 'forbidden') return true;
  if (p.allowForming === false) return true;
  return legRuleConstrains(p);
}

/** Whether this position places any TEST on its leg. A wildcard slot returns false but
 *  still occupies a position — see legPatternActive. */
export function slotConstrains(s: LegSlot | undefined | null): boolean {
  if (!s) return false;
  if (s.side && s.side !== 'any') return true;
  if (conditionsConstrain(s)) return true;
  return pullbackRuleConstrains(s.pullback);
}

/** True when the pattern would actually filter anything. `enabled: false` or an empty spec
 *  reads as inactive — the engine is a no-op until configured, and callers must not pay
 *  for a pass. */
export function legPatternActive(cfg: LegPatternConfig | undefined | null): boolean {
  if (!cfg || !cfg.enabled) return false;
  if ((cfg.window ?? []).length > 0) return true;
  if (cfg.direction && cfg.direction !== 'any') return true;
  if (cfg.retrace?.enabled) return true;
  // Any slot at all counts, even a wildcard: it still requires the window to HOLD that
  // many impulse legs, which is a real (if weak) filter.
  return (cfg.legs ?? []).length > 0;
}

/** Does evaluating this pattern require the per-candle arrays ('full' detail)? */
export function patternNeedsPerCandle(cfg: LegPatternConfig | undefined | null): boolean {
  if (!cfg) return false;
  const condNeeds = (c?: LegConditions | null): boolean =>
    !!c && (boundsConstrains(c.maxRun) || (c.runs ?? []).some(runCondConstrains));
  if ((cfg.window ?? []).some(c => c.field === 'maxGoodRun')) return true;
  return (cfg.legs ?? []).some(s => condNeeds(s) || condNeeds(s.pullback));
}

/** Does anything actually read a composite leg score? Scoring is a full extra pass. */
export function patternNeedsScores(cfg: LegPatternConfig | undefined | null): boolean {
  if (!cfg) return false;
  const condNeeds = (c?: LegConditions | null): boolean => !!c && boundsConstrains(c.legScore);
  if ((cfg.window ?? []).some(c => c.field === 'goodLegPct')) return true;
  return (cfg.legs ?? []).some(s => condNeeds(s) || condNeeds(s.pullback));
}

// ─── Load-time validation and clamping ────────────────────────────────────────

export class LegPatternConfigError extends Error {}

const clampNum = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function clampBounds(b: Bounds | undefined, def: NumericFieldDef): Bounds | undefined {
  if (!boundsConstrains(b)) return undefined;
  const fix = (v: number | null | undefined): number | null => {
    if (!Number.isFinite(v as number)) return null;
    const n = def.int ? Math.round(v as number) : (v as number);
    // Negative values are meaningless for every field in the table (movePct is absolute,
    // the rest are counts or 0..1 fractions), so the floor is 0 regardless of uiMin.
    return Math.max(0, n);
  };
  const min = fix(b!.min);
  const max = fix(b!.max);
  // A reversed range can never match; treat it as the caller having swapped the two
  // rather than silently rejecting every window.
  if (min !== null && max !== null && min > max) return { min: max, max: min };
  return { min, max };
}

function clampConditions<T extends LegConditions>(c: T): T {
  const out = { ...c };
  for (const def of NUMERIC_FIELDS) {
    const cleaned = clampBounds(c[def.key], def);
    if (cleaned) out[def.key] = cleaned;
    else delete out[def.key];
  }
  const runs = (c.runs ?? []).filter(runCondConstrains).map(r => ({
    minBrr: clampNum(Number.isFinite(r.minBrr as number) ? (r.minBrr as number) : DEFAULT_RUN_MIN_BRR, 0, 1),
    minRun: Math.max(1, Math.round(r.minRun as number)),
    side: (r.side ?? 'same') as RunSide,
  }));
  if (runs.length) out.runs = runs;
  else delete out.runs;
  return out;
}

function clampSlot(s: LegSlot): LegSlot {
  const out: LegSlot = clampConditions({ ...s });
  out.side = s.side ?? 'any';
  if (s.pullback) {
    const pb = clampConditions({ ...s.pullback }) as PullbackRule;
    pb.presence = s.pullback.presence ?? 'required';
    pb.side = s.pullback.side ?? 'any';
    pb.allowForming = s.pullback.allowForming !== false;
    out.pullback = pb;
  }
  return out;
}

/**
 * Parse-time clamp + validation. Every bounded knob is clamped HERE, not only in the UI —
 * a hand-edited file or a URL parameter must not be able to loosen a cap the UI enforces.
 * A version mismatch or a malformed block is refused loudly rather than half-loaded,
 * because a partially-loaded config produces a filter nobody can reason about.
 */
export function clampLegPatternConfig(raw: unknown): LegPatternConfig {
  if (!raw || typeof raw !== 'object') {
    throw new LegPatternConfigError('leg pattern config is not an object');
  }
  const cfg = raw as Partial<LegPatternConfig> & { legs?: unknown };
  if (cfg.version !== undefined && cfg.version !== LEG_PATTERN_VERSION) {
    throw new LegPatternConfigError(
      `leg pattern config version ${cfg.version} is not supported (expected ${LEG_PATTERN_VERSION})`
    );
  }
  if (cfg.legs !== undefined && !Array.isArray(cfg.legs)) {
    throw new LegPatternConfigError(
      'leg pattern config: `legs` must be an ordered array of slots (leg[0] = most recent impulse leg)'
    );
  }

  const weights = { ...DEFAULT_SCORE_WEIGHTS, ...(cfg.weights ?? {}) };
  for (const k of Object.keys(weights) as ScoreComponent[]) {
    if (!Number.isFinite(weights[k])) weights[k] = DEFAULT_SCORE_WEIGHTS[k];
    weights[k] = clampNum(weights[k], -1, 1);
  }

  const legStrength = Number.isFinite(cfg.thresholds?.legStrength as number)
    ? clampNum(cfg.thresholds!.legStrength as number, 0, 1)
    : DEFAULT_LEG_STRENGTH;

  const r = cfg.retrace;
  const retrace: RetraceGate = {
    enabled: !!r?.enabled,
    windowLegs: clampNum(
      Number.isFinite(r?.windowLegs as number) ? Math.round(r!.windowLegs) : 10,
      RETRACE_WINDOW_MIN, RETRACE_WINDOW_MAX
    ),
    maxPct: clampNum(Number.isFinite(r?.maxPct as number) ? (r!.maxPct as number) : 32, 0, RETRACE_MAX_PCT_CAP),
  };

  const window = (cfg.window ?? []).filter(
    c => !!c && !!WINDOW_FIELD_BY_KEY[c.field as WindowField]
  );

  return {
    version: LEG_PATTERN_VERSION,
    enabled: !!cfg.enabled,
    name: cfg.name,
    sideBasis: cfg.sideBasis === 'struct' ? 'struct' : 'realized',
    weights,
    thresholds: { legStrength },
    window,
    direction: cfg.direction === 'long' || cfg.direction === 'short' ? cfg.direction : 'any',
    legs: ((cfg.legs as LegSlot[]) ?? []).slice(0, MAX_LEG_SLOTS).map(clampSlot),
    retrace,
    evidence: cfg.evidence,
  };
}

/** Guard for the curve-fitting rule — a config fitted against historical outcomes must
 *  carry its own out-of-sample evidence. Deliberately not overridable. */
export function assertExportable(cfg: LegPatternConfig): void {
  const ev = cfg.evidence;
  if (!ev) return; // never fitted / not claiming to be — nothing to prove
  if (!ev.outOfSample || !Number.isFinite(ev.outOfSample.result) || !(ev.outOfSample.n > 0)) {
    throw new LegPatternConfigError(
      'refusing to export a fitted leg pattern with no out-of-sample result — add evidence.outOfSample { n, result }'
    );
  }
}
