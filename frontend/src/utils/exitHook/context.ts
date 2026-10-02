/**
 * @backtest-only
 *
 * Assembles the ExitHookContext for one open position on one bar.
 *
 * Everything expensive is deferred. Unlike the entry path — which only reaches a hook on a
 * signal bar, a few percent of the session — this one runs on EVERY bar a trade is open, so
 * an eager context would make simply holding a position cost more than finding one. The
 * candle-window slice, the leg sequence, the leg-feature window, MFE/MAE and the engine's own
 * market read are all built on first access and memoized for the life of the context. A hook
 * that reads nothing but `ctx.position` pays almost nothing per bar.
 *
 * `env` is a thunk the ENGINE supplies, for the same reason `buildEntryHookContext` takes its
 * metrics pre-computed: everything in it comes from cached accessors that live in
 * autoBacktestEngine, and value-importing those here would close a runtime import cycle
 * (engine → strategies/exits → utils/exitHook → engine).
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
import type { ExitHookContext, ExitPositionView, PendingExit } from './types';

/** Default rolling window handed to an exit hook, in candles. Overridden by
 *  AutoBacktestConfig.exitHookLookback (Session Settings → Exit Hook Candles).
 *
 *  Smaller than the entry hook's 1200 on purpose: this context is rebuilt on every bar of
 *  every open trade rather than on signal bars only, and trade management reads recent price
 *  action — the bars since entry — far more often than deep history. Raise it in Session
 *  Settings if a hook needs more. */
export const DEFAULT_EXIT_HOOK_LOOKBACK = 400;
export const EXIT_HOOK_LOOKBACK_MIN = 50;
export const EXIT_HOOK_LOOKBACK_MAX = 5000;

export function resolveExitHookLookback(config: Pick<AutoBacktestConfig, 'exitHookLookback'>): number {
  const raw = config.exitHookLookback ?? DEFAULT_EXIT_HOOK_LOOKBACK;
  if (!Number.isFinite(raw)) return DEFAULT_EXIT_HOOK_LOOKBACK;
  return Math.min(EXIT_HOOK_LOOKBACK_MAX, Math.max(EXIT_HOOK_LOOKBACK_MIN, Math.floor(raw)));
}

/** The engine-computed bar read, supplied as a thunk and called at most once per context. */
export interface ExitHookEnv {
  ltMarket: string;
  htMarket: string;
  pivotSeq: string;
  pivots: PivotPoint[];
  ema21: number | null;
  ema60: number | null;
  atr: number;
  /** Newest COMPLETED leg on the position's own side, or null. */
  legWindow: LegWindow | null;
  /** Instrumentation graded over `legWindow`. */
  metrics: EntryMetricsSnapshot;
}

/** The raw position fields the view is derived from — the intersection of the store's
 *  BacktestPosition and the batch simulator's SimPosition. */
export interface ExitHookPositionInput {
  id?: string;
  /** Signed: + long, − short. */
  quantity: number;
  averagePrice: number;
  stopLoss?: number;
  target?: number;
  entryBarIndex?: number;
  slTrailed?: boolean;
}

export interface BuildExitHookContextArgs {
  candles: Candle[];
  currentIndex: number;
  config: AutoBacktestConfig;
  rules: RegimeRules;
  regime: RegimeKey;
  position: ExitHookPositionInput;
  pendingExit: PendingExit | null;
  /** Built on first access to any market field. See the note at the top of this file. */
  env: () => ExitHookEnv;
  /** Per-run scratch object. Owned by the caller so it survives across bars. */
  state: Record<string, unknown>;
  /** Collects ctx.log() calls for this one invocation. */
  logs: string[];
}

export function buildExitHookContext(args: BuildExitHookContextArgs): ExitHookContext {
  const { candles, currentIndex, config, position } = args;

  let envCache: ExitHookEnv | null = null;
  const env = (): ExitHookEnv => {
    if (envCache === null) envCache = args.env();
    return envCache;
  };

  let windowCache: Candle[] | null = null;
  const window = (): Candle[] => {
    if (windowCache === null) {
      const lookback = resolveExitHookLookback(config);
      windowCache = candles.slice(Math.max(0, currentIndex - lookback + 1), currentIndex + 1);
    }
    return windowCache;
  };

  let signalsCache: (string | null)[] | null = null;
  const signals = (): (string | null)[] => {
    if (signalsCache === null) {
      // signalsByBar is dense and absolutely indexed over the FULL array; re-slice it to line
      // up with the window so ctx.signals[i] describes ctx.candles[i]. Reading it past
      // currentIndex would be lookahead, so the slice stops there.
      const { signalsByBar } = getAlBrooksRunUpTo(candles, currentIndex);
      const start = currentIndex - window().length + 1;
      const out: (string | null)[] = [];
      for (let i = start; i <= currentIndex; i++) out.push(signalsByBar[i] ?? null);
      signalsCache = out;
    }
    return signalsCache;
  };

  let legsCache: LegSegment[] | null = null;
  const legFeatureCache = new Map<string, LegPatternWindow>();

  const positionView = buildPositionView(candles, currentIndex, position);

  const ctx: ExitHookContext = {
    get candles() { return window(); },
    get index() { return window().length - 1; },
    absoluteIndex: currentIndex,
    candle: candles[currentIndex],
    fullCandles: candles,

    position: positionView,
    pendingExit: args.pendingExit,

    regime: args.regime,
    get ltMarket() { return env().ltMarket; },
    get htMarket() { return env().htMarket; },
    get pivotSeq() { return env().pivotSeq; },
    get ema21() { return env().ema21; },
    get ema60() { return env().ema60; },
    get atr() { return env().atr; },
    get pivots() { return env().pivots; },
    get metrics() { return env().metrics; },
    get legWindow() { return env().legWindow; },
    get signals() { return signals(); },
    get signal() {
      const { signalsByBar } = getAlBrooksRunUpTo(candles, currentIndex);
      return signalsByBar[currentIndex] ?? null;
    },

    legs() {
      if (legsCache === null) {
        // Same two load-bearing choices as legPattern/index.ts and the entry hook's context:
        // the run comes off the shared cache (filtered by each leg's FREEZE bar, not its
        // endIndex), and detail is 'full' because a hook has no way to declare what it needs.
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

  return ctx;
}

/** Normalizes the store's signed-quantity position into the shape a hook reads, with the
 *  excursion fields deferred — the MFE/MAE scan is O(bars in trade) and most hooks never
 *  look at it. */
function buildPositionView(
  candles: Candle[],
  currentIndex: number,
  position: ExitHookPositionInput
): ExitPositionView {
  const isLong = position.quantity > 0;
  const side: 'long' | 'short' = isLong ? 'long' : 'short';
  const entryPrice = position.averagePrice;
  const entryBarIndex = position.entryBarIndex ?? null;
  const close = candles[currentIndex].close;

  let excursionCache: { mfePoints: number; maePoints: number } | null = null;
  const excursion = (): { mfePoints: number; maePoints: number } | null => {
    if (entryBarIndex === null) return null;
    if (excursionCache === null) {
      let best = Number.NEGATIVE_INFINITY;
      let worst = Number.NEGATIVE_INFINITY;
      const from = Math.max(0, entryBarIndex);
      for (let i = from; i <= currentIndex; i++) {
        const bar = candles[i];
        const fav = isLong ? bar.high - entryPrice : entryPrice - bar.low;
        const adv = isLong ? entryPrice - bar.low : bar.high - entryPrice;
        if (fav > best) best = fav;
        if (adv > worst) worst = adv;
      }
      excursionCache = {
        mfePoints: Number.isFinite(best) ? best : 0,
        maePoints: Number.isFinite(worst) ? worst : 0,
      };
    }
    return excursionCache;
  };

  return {
    id: position.id,
    side,
    quantity: Math.abs(position.quantity),
    signedQuantity: position.quantity,
    entryPrice,
    entryBarIndex,
    barsInTrade: entryBarIndex === null ? null : currentIndex - entryBarIndex,
    stopLoss: position.stopLoss ?? null,
    target: position.target ?? null,
    slTrailed: position.slTrailed === true,
    openPoints: isLong ? close - entryPrice : entryPrice - close,
    riskPoints: position.stopLoss === undefined || position.stopLoss <= 0
      ? null
      : (isLong ? close - position.stopLoss : position.stopLoss - close),
    get mfePoints() { return excursion()?.mfePoints ?? null; },
    get maePoints() { return excursion()?.maePoints ?? null; },
  };
}
