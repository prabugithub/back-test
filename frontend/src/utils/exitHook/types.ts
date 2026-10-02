/**
 * @backtest-only
 *
 * Custom Exit Hook — the public API a user-authored trade-management algorithm sees.
 *
 * The mirror image of utils/entryHook. Where an entry hook is asked "should this signal bar
 * become a trade?", an exit hook is asked, once per bar, "this trade is open — hold it, move
 * its stop, or close it?". It is the escape hatch from the declarative exit mechanisms
 * (Reversal, Opposite Signal, Pivot Trailing Stop), none of which can express "give it 8
 * bars, then demand a new high every 3 bars, and go to breakeven once it pays 1R".
 *
 * This replaced the built-in Leg Decay Exit, whose logic now ships as the `leg-decay` hook in
 * `strategies/exits/legDecay.ts` — the same checks, editable instead of hard-coded.
 *
 * Three facts about the surrounding system shape this API:
 *
 * 1. Hooks are addressed by STRING ID, never passed as a function on the config. The batch
 *    simulator runs inside a Web Worker and receives only the serialized AutoBacktestConfig
 *    through postMessage — a function reference cannot cross that boundary. The worker
 *    imports the registry itself and resolves the id. See strategies/exits/index.ts.
 *
 * 2. The hook is called on EVERY bar a position is open (after the SL/TP touch check, so a
 *    bar that already hit SL or TP never reaches it), not only on signal bars. There is no
 *    trigger: the open trade is the trigger.
 *
 * 3. A stop or target the hook moves takes effect from the NEXT bar. The canonical per-bar
 *    order is trail → SL/TP touch → signal exits (this hook) → square-off → entry, so the
 *    touch check for this bar has already run by the time the hook speaks. That is causally
 *    correct — the hook decides on the bar's close — but it does mean `{ exit: false, sl }`
 *    can never retroactively save a bar that already stopped out.
 */
import type { Candle, LegSegment } from '../../types';
import type { PivotPoint } from '../indicators';
import type { LegWindow as LegPatternWindow } from '../legPattern';
import type { StructureState } from '../marketStructure';
import type {
  AutoBacktestConfig,
  EntryMetricsSnapshot,
  LegWindow,
  RegimeKey,
  RegimeRules,
} from '../autoBacktestEngine';

/** How a regime consults its exit hook. Absent/undefined is the identity state — see the
 *  note on RegimeRules.exitHookMode for why this is deliberately optional. */
export type ExitHookMode = 'off' | 'gate' | 'replace';

/** A built-in signal exit that is about to fire, handed to a 'gate'-mode hook for veto. */
export interface PendingExit {
  reason: 'REVERSAL' | 'OPP_SIGNAL';
  detail: string;
}

/**
 * The open trade, in the shape a hook wants to read it.
 *
 * Normalized away from the store's signed-quantity convention: `side` and a positive
 * `quantity`, rather than making every hook re-derive direction from a sign.
 */
export interface ExitPositionView {
  /** Multi-trade mode only — stable per-trade id. Undefined in single-position mode, where
   *  there is only ever one trade. Use it to key per-trade data in `ctx.state`, which is
   *  shared across every open trade in the run. */
  id?: string;
  side: 'long' | 'short';
  /** Absolute size. Never negative — read `side` for direction. */
  quantity: number;
  /** Signed size, the store's own convention (+ long, − short). */
  signedQuantity: number;
  /** Average entry price. In single-position mode an add blends this, so it is not
   *  necessarily the price of the opening fill. */
  entryPrice: number;
  /** Candle index of the opening bar, or null on a restored session that never stamped one. */
  entryBarIndex: number | null;
  /** Bars elapsed since entry — 0 on the entry bar itself. null without `entryBarIndex`. */
  barsInTrade: number | null;
  /** The CURRENT stop, already including anything the Pivot Trailing Stop moved this bar. */
  stopLoss: number | null;
  target: number | null;
  /** True once the Pivot Trailing Stop has moved the stop at least once. */
  slTrailed: boolean;

  // ── Derived, built on first access ────────────────────────────────────────
  /** Open profit in POINTS at this bar's close. Positive = in profit, for both sides. */
  openPoints: number;
  /** Distance from this bar's close to the CURRENT stop, in points. null when there is no
   *  stop. Note a trailed stop shrinks this, so `openPoints / riskPoints` is R against the
   *  stop as it stands now, not against the risk taken at entry. */
  riskPoints: number | null;
  /** Best excursion in the trade's favour since entry, in points (intrabar high/low, so it
   *  includes moves the close gave back). null without `entryBarIndex`. */
  mfePoints: number | null;
  /** Worst excursion against the trade since entry, in points. Positive number =
   *  that many points of heat. null without `entryBarIndex`. */
  maePoints: number | null;
}

/**
 * Everything the hook is handed. Assembled once per bar, per open position.
 *
 * Causality guarantee, identical to the entry hook's: nothing reachable from this object
 * describes a bar after `absoluteIndex`. `candles` is a prefix slice, `pivots`/`metrics`/
 * `legs()` all come from the engine's index-bounded cached accessors, and `signals` is dense
 * but written at fire time from bars <= i.
 */
export interface ExitHookContext {
  // ── The rolling window ──────────────────────────────────────────────────────
  /**
   * The last `config.exitHookLookback` candles ending at and INCLUDING the current bar,
   * OLDEST-FIRST. Length is `min(exitHookLookback, absoluteIndex + 1)`.
   *
   * A fresh slice: do NOT pass it back into the engine's indicator helpers
   * (getPivotPointsUpTo, getEmaAt, ...), which memoize on array identity and would recompute
   * from scratch. Use the values already on this context, or `fullCandles` with
   * `absoluteIndex`.
   */
  candles: Candle[];
  /** Index of the current bar WITHIN `candles` — always `candles.length - 1`. */
  index: number;
  /** The same bar's index in the full session array. */
  absoluteIndex: number;
  /** Convenience alias for `candles[index]`. */
  candle: Candle;
  /** The full session candle array, unsliced. Only for passing to the cached indicator
   *  helpers alongside `absoluteIndex` — reading past `absoluteIndex` is lookahead. */
  fullCandles: Candle[];

  position: ExitPositionView;
  /**
   * 'gate' mode: the built-in signal exit that fires unless the hook vetoes it, or null when
   * none did. Always null in 'replace' mode, where the built-in checks never run.
   *
   * Returning nothing lets it stand. `{ exit: false }` vetoes it.
   */
  pendingExit: PendingExit | null;

  // ── What the engine computed at this bar ────────────────────────────────────
  /** The regime whose rules manage this trade — the one that OPENED it (position.entryRegime),
   *  not whatever the current structure maps to. */
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
  /** Confirmed pivots up to and including the current bar, oldest-first. */
  pivots: PivotPoint[];
  /**
   * The instrumentation bundle, graded over `legWindow` — the newest COMPLETED leg on the
   * trade's own side. This is the same snapshot the entry filters gate on, which is what lets
   * an exit hook re-apply entry-grade quality checks to the leg the trade is riding now.
   * Every field is optional: undefined means "not measurable here".
   */
  metrics: EntryMetricsSnapshot;
  /** Absolute bar bounds of the newest completed leg on the POSITION's side, or null before
   *  that side's first leg completes. Compare `legWindow.endIndex` against
   *  `position.entryBarIndex` to tell a post-entry leg from the entry leg itself. */
  legWindow: LegWindow | null;
  /** Dense per-bar H/L label, index-aligned with `candles` (the WINDOW, not the full array);
   *  null on bars where nothing fired. Unfiltered, so H3/H4/L5 are all present. */
  signals: (string | null)[];
  /** The raw H/L label on the CURRENT bar, or null. Shorthand for `signals[index]`. */
  signal: string | null;

  // ── Expensive, built on first access only ───────────────────────────────────
  /**
   * The contiguous leg + pullback sequence ending at the current bar, NEWEST-FIRST.
   * `legs()[0]` is the most recent segment. Length is governed by Session Settings' Leg Seq N.
   */
  legs(): LegSegment[];
  /**
   * The derived leg-pattern feature window — scored features, impulse addressing, window
   * aggregates.
   *
   * @param needsPerCandle build with the per-candle brr/dir arrays. Defaults to false.
   */
  legFeatures(needsPerCandle?: boolean): LegPatternWindow;

  /**
   * Pivot-only market structure at this bar (utils/marketStructure; thresholds in Session
   * Settings → Market Structure). `broad` is up / down / range, `sub` the 9-regime taxonomy
   * read (null while forming). `segmentPivots` / `swings` are the whole adaptive window —
   * every swing point of the current structure segment with price, bar index and the candle
   * count between pivots. `keyLevel` is the protected HL/LH, `rangeHigh`/`rangeLow` the box.
   * Look-ahead safe; null only outside the series.
   */
  structure(): StructureState | null;
  /** Brooks leg/pullback segments spanning the current structure segment, NEWEST-FIRST. */
  structureLegs(): LegSegment[];

  /** The managing regime's rules. Read-only — mutating this corrupts every later bar. */
  rules: Readonly<RegimeRules>;
  /** The global config, including every Session Settings lookback. Read-only. */
  config: Readonly<AutoBacktestConfig>;

  /**
   * Scratch object shared across every call within ONE backtest run, reset at the start of
   * the next. In multi-trade mode it is shared by every open trade too — key by
   * `ctx.position.id` when a counter has to be per-trade. The engine never reads or writes it.
   */
  state: Record<string, unknown>;

  /** Append a note to the exit's detail string. Dropped when no exit results. */
  log(msg: string): void;
}

/**
 * A trade-management decision.
 *
 * ⚠ `exit` defaults to TRUE when an object is returned — the same convention as the entry
 * hook's `take`, where `return {}` means "do the thing". **A hook that only wants to move the
 * stop must say `{ exit: false, sl: ... }`**, or it will close the trade.
 */
export interface ExitHookDecision {
  /** Explicit hold. Defaults to true when an object is returned, so `return { exit: false }`
   *  and `return false` both mean "stay in" — except in 'gate' mode, where `false` lets a
   *  pending built-in exit stand and `{ exit: false }` vetoes it. */
  exit?: boolean;
  /** Fill price for the exit. Defaults to this bar's close. Must lie within the bar's
   *  high/low — a price the bar never traded could not have filled, so the engine refuses it
   *  rather than booking a fill that could not have happened. */
  price?: number;
  /** Replaces the auto-generated detail text on the exit. */
  reason?: string;
  /** Move the stop to this absolute price. Applied whether or not the trade exits this bar,
   *  and takes effect from the NEXT bar's touch check. Must stay on the losing side of the
   *  current close (below it for a long, above it for a short). Unlike the Pivot Trailing
   *  Stop this is NOT ratcheted — a hook may widen a stop, so check before you do. */
  sl?: number;
  /** Move the target to this absolute price. Same timing as `sl`. Must stay on the winning
   *  side of the current close. */
  target?: number;
}

/**
 * What an exit hook may return.
 *
 * - `false` / `null` / `undefined` — no opinion. Holds in 'replace' mode; in 'gate' mode a
 *   pending built-in exit still fires.
 * - `true` — close the trade at this bar's close.
 * - an `ExitHookDecision` — close it with overrides, or hold and adjust the stop/target.
 */
export type ExitHookResult = boolean | null | undefined | ExitHookDecision;

/** A user-authored trade-management algorithm. Must be pure with respect to everything
 *  except `ctx.state` — the engine may call it for bars it later discards. */
export type ExitHook = (ctx: ExitHookContext) => ExitHookResult;

/** One registry entry. `label` is what the config UI shows in its dropdown. */
export interface ExitHookEntry {
  label: string;
  /** Optional one-line description, shown under the dropdown. */
  description?: string;
  hook: ExitHook;
}
