/**
 * @backtest-only
 *
 * Assembles the EntryHookContext for one trigger bar.
 *
 * Everything expensive is a thunk. A hook that only reads `candles` and `metrics` must not
 * pay for a leg sequence, so `legs()` and `legFeatures()` build on first access and memoize
 * for the life of the context — the same discipline `legPatternCtx` uses in the engine.
 */
import type { Candle, LegSegment } from '../../types';
import type { PivotPoint } from '../indicators';
import { getAlBrooksRunUpTo } from '../indicators';
import { buildLegSequence } from '../legSequence';
import { buildLegWindow, type LegWindow as LegPatternWindow } from '../legPattern';
import type {
  AutoBacktestConfig,
  EntryMetricsSnapshot,
  LegWindow,
  RegimeKey,
  RegimeRules,
} from '../autoBacktestEngine';
import type { EntryHookContext, HookTrigger } from './types';

/** Default rolling window handed to a hook, in candles. Overridden by
 *  AutoBacktestConfig.entryHookLookback (Session Settings → Custom Entry Hook). */
export const DEFAULT_ENTRY_HOOK_LOOKBACK = 1200;
export const ENTRY_HOOK_LOOKBACK_MIN = 50;
export const ENTRY_HOOK_LOOKBACK_MAX = 5000;

export function resolveHookLookback(config: Pick<AutoBacktestConfig, 'entryHookLookback'>): number {
  const raw = config.entryHookLookback ?? DEFAULT_ENTRY_HOOK_LOOKBACK;
  if (!Number.isFinite(raw)) return DEFAULT_ENTRY_HOOK_LOOKBACK;
  return Math.min(ENTRY_HOOK_LOOKBACK_MAX, Math.max(ENTRY_HOOK_LOOKBACK_MIN, Math.floor(raw)));
}

/**
 * Parse a raw Al Brooks label into a trigger, or null when the bar carries no signal.
 *
 * Labels come from `signalsByBar`, which is deliberately UNFILTERED — it records every
 * signal the counter produced, including ones the pullback-depth filter suppressed from
 * `markers`. That is what makes H3/H4/L5 reachable here when the built-in chain can only
 * ever see H1/H2/L1/L2.
 */
export function parseTrigger(label: string | null | undefined, barIndex: number): HookTrigger | null {
  if (!label) return null;
  const side = label[0] === 'H' ? 'long' : label[0] === 'L' ? 'short' : null;
  if (!side) return null;
  const count = Number.parseInt(label.slice(1), 10);
  if (!Number.isFinite(count) || count < 1) return null;
  return { label, side, count, barIndex };
}

/** Reads the raw H/L label at `index` off the shared cache. Causal by construction. */
export function hookTriggerAt(candles: Candle[], index: number): HookTrigger | null {
  const { signalsByBar } = getAlBrooksRunUpTo(candles, index);
  return parseTrigger(signalsByBar[index] ?? null, index);
}

export interface BuildHookContextArgs {
  candles: Candle[];
  currentIndex: number;
  config: AutoBacktestConfig;
  rules: RegimeRules;
  regime: RegimeKey;
  trigger: HookTrigger;
  ltMarket: string;
  htMarket: string;
  pivotSeq: string;
  pivots: PivotPoint[];
  ema21: number | null;
  ema60: number | null;
  atr: number;
  metrics: EntryMetricsSnapshot;
  legWindow: LegWindow | null;
  /** Per-run scratch object. Owned by the caller so it survives across bars. */
  state: Record<string, unknown>;
  /** Collects ctx.log() calls for this one invocation. */
  logs: string[];
}

export function buildEntryHookContext(args: BuildHookContextArgs): EntryHookContext {
  const { candles, currentIndex, config } = args;

  const lookback = resolveHookLookback(config);
  const start = Math.max(0, currentIndex - lookback + 1);
  const window = candles.slice(start, currentIndex + 1);

  // signalsByBar is dense and absolutely indexed over the FULL array; re-slice it to line up
  // with `window` so ctx.signals[i] describes ctx.candles[i]. Reading it past currentIndex
  // would be lookahead, so the slice stops there.
  const { signalsByBar } = getAlBrooksRunUpTo(candles, currentIndex);
  const signals: (string | null)[] = [];
  for (let i = start; i <= currentIndex; i++) signals.push(signalsByBar[i] ?? null);

  let legsCache: LegSegment[] | null = null;
  const legFeatureCache = new Map<string, LegPatternWindow>();

  return {
    candles: window,
    index: window.length - 1,
    absoluteIndex: currentIndex,
    candle: candles[currentIndex],
    fullCandles: candles,

    trigger: args.trigger,

    regime: args.regime,
    ltMarket: args.ltMarket,
    htMarket: args.htMarket,
    pivotSeq: args.pivotSeq,
    ema21: args.ema21,
    ema60: args.ema60,
    atr: args.atr,
    pivots: args.pivots,
    metrics: args.metrics,
    legWindow: args.legWindow,
    signals,

    legs() {
      if (legsCache === null) {
        // Same two load-bearing choices as legPattern/index.ts: the run comes off the shared
        // cache (filtered by each leg's FREEZE bar, not its endIndex — see CompletedLeg), and
        // detail is 'full' because a hook has no way to declare what it needs and silently
        // handing it empty per-candle arrays is worse than the build cost.
        legsCache = buildLegSequence(
          candles,
          currentIndex,
          config.legSequenceCount ?? 10,
          'full',
          getAlBrooksRunUpTo(candles, currentIndex)
        );
      }
      return legsCache;
    },

    legFeatures(needsPerCandle = false) {
      const key = needsPerCandle ? 'full' : 'avg';
      let cached = legFeatureCache.get(key);
      if (!cached) {
        // legSequenceCount / barRangeLookback / barOverlapLookback all come from Session
        // Settings — no metric window is a literal at this call site.
        cached = buildLegWindow(candles, currentIndex, {
          windowLegs: config.legSequenceCount ?? 10,
          needsPerCandle,
          baselineLookback: config.barRangeLookback,
          overlapLookback: config.barOverlapLookback,
        });
        legFeatureCache.set(key, cached);
      }
      return cached;
    },

    rules: args.rules,
    config,
    state: args.state,

    log(msg: string) {
      if (typeof msg === 'string' && msg.length > 0) args.logs.push(msg);
    },
  };
}
