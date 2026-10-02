/**
 * @backtest-only
 *
 * Custom Entry Hook — the public API a user-authored entry algorithm sees.
 *
 * This is the escape hatch from declarative configuration. Every other entry gate in the
 * engine is a scalar min/max (`passesXxx`) or a declarative shape (the leg-pattern matcher);
 * neither can express "if the last three legs did X *and* the session opened above Y, go
 * short with 2x size and a hand-picked stop". A hook can.
 *
 * Two facts about the surrounding system shape this API and are worth stating up front:
 *
 * 1. Hooks are addressed by STRING ID, never passed as a function on the config. The batch
 *    simulator runs inside a Web Worker and receives only the serialized AutoBacktestConfig
 *    through postMessage — a function reference cannot cross that boundary. The worker
 *    imports the registry itself and resolves the id. See strategies/index.ts.
 *
 * 2. The hook fires on EVERY H/L signal bar regardless of count. The built-in chain can only
 *    ever enter on H1/H2/L1/L2 (evalLong/evalShort build their allowed set from
 *    rules.allowH1/allowH2), but runAlBrooks labels H3, H4, L5... all the same. The hook
 *    reads those raw labels off `signalsByBar`, so the whole counter range is reachable.
 */
import type { Candle, LegSegment } from '../../types';
import type { PivotPoint } from '../indicators';
import type { LegWindow as LegPatternWindow } from '../legPattern';
import type {
  AutoBacktestConfig,
  EntryMetricsSnapshot,
  LegWindow,
  RegimeKey,
  RegimeRules,
} from '../autoBacktestEngine';

/** How a regime consults its hook. Absent/undefined is the identity state — see the note
 *  on RegimeRules.entryHookMode for why this is deliberately optional. */
export type EntryHookMode = 'off' | 'gate' | 'replace';

/** The Al Brooks pullback signal that caused this call. */
export interface HookTrigger {
  /** Raw, unfiltered label: 'H1' | 'H2' | 'H3' | 'L1' | 'L4' ... */
  label: string;
  /** H -> long, L -> short. The DEFAULT direction; a decision may override it. */
  side: 'long' | 'short';
  /** The counter value: 3 for 'H3'. */
  count: number;
  /** Absolute index into the full session candle array. */
  barIndex: number;
}

/**
 * Everything the hook is handed. Assembled once per trigger bar.
 *
 * Causality guarantee: nothing reachable from this object describes a bar after
 * `absoluteIndex`. `candles` is a prefix slice, `pivots`/`metrics`/`legs()` all come from
 * the engine's index-bounded cached accessors, and `signals` is dense but written at fire
 * time from bars <= i. A hook cannot accidentally look ahead through this API.
 */
export interface EntryHookContext {
  // ── The rolling window ──────────────────────────────────────────────────────
  /**
   * The last `config.entryHookLookback` candles ending at and INCLUDING the trigger bar,
   * OLDEST-FIRST. Length is `min(entryHookLookback, absoluteIndex + 1)` — shorter than the
   * full lookback early in the session. `candles[candles.length - 1]` is the trigger bar.
   *
   * This exists so a hook never has to maintain its own history. Note it is a fresh slice:
   * do NOT pass it back into the engine's indicator helpers (getPivotPointsUpTo, getEmaAt,
   * ...), which memoize on array identity and would recompute from scratch. Use the values
   * already on this context, or `fullCandles` with `absoluteIndex`.
   */
  candles: Candle[];
  /** Index of the trigger bar WITHIN `candles` — always `candles.length - 1`. */
  index: number;
  /** The same bar's index in the full session array. */
  absoluteIndex: number;
  /** Convenience alias for `candles[index]`. */
  candle: Candle;
  /**
   * The full session candle array, unsliced. Only for passing to the cached indicator
   * helpers alongside `absoluteIndex` — reading past `absoluteIndex` is lookahead and will
   * silently invalidate any backtest built on it.
   */
  fullCandles: Candle[];

  trigger: HookTrigger;

  // ── What the engine already computed at this bar ────────────────────────────
  /** Which rule-set is asking. Not necessarily the auto-detected regime: the engine tries
   *  the matched regime first, then every other enabled one. */
  regime: RegimeKey;
  /** Lower-timeframe structure: 'Bull-Trend' | 'Bull-Trending-range' | 'Bear-Trend' |
   *  'Bear-Trending-range' | 'Bull-Reversal' | 'Bear-Reversal' | 'Range'. */
  ltMarket: string;
  /** Higher-timeframe structure. NB: EMA60 on the SAME base timeframe, not a real HTF feed. */
  htMarket: string;
  /** Pivot trend sequence: 'HH-HL' | 'LH-HL' | 'HH-LL' | 'LH-LL' | ''. */
  pivotSeq: string;
  ema21: number | null;
  ema60: number | null;
  atr: number;
  /** Confirmed pivots up to and including the trigger bar, oldest-first. */
  pivots: PivotPoint[];
  /** The full instrumentation bundle the built-in filters gate on and the Trade record is
   *  stamped from — bar overlap, efficiency ratio, break counts, BRR averages, EMA slopes,
   *  pivot sequences. Every field is optional: undefined means "not measurable here". */
  metrics: EntryMetricsSnapshot;
  /** Absolute bar bounds of the most recently completed breakout leg on the trigger's side,
   *  or null before that side's first leg completes. */
  legWindow: LegWindow | null;
  /** Dense per-bar H/L label, index-aligned with `candles` (the WINDOW, not the full array);
   *  null on bars where nothing fired. Lets a hook look back over recent signal history —
   *  e.g. "was there an L2 within the last 20 bars". */
  signals: (string | null)[];

  // ── Expensive, built on first access only ───────────────────────────────────
  /**
   * The contiguous leg + pullback sequence ending at the trigger bar, NEWEST-FIRST.
   * `legs()[0]` is the most recent segment. Each segment carries its own H/L sub-sequence
   * (`hlSeq`, e.g. 'H1-H2-H3') and, in full detail, per-candle OHLC and bar-quality arrays.
   * Length is governed by Session Settings' Leg Seq N.
   */
  legs(): LegSegment[];
  /**
   * The derived leg-pattern feature window — scored features, impulse addressing, window
   * aggregates. This is what the declarative leg-pattern matcher runs against; reach for it
   * when you want its computed fields (brr, dirClv, depthRatio, breakPersist, legScore)
   * rather than raw segments.
   *
   * @param needsPerCandle build with the per-candle brr/dir arrays (needed for run
   *        conditions like "3 consecutive bars at BRR >= 0.8"). Defaults to false — the
   *        cheaper build.
   */
  legFeatures(needsPerCandle?: boolean): LegPatternWindow;

  /** The regime's configured rules. Read-only — mutating this corrupts every later bar. */
  rules: Readonly<RegimeRules>;
  /** The global config, including every Session Settings lookback. Read-only. */
  config: Readonly<AutoBacktestConfig>;

  /**
   * Scratch object shared across every call within ONE backtest run, reset at the start of
   * the next. Where a stateful algorithm keeps counters, cooldowns, a last-entry bar, or a
   * rolling accumulator. The engine never reads or writes it.
   */
  state: Record<string, unknown>;

  /** Append a note to the resulting Trade's reason string. No-op when the trade is skipped. */
  log(msg: string): void;
}

/**
 * A decision to take the trade, with optional overrides.
 *
 * Every field is optional: `return {}` is equivalent to `return true` — take the trade with
 * the engine's own direction, sizing, stop and target.
 */
export interface EntryHookDecision {
  /** Explicit skip. Defaults to true when an object is returned, so `return { take: false }`
   *  and `return false` are the same thing. */
  take?: boolean;
  /** Overrides the trigger's implied direction — e.g. fade an H3 by going short. Still
   *  subject to `rules.direction` (a LONG_ONLY regime will not take a short). */
  side?: 'long' | 'short';
  /** Absolute quantity. Bypasses useAutoQty / riskPerTrade / minQuantity entirely.
   *  Floored to a whole number; anything below 1 skips the trade. */
  quantity?: number;
  /** Stop loss as an absolute price. Wins over `slPoints` and over rules.slMethod. */
  sl?: number;
  /** Stop loss as a distance in points from the entry price. Ignored when `sl` is given. */
  slPoints?: number;
  /** Target as an absolute price. Wins over `targetRR`. */
  target?: number;
  /** Target as a reward:risk multiple against the final stop distance. Overrides
   *  rules.targetRR. */
  targetRR?: number;
  /** Fill price. Defaults to the trigger bar's close. Must lie within that bar's high/low —
   *  a price outside the bar never traded, so the engine refuses it rather than booking a
   *  fill that could not have happened. */
  entryPrice?: number;
  /** Replaces the auto-generated reason string on the Trade. */
  reason?: string;
}

/**
 * What a hook may return.
 *
 * - `false` / `null` / `undefined` — no trade.
 * - `true` — take the trade exactly as the engine would have.
 * - an `EntryHookDecision` — take it, with overrides.
 */
export type EntryHookResult = boolean | null | undefined | EntryHookDecision;

/** A user-authored entry algorithm. Must be pure with respect to everything except
 *  `ctx.state` — the engine may call it for bars it later discards. */
export type EntryHook = (ctx: EntryHookContext) => EntryHookResult;

/** One registry entry. `label` is what the config UI shows in its dropdown. */
export interface EntryHookEntry {
  label: string;
  /** Optional one-line description, shown under the dropdown. */
  description?: string;
  hook: EntryHook;
}
