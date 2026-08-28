// @backtest-only — pure signal evaluation, no side effects, no live imports.

import type { Candle } from '../types';
import {
  getPivotPointsUpTo,
  getAlBrooksMarkersUpTo,
  getAlBrooksLegsAt,
  getEmaValueAt,
  getAtrValueAt,
  type PivotPoint,
} from './indicators';
import {
  buildEntryHookContext,
  createHookRunState,
  hookTriggerAt,
  runEntryHook,
  type EntryHook,
  type EntryHookContext,
  type EntryHookMode,
  type HookRunState,
  type HookTrigger,
  type NormalizedDecision,
} from './entryHook';
import { getEntryHook } from '../strategies';
import {
  analyzeMarketStructureAt,
  calculateEfficiencyRatio,
  calculateBarOverlap,
  averageBarOverlap,
  calculateBarRanges,
  averageBarRanges,
  calculateBarQuality,
  averageBarQuality,
  averageBarQualityIQR,
  calculateBarBreaks,
  calculateConsecutiveBreaks,
  calculateEMASlope,
  calculateEMAInteraction,
  getPivotSequenceStats,
  averagePivotGapBars,
} from './pivotAnalysis';
import {
  buildLegWindow,
  getMatcher,
  legPatternActive,
  // NOTE the alias: this module already exports its OWN `LegWindow` (a completed
  // breakout leg's {startIndex, endIndex} bounds, used to window the flat quality
  // metrics). The leg-pattern engine's LegWindow is a whole derived feature window over
  // many segments. Two different things, one name — keep them visibly distinct here.
  type LegWindow as LegPatternWindow,
  type LegPatternConfig,
  type Matcher,
} from './legPattern';

// Enumerates every length-`length` combination of the two labels, dash-joined
// (e.g. generateBinaryPatterns('HH','LH') -> 16 strings like 'HH-HH-HH-HH').
// Used by the UI to render a fixed checklist of all possible pivot sequences.
export function generateBinaryPatterns(labelA: string, labelB: string, length = 4): string[] {
  let patterns = [''];
  for (let i = 0; i < length; i++) {
    patterns = patterns.flatMap(p => [labelA, labelB].map(l => p ? `${p}-${l}` : l));
  }
  return patterns;
}

// ─── Per-regime rules ─────────────────────────────────────────────────────────

export interface RegimeRules {
  enabled: boolean;
  direction: 'LONG_ONLY' | 'SHORT_ONLY' | 'BOTH';

  // Entry signal
  entryMode: 'PIVOT' | 'H_SIGNAL' | 'CONFLUENCE';
  allowH1: boolean;
  allowH2: boolean;
  allowL1: boolean;
  allowL2: boolean;
  confluenceLookback: number;

  // Pivot sequence filter
  ltPivotSequence: 'any' | 'HH-HL' | 'LH-HL' | 'HH-LL' | 'LH-LL';

  // High/low pivot-sequence filter — matches the last 4 same-type pivot trend labels
  // (bearish pivots for highs: HH/LH; bullish pivots for lows: HL/LL) against a whitelist
  // of allowed 4-length patterns. Requires 4 pivots of that type to be present; with fewer,
  // passes through (same undefined-passthrough convention as the other quality filters).
  highSeqFilter?: 'none' | 'custom';
  highSeqPatterns?: string[]; // e.g. ['HH-HH-HH-HH', 'LH-HH-HH-HH']
  lowSeqFilter?: 'none' | 'custom';
  lowSeqPatterns?: string[];

  // Inter-pivot spacing filter — average bar-count gap between consecutive pivots across
  // both the high and low sequences (pace of trend/pivot formation).
  pivotGapFilter?: 'none' | 'min' | 'max';
  pivotGapThreshold?: number; // bars, default 5

  // MA filter
  maFilter: 'none' | 'above_ema21' | 'on_or_above_ema21' | 'above_ema60';

  // ATR depth filter — distance of entry price from EMA21 in ATR units
  // 'max': entry must be within threshold ATRs of EMA21 (trend: avoid overextended)
  // 'min': entry must be at least threshold ATRs from EMA21 (range/gap-opposite)
  atrDepthFilter?: 'none' | 'max' | 'min';
  atrDepthThreshold?: number;

  // Kaufman Efficiency Ratio filter — [0,1] over efficiencyRatioLookback bars, near 1 = clean trend, near 0 = chop
  // 'min': entry requires ER >= threshold (trend-following — avoid entering into chop)
  // 'max': entry requires ER <= threshold (range/mean-reversion — avoid entering into a runaway trend)
  efficiencyRatioFilter?: 'none' | 'min' | 'max';
  efficiencyRatioThreshold?: number;

  // Bar overlap filter — [0,1] avg overlap ratio over barOverlapLookback bars
  // 'max': entry requires overlap <= threshold (clean/trending bars — avoid chop)
  // 'min': entry requires overlap >= threshold (choppy/range bars)
  barOverlapFilter?: 'none' | 'min' | 'max';
  barOverlapThreshold?: number;

  // Bar range filter — trend-strength/expansion over barRangeLookback bars
  // 'min'/'max': overall avg bar range (points) must be >=/<= threshold
  // 'dominance': the trade-direction-aligned avg bar range must exceed the opposite side's avg
  //              by barRangeDominanceThreshold× (e.g. bull range > bear range for longs)
  barRangeFilter?: 'none' | 'min' | 'max' | 'dominance';
  barRangeThreshold?: number;
  barRangeDominanceThreshold?: number;

  // High/low break count filter — direction-aligned (highBreakCount for longs, lowBreakCount for shorts)
  // over barBreakLookback bars. 'min': require >= threshold breaks (momentum/persistence). 'max': require <= threshold.
  barBreakFilter?: 'none' | 'min' | 'max';
  barBreakThreshold?: number;

  // Consecutive directional-break filter — longest run of bars that each broke the prior
  // bar's high WITHOUT breaking its low (mirrored for shorts), over consecutiveBreakLookback
  // bars ending at the frozen impulse-leg extreme (entry bar in PIVOT mode). The Brooks
  // "impulse micro-channel" test — distinct from barBreakFilter (total breaks, possibly scattered).
  // 'min': window must contain a run >= threshold (e.g. 4-bar breakout). 'max': run must stay <= threshold.
  consecutiveBreakFilter?: 'none' | 'min' | 'max';
  consecutiveBreakThreshold?: number; // bars, default 4

  // EMA21/EMA50 slope filters — direction-aligned (slope sign flipped for shorts) points-per-bar
  // over ema21SlopeLookback/ema50SlopeLookback bars. 'min': require aligned slope >= threshold
  // (trending in trade's favor). 'max': require aligned slope <= threshold.
  ema21SlopeFilter?: 'none' | 'min' | 'max';
  ema21SlopeThreshold?: number;
  ema50SlopeFilter?: 'none' | 'min' | 'max';
  ema50SlopeThreshold?: number;

  // EMA20 gap-bar ratio filter — [0,1] fraction of bars whose range doesn't touch EMA20
  // over emaInteractionLookback bars, not direction-aligned. 'min': require strong/persistent trend.
  // 'max': require pullback/touch conditions.
  ema20GapBarFilter?: 'none' | 'min' | 'max';
  ema20GapBarThreshold?: number;

  // EMA20 close-above-ratio ("always-in" bias) filter — direction-aligned (closeAboveRatio for longs,
  // 1 - closeAboveRatio for shorts) over emaInteractionLookback bars. 'min': require sustained bias
  // in trade's favor.
  ema20BiasFilter?: 'none' | 'min' | 'max';
  ema20BiasThreshold?: number;

  // Higher timeframe structure required for this regime
  htStructureFilter: 'any' | 'bull_trend' | 'bear_trend' | 'range' | 'reversal';

  // Lower timeframe structure required for this regime — same ltMarket read that
  // getRegimeKey uses to pick which rule-set tries first, but enforced as a hard
  // gate here rather than just an ordering preference (evaluateAutoSignals falls
  // back to trying every enabled regime's rules, not just the matched one, so this
  // is what lets a rule-set refuse to fire outside its intended structure).
  // Optional — old saved configs predate this field; treated as 'any' when unset.
  ltStructureFilter?: 'any' | 'bull_trend' | 'bear_trend' | 'range' | 'reversal';

  // Risk
  slMethod: 'pivot' | 'atr' | 'fixed';
  slAtrMultiplier: number;
  slFixedPoints: number;
  targetRR: number;

  // ── Exit engine (auto-BT positions only; the ENTRY regime's rules manage the
  //    trade for its whole life). All optional — undefined means the mechanism is
  //    off, so saved configs predating these fields behave exactly as before. ──

  // 1. Reversal exit — LT market structure reads against the position (same
  //    with/against test as the Trend Reversal flag: label startsWith Bull/Bear;
  //    'Range' is neutral and resets the against-counter) for N consecutive
  //    checked bars. Fills at bar close, exitReason REVERSAL.
  exitOnReversal?: boolean;
  exitReversalConfirmBars?: number;       // default 1
  // Structure must have read WITH the trade at least once before the exit arms
  // (mirrors checkTrendReversal's withTrendSeen gate). Exposed per-regime because
  // counter-trend regimes (range/reversal) may never see a with-trend read.
  exitReversalRequireWithTrend?: boolean; // default true

  // 2. Opposite-signal exit — an opposite Brooks pullback signal fires on the
  //    current bar (L1/L2 against a long, H1/H2 against a short; 3rd+ signals are
  //    never counted). Fills at bar close, exitReason OPP_SIGNAL.
  exitOnOppSignal?: boolean;
  exitOppAllow1?: boolean;                // default false — 1st opposite signal
  exitOppAllow2?: boolean;                // default true  — 2nd (classic Brooks reversal trigger)

  // 3. Pivot trailing stop — ratchet the SL behind the swing extreme of the most
  //    recent CONFIRMED same-side pivot (bullish pivot's 3-bar min low for longs,
  //    bearish pivot's 3-bar max high for shorts; pivots confirmed through the
  //    PRIOR bar only). Never loosens. Exit still goes through the normal SL
  //    machinery (exitReason SL, trade flagged slTrailed).
  exitTrailPivot?: boolean;
  exitTrailPivotBufferPoints?: number;    // default 2 — pad beyond the swing extreme (matches pivot slDistance's +2)

  // 4. Leg-decay exit — re-grade the newest COMPLETED with-trend leg each bar
  //    (only legs whose extreme formed after entry; windows respect
  //    legMinBarCount/legMaxBarCount). 'min' = aligned metric must stay >=
  //    threshold, 'max' = stay <= threshold; each violated check is one fail.
  //    Exit when fails >= exitLegDecayMinFails. Fills at bar close, exitReason LEG_DECAY.
  exitLegDecay?: boolean;
  exitLegDecayMinBarsInTrade?: number;    // default 3 — no decay exit before this many bars in trade
  exitLegDecayMinFails?: number;          // default 1
  exitDecayEfficiencyFilter?: 'none' | 'min' | 'max';
  exitDecayEfficiencyThreshold?: number;  // default 0.25
  exitDecayConsecBreakFilter?: 'none' | 'min' | 'max';
  exitDecayConsecBreakThreshold?: number; // default 3
  exitDecayBarBreakFilter?: 'none' | 'min' | 'max';
  exitDecayBarBreakThreshold?: number;    // default 4
  exitDecayEma21SlopeFilter?: 'none' | 'min' | 'max';
  exitDecayEma21SlopeThreshold?: number;  // default 0
  exitDecayGapBarFilter?: 'none' | 'min' | 'max';
  exitDecayGapBarThreshold?: number;      // default 0.3

  // ── Leg-pattern rule engine (utils/legPattern) ──────────────────────────────
  // An ORDERED, POSITIONAL shape over the recent leg sequence — "three bull legs of
  // 3-10 candles each, each followed by a shallow retrace" — which none of the flat
  // filters above can express, because a per-window average is precisely the thing that
  // averages a sequence away. Each leg slot carries the conditions on the pullback that
  // FOLLOWED it, nested inside the slot rather than configured separately.
  //
  // Optional and undefined by default — deliberately absent from defaultLongRules /
  // defaultShortRules / defaultRangeRules / AUTO_BT_PRESETS, because undefined IS the
  // identity state and there is no config-migration layer to backfill it. Read it only
  // through passesLegPattern, which treats undefined and enabled:false as a strict no-op.
  legPattern?: LegPatternConfig;

  // ── Custom entry hook (utils/entryHook + src/strategies) ────────────────────
  // A user-authored TypeScript function that decides entries programmatically. Where
  // legPattern above describes a shape declaratively, this runs arbitrary code: it can read
  // the last `entryHookLookback` candles plus every metric the engine computed at the bar,
  // and return false, true, or a decision overriding side / quantity / SL / target.
  //
  // Addressed by string id rather than held as a function, because the batch simulator runs
  // in a Web Worker and only the serialized config crosses postMessage — the worker resolves
  // the id against its own import of src/strategies.
  //
  // Both fields optional and absent from defaults/presets: undefined IS the identity state
  // and there is no config-migration layer. Read them only through resolveEntryHook.
  entryHookId?: string;
  // 'off'     — not consulted (default).
  // 'gate'    — the built-in filter chain runs first; the hook is the final say and may
  //             still override side/qty/SL/target, having seen the engine's own SL/TP.
  // 'replace' — the whole passesXxx chain and the leg-strength block are skipped; every H/L
  //             signal bar goes straight to the hook.
  //
  // NOTE: whenever this is not 'off', allowH1/allowH2 (and allowL1/allowL2) stop gating —
  // EVERY H/L count reaches the hook, including the H3+/L3+ the built-in chain can never
  // enter on. That is the point of the feature; the hook does its own trigger filtering.
  entryHookMode?: EntryHookMode;
}

// ─── Global config ────────────────────────────────────────────────────────────

export interface AutoBacktestConfig {
  enabled: boolean;
  // true  — a signal is skipped entirely while any position is open (default).
  // false — MULTI-TRADE MODE: every qualifying signal opens its own independent
  //         trade with its own SL/TP/qty, running concurrently with the others
  //         (long and short can be open at the same time). See isMultiTradeMode.
  skipIfPositionOpen: boolean;
  // Multi-trade mode only — hard cap on concurrently open independent trades.
  // 0 = unlimited. undefined on configs saved before this field existed, so
  // always read it as `?? MULTI_TRADE_DEFAULT_CAP`.
  maxOpenPositions?: number;

  // Trading time window (IST, 24h "HH:MM" — applied to candle timestamps)
  tradeStartTime: string;  // e.g. "09:15" — skip entries before this
  tradeEndTime: string;    // e.g. "14:30" — skip entries after this

  // Auto quantity sizing
  useAutoQty: boolean;     // false = use manual tradeQuantity from store
  riskPerTrade: number;    // ₹ risked per trade when useAutoQty is true
  minQuantity: number;     // block trade if auto-qty < this

  // Intraday auto square-off
  autoSquareOff: boolean;  // close any open position at squareOffTime
  squareOffTime: string;   // "HH:MM" IST — default "15:10"

  // SL/TP fill price mode — governs every backtest exit (manual + auto), not just auto-engine trades
  // 'exact': fill at the sl/tp price itself the instant intrabar high/low touches it (default — no slippage)
  // 'close': legacy — only fire once candle CLOSE crosses the level, filled at that close (can overshoot the
  //          planned risk when a bar gaps through the level intrabar)
  slTpFillMode?: 'exact' | 'close';

  // Bar overlap instrumentation — raw regime metric recorded on trade entries
  barOverlapLookback: number; // bars looked back for the bar-overlap average (default 8)

  // Bar range instrumentation — trend-strength metric recorded on trade entries
  barRangeLookback: number; // bars looked back for bar-range trend-strength instrumentation (default 20)

  // Kaufman Efficiency Ratio instrumentation — trend efficiency metric recorded on trade entries
  efficiencyRatioLookback: number; // bars looked back for Kaufman Efficiency Ratio (default 10)

  // High/low break count instrumentation — momentum/persistence metric recorded on trade entries
  barBreakLookback: number; // bars looked back for high/low break counts (default 20)

  // Bar-quality (BRR) instrumentation — plain + IQR-trimmed body-to-range-ratio averages recorded on trade entries
  barQualityLookback?: number; // bars looked back for both BRR averages, brrAvgAtEntry / brrAvgIQRAtEntry (default 20)

  // EMA slope instrumentation — trend momentum metric recorded on trade entries
  ema21SlopeLookback: number; // bars looked back for EMA21 slope (default 10)
  ema50SlopeLookback: number; // bars looked back for EMA50 slope (default 20)

  // EMA20 interaction (Brooks gap-bar / always-in) instrumentation — recorded on trade entries
  emaInteractionLookback: number; // bars looked back for EMA20 gap-bar/always-in interaction stats (default 20)

  // Consecutive directional-break instrumentation — longest unbroken run of prior-high
  // (or prior-low) breaks within the window (Brooks impulse micro-channel)
  consecutiveBreakLookback?: number; // bars looked back for the consecutive-break run search (default 10)

  // Completed-breakout-leg window bounds — in H/L entry modes the leg-strength metrics
  // (ER, overlap, breaks, ranges, gap-bar, consecutive breaks — NOT EMA slopes) window
  // over the completed leg's own bars instead of the fixed lookbacks above.
  legMinBarCount?: number; // legs shorter than this block auto entries when a leg-strength filter is active (default 5)
  legMaxBarCount?: number; // longer legs are trimmed to their most recent this-many bars (default 15)

  // Leg-sequence context instrumentation — the last N Al Brooks impulse legs plus the
  // pullback candles between them, captured on each trade entry (legSequenceAtEntry)
  legSequenceCount?: number;            // number of impulse legs to keep back from entry (default 10)
  legSequenceDetail?: 'full' | 'avg';   // 'full' keeps per-candle brr/clv/uwr/lwr arrays (in-memory/export); 'avg' keeps only averages (default 'full')

  // Custom entry hook rolling window — how many candles (ending at and including the trigger
  // bar) are handed to a user hook as ctx.candles, so a hook never maintains its own history.
  // Clamped to [50, 5000] on read; see resolveHookLookback (default 1200).
  entryHookLookback?: number;

  // Per-regime rule sets
  uptrend: RegimeRules;   // Bull-Trend, Bull-Trending-range
  downtrend: RegimeRules; // Bear-Trend, Bear-Trending-range
  range: RegimeRules;     // Range
  reversal: RegimeRules;  // Bull-Reversal, Bear-Reversal
}

// ─── Regime key mapping ───────────────────────────────────────────────────────

export type RegimeKey = 'uptrend' | 'downtrend' | 'range' | 'reversal';

export function getRegimeKey(ltMarket: string): RegimeKey {
  if (ltMarket === 'Bull-Trend' || ltMarket === 'Bull-Trending-range') return 'uptrend';
  if (ltMarket === 'Bear-Trend' || ltMarket === 'Bear-Trending-range') return 'downtrend';
  if (ltMarket === 'Bull-Reversal' || ltMarket === 'Bear-Reversal') return 'reversal';
  return 'range';
}

export const REGIME_LABELS: Record<RegimeKey, string> = {
  uptrend: 'Uptrend',
  downtrend: 'Downtrend',
  range: 'Range',
  reversal: 'Reversal',
};

// ─── Defaults ─────────────────────────────────────────────────────────────────

const defaultLongRules: RegimeRules = {
  enabled: false,
  direction: 'LONG_ONLY',
  entryMode: 'CONFLUENCE',
  allowH1: true,
  allowH2: true,
  allowL1: false,
  allowL2: false,
  confluenceLookback: 5,
  ltPivotSequence: 'any',
  maFilter: 'above_ema21',
  htStructureFilter: 'bull_trend',
  ltStructureFilter: 'any',
  // Pre-enabled quality-setup filters — thresholds are scale-invariant (ratios, or
  // sign-only slope) so they're safe defaults across instruments/timeframes.
  barOverlapFilter: 'max',
  barOverlapThreshold: 0.4,
  barRangeFilter: 'dominance',
  barRangeDominanceThreshold: 1.0,
  ema21SlopeFilter: 'min',
  ema21SlopeThreshold: 0,
  ema50SlopeFilter: 'min',
  ema50SlopeThreshold: 0,
  slMethod: 'pivot',
  slAtrMultiplier: 1.5,
  slFixedPoints: 50,
  targetRR: 2,
};

const defaultShortRules: RegimeRules = {
  ...defaultLongRules,
  direction: 'SHORT_ONLY',
  allowH1: false,
  allowH2: false,
  allowL1: true,
  allowL2: true,
  maFilter: 'above_ema21',
  htStructureFilter: 'bear_trend',
};

const defaultRangeRules: RegimeRules = {
  ...defaultLongRules,
  direction: 'BOTH',
  entryMode: 'PIVOT',
  ltPivotSequence: 'any',
  maFilter: 'on_or_above_ema21',
  htStructureFilter: 'any',
  targetRR: 1.5,
  allowH1: true,
  allowH2: true,
  allowL1: true,
  allowL2: true,
  // Range/reversal regimes are chop-tolerant — don't inherit uptrend/downtrend's
  // trend-quality gates by default.
  barOverlapFilter: 'none',
  barRangeFilter: 'none',
  ema21SlopeFilter: 'none',
  ema50SlopeFilter: 'none',
};

// ─── Multi-trade mode ────────────────────────────────────────────────────────
// "Skip if open" unchecked turns the engine from one-net-position into N
// independent concurrent trades. Everything that behaves differently in that
// mode is gated on this single predicate — it is never true in live mode and
// never true while "Skip if open" is checked, so the default/manual/live paths
// are untouched.

export const MULTI_TRADE_DEFAULT_CAP = 5;

export function isMultiTradeMode(s: {
  isLiveMode: boolean;
  autoBacktestConfig: AutoBacktestConfig;
}): boolean {
  return !s.isLiveMode && s.autoBacktestConfig.enabled && s.autoBacktestConfig.skipIfPositionOpen === false;
}

export const defaultAutoBacktestConfig: AutoBacktestConfig = {
  enabled: false,
  skipIfPositionOpen: true,
  maxOpenPositions: MULTI_TRADE_DEFAULT_CAP,
  tradeStartTime: '09:15',
  tradeEndTime: '14:45',
  useAutoQty: true,
  riskPerTrade: 10000,
  minQuantity: 1,
  autoSquareOff: true,
  squareOffTime: '15:10',
  slTpFillMode: 'exact',
  barOverlapLookback: 8,
  barRangeLookback: 20,
  efficiencyRatioLookback: 10,
  barBreakLookback: 20,
  barQualityLookback: 20,
  ema21SlopeLookback: 10,
  ema50SlopeLookback: 20,
  emaInteractionLookback: 20,
  consecutiveBreakLookback: 10,
  legMinBarCount: 5,
  legMaxBarCount: 15,
  legSequenceCount: 10,
  legSequenceDetail: 'full',
  uptrend: { ...defaultLongRules, enabled: true },
  downtrend: { ...defaultShortRules, enabled: true },
  range: { ...defaultRangeRules, enabled: false },
  reversal: { ...defaultRangeRules, enabled: false, entryMode: 'CONFLUENCE', direction: 'BOTH', targetRR: 2 },
};

// ─── Presets ─────────────────────────────────────────────────────────────────

export const AUTO_BT_PRESETS: Record<string, Partial<AutoBacktestConfig>> = {
  'Trend Follow': {
    skipIfPositionOpen: true,
    uptrend: {
      enabled: true,
      direction: 'LONG_ONLY',
      entryMode: 'CONFLUENCE',
      allowH1: true, allowH2: true, allowL1: false, allowL2: false,
      confluenceLookback: 5,
      ltPivotSequence: 'HH-HL',
      maFilter: 'above_ema21',
      htStructureFilter: 'bull_trend',
      barOverlapFilter: 'max',
      barOverlapThreshold: 0.4,
      barRangeFilter: 'dominance',
      barRangeDominanceThreshold: 1.0,
      ema21SlopeFilter: 'min',
      ema21SlopeThreshold: 0,
      ema50SlopeFilter: 'min',
      ema50SlopeThreshold: 0,

      slMethod: 'pivot',
      slAtrMultiplier: 1.5,
      slFixedPoints: 50,
      targetRR: 2,
    },
    downtrend: {
      enabled: true,
      direction: 'SHORT_ONLY',
      entryMode: 'CONFLUENCE',
      allowH1: false, allowH2: false, allowL1: true, allowL2: true,
      confluenceLookback: 5,
      ltPivotSequence: 'LH-LL',
      maFilter: 'above_ema21',
      htStructureFilter: 'bear_trend',
      barOverlapFilter: 'max',
      barOverlapThreshold: 0.4,
      barRangeFilter: 'dominance',
      barRangeDominanceThreshold: 1.0,
      ema21SlopeFilter: 'min',
      ema21SlopeThreshold: 0,
      ema50SlopeFilter: 'min',
      ema50SlopeThreshold: 0,

      slMethod: 'pivot',
      slAtrMultiplier: 1.5,
      slFixedPoints: 50,
      targetRR: 2,
    },
    range: {
      enabled: false,
      direction: 'BOTH',
      entryMode: 'PIVOT',
      allowH1: true, allowH2: true, allowL1: true, allowL2: true,
      confluenceLookback: 5,
      ltPivotSequence: 'any',
      maFilter: 'on_or_above_ema21',
      htStructureFilter: 'any',

      slMethod: 'pivot',
      slAtrMultiplier: 1.5,
      slFixedPoints: 50,
      targetRR: 1.5,
    },
    reversal: {
      enabled: false,
      direction: 'BOTH',
      entryMode: 'CONFLUENCE',
      allowH1: true, allowH2: true, allowL1: true, allowL2: true,
      confluenceLookback: 5,
      ltPivotSequence: 'any',
      maFilter: 'on_or_above_ema21',
      htStructureFilter: 'any',

      slMethod: 'atr',
      slAtrMultiplier: 1.5,
      slFixedPoints: 50,
      targetRR: 2,
    },
  },
  'Range Trader': {
    skipIfPositionOpen: true,
    uptrend: { ...defaultLongRules, enabled: false },
    downtrend: { ...defaultShortRules, enabled: false },
    range: {
      enabled: true,
      direction: 'BOTH',
      entryMode: 'PIVOT',
      allowH1: true, allowH2: true, allowL1: true, allowL2: true,
      confluenceLookback: 5,
      ltPivotSequence: 'any',
      maFilter: 'on_or_above_ema21',
      htStructureFilter: 'any',

      slMethod: 'pivot',
      slAtrMultiplier: 1.5,
      slFixedPoints: 50,
      targetRR: 1.5,
    },
    reversal: { ...defaultRangeRules, enabled: false },
  },
  'All Regimes': {
    skipIfPositionOpen: true,
    uptrend: { ...defaultLongRules, enabled: true },
    downtrend: { ...defaultShortRules, enabled: true },
    range: { ...defaultRangeRules, enabled: true, targetRR: 1.5 },
    reversal: { ...defaultRangeRules, enabled: true, entryMode: 'CONFLUENCE', direction: 'BOTH', targetRR: 2 },
  },
};

// ─── Signal result ────────────────────────────────────────────────────────────

// Bundle of instrumentation metrics computed once per bar in evaluateAutoSignals —
// reused both for filter gating (evalLong/evalShort) and, via AutoSignal.entryMetrics,
// for stamping the resulting Trade record without recomputing.
export interface EntryMetricsSnapshot {
  barOverlapAvg?: number;
  barRangeAvg?: number;
  bullBarRangeAvg?: number;
  bearBarRangeAvg?: number;
  efficiencyRatio?: number;
  highBreakCount?: number;
  lowBreakCount?: number;
  brrAvg?: number;
  brrAvgIQR?: number;
  rangeAvg?: number;
  rangeAvgIQR?: number;
  bodyAvg?: number;
  bodyAvgIQR?: number;
  ema21Slope?: number;
  ema50Slope?: number;
  ema20GapBarRatio?: number;
  ema20CloseAboveRatio?: number;
  ema20InteractionWindow?: number;
  pivotHighSeq?: string[];
  pivotLowSeq?: string[];
  pivotGapAvgBars?: number;
  // Length verdict on the completed breakout-leg window the strength metrics above were
  // graded over. Undefined when the currentIndex fallback windows were used instead —
  // PIVOT mode, manual entry with no completed leg yet, or degenerate leg.
  legTooShort?: boolean; // leg shorter than legMinBarCount — auto entries with leg-strength filters active are blocked
  maxConsecutiveHighBreaks?: number;
  maxConsecutiveLowBreaks?: number;
}

export interface AutoSignal {
  type: 'BUY' | 'SELL';
  entryPrice: number;
  sl: number;
  tp: number;
  reason: string;
  regime: RegimeKey;
  ltMarket: string;
  htMarket: string;
  llhhPivot: string;
  entryMetrics?: EntryMetricsSnapshot;
  // Set only when a custom entry hook returned an explicit quantity. Undefined leaves
  // sizing to the engine's useAutoQty / riskPerTrade / minQuantity path — see
  // resolveTradeQuantity, which every caller must go through.
  quantity?: number;
  // Which hook produced or approved this signal, for trade attribution.
  hookId?: string;
}

// ─── Main export ──────────────────────────────────────────────────────────────

// The completed breakout-leg window (from AlBrooksMarker.legStartIndex/legEndIndex,
// or calculateAlBrooksLegs for manual entries) over which the trend-strength metrics
// are computed for pullback-continuation entries.
export interface LegWindow {
  startIndex: number;
  endIndex: number;
}

// Instrumentation snapshot for a single bar — shared by evaluateAutoSignals' filter
// gating (below), manual trade entry recording (sharedActions), and the config UI's
// live filter-preview (autobacktest-visuals/). Kept as one function so every call
// site derives every metric identically.
//
// When legWindow is given (H/L-signal entries + direction-matched manual entries),
// the leg-strength metrics (ER, overlap, breaks, bar ranges, EMA20 gap-bar,
// consecutive breaks) window over the COMPLETED breakout leg's own bars — from the
// last H/L fired before the breakout to the swing extreme frozen at the next
// pullback — trimmed to the most recent legMaxBarCount bars for long legs. Pair-wise
// metrics (overlap, breaks, ER, consecutive runs) use windowBars-1 comparisons so
// the window never reaches the bar before the leg start. Legs shorter than
// legMinBarCount are flagged legTooShort (auto entries block on it when a
// leg-strength filter is active; manual entries record over the available bars).
// EMA slopes deliberately keep their configured lookbacks (leg-end anchored).
// Inherently-"now" context (pivots, EMA20 close-above bias) always stays at
// currentIndex. Without legWindow (PIVOT mode, or no completed leg), everything
// windows at currentIndex with the configured Instrumentation Lookbacks, as before.
export function computeEntryMetrics(
  candles: Candle[],
  currentIndex: number,
  config: AutoBacktestConfig,
  legWindow?: LegWindow | null
): EntryMetricsSnapshot {
  const pivots = getPivotPointsUpTo(candles, currentIndex);
  const pivotSeqStats = getPivotSequenceStats(pivots, 4);

  const leg = legWindow && legWindow.endIndex >= 0 ? legWindow : null;
  const end = leg ? leg.endIndex : currentIndex;
  const legBarCount = leg ? Math.max(1, leg.endIndex - leg.startIndex + 1) : undefined;
  const windowBars = legBarCount !== undefined
    ? Math.min(legBarCount, config.legMaxBarCount ?? 15)
    : undefined;

  const barOverlapRatios = calculateBarOverlap(candles, end,
    windowBars !== undefined ? windowBars - 1 : (config.barOverlapLookback ?? 8));
  const barRangeSamples = calculateBarRanges(candles, end,
    windowBars ?? (config.barRangeLookback ?? 20));
  const { barRangeAvg, bullBarRangeAvg, bearBarRangeAvg } = averageBarRanges(barRangeSamples);
  const { highBreakCount, lowBreakCount } =
    calculateBarBreaks(candles, end,
      windowBars !== undefined ? windowBars - 1 : (config.barBreakLookback ?? 20));
  const barQualitySamples = calculateBarQuality(candles, end,
    windowBars ?? (config.barQualityLookback ?? 20));
  // Both BRR averages over the SAME window: the plain mean (every bar counted) and
  // the IQR-trimmed mean (Tukey-fence outliers dropped). Kept side by side so a
  // window skewed by one freak bar is visible as a gap between the two.
  const { brrAvg, rangeAvg, bodyAvg } = averageBarQuality(barQualitySamples);
  const { brrAvgIQR, rangeAvgIQR, bodyAvgIQR } = averageBarQualityIQR(barQualitySamples);
  const legInteraction = calculateEMAInteraction(candles, end, 20,
    windowBars ?? (config.emaInteractionLookback ?? 20));
  // Close-above bias is "always-in" context at the entry bar, not a leg-strength
  // metric — so it windows at currentIndex (with its configured lookback) even
  // when the leg window is active.
  const entryInteraction = end === currentIndex && windowBars === undefined
    ? legInteraction
    : calculateEMAInteraction(candles, currentIndex, 20, config.emaInteractionLookback ?? 20);
  const gapBarRatio = legInteraction.gapBarRatio;
  const closeAboveRatio = entryInteraction.closeAboveRatio;
  const ema20InteractionWindow = entryInteraction.barsCompared;
  const consecutiveBreaks = calculateConsecutiveBreaks(candles,
    windowBars !== undefined ? end - windowBars + 1 : end - (config.consecutiveBreakLookback ?? 10),
    end);
  return {
    barOverlapAvg: averageBarOverlap(barOverlapRatios),
    barRangeAvg,
    bullBarRangeAvg,
    bearBarRangeAvg,
    efficiencyRatio: calculateEfficiencyRatio(candles, end,
      windowBars !== undefined ? windowBars - 1 : (config.efficiencyRatioLookback ?? 10)),
    highBreakCount,
    lowBreakCount,
    brrAvg,
    brrAvgIQR,
    rangeAvg,
    rangeAvgIQR,
    bodyAvg,
    bodyAvgIQR,
    ema21Slope: calculateEMASlope(candles, end, 21, config.ema21SlopeLookback ?? 10),
    ema50Slope: calculateEMASlope(candles, end, 50, config.ema50SlopeLookback ?? 20),
    ema20GapBarRatio: gapBarRatio,
    ema20CloseAboveRatio: closeAboveRatio,
    ema20InteractionWindow,
    pivotHighSeq: pivotSeqStats.highSeq,
    pivotLowSeq: pivotSeqStats.lowSeq,
    pivotGapAvgBars: averagePivotGapBars(pivotSeqStats),
    legTooShort: legBarCount !== undefined
      ? legBarCount < (config.legMinBarCount ?? 5)
      : undefined,
    maxConsecutiveHighBreaks: consecutiveBreaks.maxConsecutiveHighBreaks,
    maxConsecutiveLowBreaks: consecutiveBreaks.maxConsecutiveLowBreaks,
  };
}

// ─── Custom entry hook plumbing ───────────────────────────────────────────────

/** Per-bar hook environment, built once in evaluateAutoSignals and shared by every regime
 *  tried at that bar. The context itself is built per (regime, direction) because it carries
 *  the regime's rules and its instrumentation snapshot. */
export interface HookBarEnv {
  /** The raw H/L signal at this bar, or null. Null means no hook runs here at all. */
  trigger: HookTrigger | null;
  /** Scratch + error bookkeeping that persists across bars for the whole run. */
  runState: HookRunState;
  /** The completed breakout leg on the trigger's own side, or null. Bar-level, not
   *  per-regime, so both hook modes hand the hook the same leg. */
  legWindow: LegWindow | null;
  buildCtx: (args: {
    rules: RegimeRules;
    regime: RegimeKey;
    metrics: EntryMetricsSnapshot;
    logs: string[];
  }) => EntryHookContext;
}

/** What a regime's hook settings resolve to. */
export interface ResolvedHook {
  mode: 'gate' | 'replace';
  id: string;
  /** null when the configured id is not in the registry — the regime then takes no trades,
   *  rather than silently falling back to the built-in chain. A hook the user switched on
   *  must never be skipped without saying so (same reasoning as passesLegPattern). */
  hook: EntryHook | null;
}

export function resolveEntryHook(rules: RegimeRules): ResolvedHook | null {
  const mode = rules.entryHookMode ?? 'off';
  if (mode !== 'gate' && mode !== 'replace') return null;
  const id = rules.entryHookId ?? '';
  if (!id) return null; // a mode with no hook chosen is still the identity state
  return { mode, id, hook: getEntryHook(id) ?? null };
}

/** True when this regime consults a hook at all — used to widen the allowed H/L set. */
export function entryHookActive(rules: RegimeRules): boolean {
  return resolveEntryHook(rules) !== null;
}

/** Fold a hook's logs and reason into the engine's own reason string. */
function hookReason(base: string, decision: NormalizedDecision, hookId: string): string {
  const head = decision.reason ?? base;
  const tail = decision.logs.length > 0 ? ` | ${decision.logs.join(' ; ')}` : '';
  return `${head} [hook:${hookId}]${tail}`;
}

export function evaluateAutoSignals(
  candles: Candle[],
  currentIndex: number,
  config: AutoBacktestConfig,
  // Per-RUN hook state — the scratch object hooks keep across bars, plus trapped-error
  // bookkeeping. Owned by the caller (batch simulator / store action) because this function
  // is per-bar and stateless. Omitted, each bar gets a fresh one: hooks still work, but
  // ctx.state no longer carries between bars.
  hookRunState?: HookRunState
): AutoSignal | null {
  if (currentIndex < 50 || candles.length < 51) return null;

  const currentCandle = candles[currentIndex];
  const currentTs = currentCandle.timestamp;

  // Pre-compute indicators (shared across every regime's evaluation below) —
  // cached lookups against the full candles array so a bar-by-bar auto-backtest
  // run doesn't re-derive pivots/AlBrooks/EMA/ATR from scratch every single bar.
  const pivots = getPivotPointsUpTo(candles, currentIndex);
  const alBrooks = getAlBrooksMarkersUpTo(candles, currentIndex);
  const ema21 = getEmaAt(candles, currentIndex, 21);
  const ema60 = getEmaAt(candles, currentIndex, 60);
  const atr = getAtrAt(candles, currentIndex);

  // Detect regime from LT market structure
  const { ltMarket, htMarket } = analyzeMarketStructureAt(candles, currentIndex, pivots);
  const matchedRegime = getRegimeKey(ltMarket);

  // Shared indicators at this bar
  const currentPivot = pivots.find(p => p.time === currentTs) ?? null;
  const currentAbMarker = alBrooks.find(m => m.time === currentTs) ?? null;
  const pivotSeq = getPivotSeq(pivots);

  // Try the auto-detected regime first — this reproduces the old single-regime behavior
  // exactly when only that regime is configured. Then fall back to any other *enabled*
  // regime, so a regime's H1/H2/entry setup fires whenever its own rules (enabled, HT
  // filter, quality filters) pass, instead of being silently skipped just because the
  // bar happens to be classified into a different regime than the one you configured.
  const regimeOrder: RegimeKey[] = [
    matchedRegime,
    ...(['uptrend', 'downtrend', 'range', 'reversal'] as RegimeKey[]).filter(k => k !== matchedRegime),
  ];

  // computeEntryMetrics's result depends only on (candles, currentIndex, config's
  // GLOBAL lookback fields, legWindow) — never on which regime is asking — and
  // legWindow itself is derived only from currentAbMarker + entryMode==='PIVOT',
  // both bar-level, not per-regime. So across the up-to-4 regimes tried below there
  // are at most 2 distinct snapshots (PIVOT-mode window vs. the one shared H/L leg
  // window). Cache per bar instead of recomputing per regime.
  const entryMetricsCache = new Map<string, EntryMetricsSnapshot>();
  const getEntryMetrics = (legWindow: LegWindow | null): EntryMetricsSnapshot => {
    const key = legWindow ? `${legWindow.startIndex}-${legWindow.endIndex}` : 'none';
    let cached = entryMetricsCache.get(key);
    if (!cached) {
      cached = computeEntryMetrics(candles, currentIndex, config, legWindow);
      entryMetricsCache.set(key, cached);
    }
    return cached;
  };

  // Leg-pattern feature window — same per-bar-cache reasoning as entryMetrics above, but
  // built LAZILY: it is the single most expensive thing on this path, and a session with
  // no pattern configured must never pay for it. Nothing here runs unless some enabled
  // regime's pattern gate actually asks. Keyed on detail because the up-to-4 regimes tried
  // per bar may differ in whether they need the per-candle arrays.
  //
  // legSequenceCount / barRangeLookback / barOverlapLookback all come from Session
  // Settings — no metric window is a literal at this call site.
  const legWindowCache = new Map<string, LegPatternWindow>();
  const legPatternCtx: LegPatternCtx = needsPerCandle => {
    const key = needsPerCandle ? 'full' : 'avg';
    let cached = legWindowCache.get(key);
    if (!cached) {
      cached = buildLegWindow(candles, currentIndex, {
        windowLegs: config.legSequenceCount ?? 10,
        needsPerCandle,
        baselineLookback: config.barRangeLookback,
        overlapLookback: config.barOverlapLookback,
      });
      legWindowCache.set(key, cached);
    }
    return cached;
  };

  // Custom entry hook environment for this bar. The trigger read comes off the same shared
  // AlBrooks cache the rest of the engine uses, but from `signalsByBar` rather than
  // `markers`: that array is dense, causal by construction and UNFILTERED, so H3/H4/L5 are
  // all present. `markers` is depth-filtered and would silently drop them.
  //
  // Only the label read happens eagerly (one array index). The context — and with it the
  // candle-window slice and any leg building — is constructed lazily, per regime, and only
  // once a regime actually has a hook to run.
  const hookTrigger = hookTriggerAt(candles, currentIndex);

  // The completed breakout leg the hook grades, on the TRIGGER's own side. Derived from
  // getAlBrooksLegsAt rather than currentAbMarker.legStartIndex, because a marker can have
  // been suppressed by the pullback-depth filter on exactly the H3+/L3+ bars this feature
  // exists to reach — leaving the hook with no leg on the bars it most wants one.
  const hookLegWindow: LegWindow | null = (() => {
    if (!hookTrigger) return null;
    const { bull, bear } = getAlBrooksLegsAt(candles, currentIndex);
    const leg = hookTrigger.side === 'long' ? bull : bear;
    return leg ? { startIndex: leg.startIndex, endIndex: leg.endIndex } : null;
  })();

  const hookEnv: HookBarEnv = {
    trigger: hookTrigger,
    runState: hookRunState ?? createHookRunState(),
    legWindow: hookLegWindow,
    buildCtx: ({ rules, regime, metrics, logs }) => buildEntryHookContext({
      candles,
      currentIndex,
      config,
      rules,
      regime,
      trigger: hookEnv.trigger!,
      ltMarket,
      htMarket,
      pivotSeq,
      pivots,
      ema21,
      ema60,
      atr,
      metrics,
      legWindow: hookLegWindow,
      state: hookEnv.runState.state,
      logs,
    }),
  };

  for (const regime of regimeOrder) {
    const regimeRules = config[regime];
    if (!regimeRules.enabled) continue;
    if (!passesStructureFilter(regimeRules.htStructureFilter, htMarket)) continue;
    if (!passesStructureFilter(regimeRules.ltStructureFilter, ltMarket)) continue;

    // ── Custom entry hook, 'replace' mode ────────────────────────────────────
    // The whole passesXxx chain and the leg-strength block below are skipped: the hook IS
    // the strategy. It still runs behind the enabled + structure gates above, so a regime
    // can still refuse to fire outside its intended market structure.
    const resolvedHook = resolveEntryHook(regimeRules);
    if (resolvedHook?.mode === 'replace') {
      const signal = evalHook(
        regimeRules, resolvedHook, hookEnv, currentCandle,
        getEntryMetrics(hookLegWindow), pivots, currentIndex, candles, atr,
        pivotSeq, ltMarket, htMarket, regime
      );
      if (signal) return signal;
      continue; // 'replace' never falls through to the built-in chain
    }

    // For pullback-continuation entries (H_SIGNAL/CONFLUENCE), the leg-strength filters
    // (ER, Bar Overlap, Break Count, ranges, gap-bar, consecutive breaks) window over the
    // COMPLETED breakout leg the marker carries — last H/L fired before the breakout up
    // to the swing extreme frozen at the next pullback, held constant for every signal of
    // the same pullback — trimmed to legMaxBarCount. PIVOT-mode entries have no pullback
    // concept, so they keep the configured lookback windows ending at currentIndex.
    const legWindow = (regimeRules.entryMode !== 'PIVOT' && currentAbMarker
      && currentAbMarker.legStartIndex !== undefined && currentAbMarker.legEndIndex !== undefined)
      ? { startIndex: currentAbMarker.legStartIndex, endIndex: currentAbMarker.legEndIndex }
      : null;

    // Instrumentation snapshot — computed once per candidate regime, used both for filter
    // gating below and (via the returned AutoSignal.entryMetrics) for stamping the resulting
    // Trade without recomputing.
    const entryMetrics = getEntryMetrics(legWindow);

    // Leg-strength filters grade the previous completed leg — with any of them active,
    // an H/L entry with no completed leg yet, or a leg shorter than legMinBarCount, is
    // unproven strength: block it (PIVOT mode is exempt — it has no leg concept).
    if (regimeRules.entryMode !== 'PIVOT' && legStrengthFiltersActive(regimeRules)
      && (!legWindow || entryMetrics.legTooShort)) continue;

    const gate = resolvedHook?.mode === 'gate' ? resolvedHook : null;

    if (regimeRules.direction !== 'SHORT_ONLY') {
      const signal = evalLong(regimeRules, currentCandle, currentPivot, currentAbMarker, pivots, ema21, ema60, atr, currentIndex, candles, pivotSeq, ltMarket, htMarket, regime, entryMetrics, legPatternCtx, gate, hookEnv);
      if (signal) return signal;
    }

    if (regimeRules.direction !== 'LONG_ONLY') {
      const signal = evalShort(regimeRules, currentCandle, currentPivot, currentAbMarker, pivots, ema21, ema60, atr, currentIndex, candles, pivotSeq, ltMarket, htMarket, regime, entryMetrics, legPatternCtx, gate, hookEnv);
      if (signal) return signal;
    }
  }

  return null;
}

// ─── Long evaluation ──────────────────────────────────────────────────────────

function evalLong(
  rules: RegimeRules,
  candle: Candle,
  currentPivot: PivotPoint | null,
  currentAb: { time: number; signal: string } | null,
  pivots: PivotPoint[],
  ema21: number | null,
  ema60: number | null,
  atr: number,
  currentIndex: number,
  candles: Candle[],
  pivotSeq: string,
  ltMarket: string,
  htMarket: string,
  regime: RegimeKey,
  entryMetrics: EntryMetricsSnapshot,
  legPatternCtx: LegPatternCtx | null,
  gate: ResolvedHook | null,
  hookEnv: HookBarEnv
): AutoSignal | null {
  const isBullPivot = currentPivot?.type === 'bullish';
  // With a hook gating this regime, EVERY H count qualifies as a trigger — allowH1/allowH2
  // stop gating and the hook does its own trigger filtering off ctx.trigger.count. That is
  // the only way H3+ becomes reachable; see the note on RegimeRules.entryHookMode.
  const isHSig = gate
    ? hookEnv.trigger?.side === 'long'
    : currentAb !== null && allowedHSignals(rules).has(currentAb.signal);

  let pivotForSl: PivotPoint | null = isBullPivot ? currentPivot : null;
  let triggerLabel = '';

  if (rules.entryMode === 'PIVOT') {
    if (!isBullPivot) return null;
    triggerLabel = 'Pivot';
  } else if (rules.entryMode === 'H_SIGNAL') {
    if (!isHSig) return null;
    triggerLabel = hSignalLabel(gate, currentAb, hookEnv);
    pivotForSl = findRecentBullPivot(pivots, currentIndex, candles, rules.confluenceLookback * 2);
  } else {
    if (!isHSig) return null;
    const recent = findRecentBullPivot(pivots, currentIndex, candles, rules.confluenceLookback);
    if (!recent) return null;
    pivotForSl = recent;
    triggerLabel = `CONF ${hSignalLabel(gate, currentAb, hookEnv)}`;
  }

  if (rules.ltPivotSequence !== 'any' && pivotSeq !== rules.ltPivotSequence) return null;
  if (!passesMa(rules.maFilter, candle, ema21, ema60, true)) return null;

  const entry = candle.close;
  if (!passesAtrDepth(rules, entry, ema21, atr)) return null;
  if (!passesEfficiencyRatio(rules, entryMetrics.efficiencyRatio)) return null;
  if (!passesBarOverlap(rules, entryMetrics.barOverlapAvg)) return null;
  if (!passesBarRange(rules, entryMetrics.bullBarRangeAvg, entryMetrics.bearBarRangeAvg, entryMetrics.barRangeAvg, true)) return null;
  if (!passesBarBreak(rules, entryMetrics.highBreakCount, entryMetrics.lowBreakCount, true)) return null;
  if (!passesConsecutiveBreak(rules, entryMetrics.maxConsecutiveHighBreaks, entryMetrics.maxConsecutiveLowBreaks, true)) return null;
  if (!passesEmaSlope(rules.ema21SlopeFilter, rules.ema21SlopeThreshold, entryMetrics.ema21Slope, true)) return null;
  if (!passesEmaSlope(rules.ema50SlopeFilter, rules.ema50SlopeThreshold, entryMetrics.ema50Slope, true)) return null;
  if (!passesEma20GapBar(rules, entryMetrics.ema20GapBarRatio)) return null;
  if (!passesEma20Bias(rules, entryMetrics.ema20CloseAboveRatio, true)) return null;
  if (!passesSeqFilter(rules.highSeqFilter, rules.highSeqPatterns, entryMetrics.pivotHighSeq ?? [])) return null;
  if (!passesSeqFilter(rules.lowSeqFilter, rules.lowSeqPatterns, entryMetrics.pivotLowSeq ?? [])) return null;
  if (!passesPivotGap(rules, entryMetrics.pivotGapAvgBars)) return null;
  // Last in the chain, so only the few bars that survived everything above ever build a
  // leg window. Unconfigured regimes never reach the builder at all.
  if (!passesLegPattern(rules, legPatternCtx, true)) return null;

  const sl = slLong(rules, entry, pivotForSl, atr);
  if (sl <= 0 || sl >= entry) return null;
  const risk = entry - sl;
  if (risk <= 0) return null;
  const tp = entry + risk * rules.targetRR;

  const reason = `Long [${REGIME_LABELS[regime]}] ${triggerLabel} | ${pivotSeq || '—'} | LT:${ltMarket} | HT:${htMarket}`;
  const base: AutoSignal = { type: 'BUY', entryPrice: entry, sl, tp, reason, regime, ltMarket, htMarket, llhhPivot: pivotSeq, entryMetrics };

  // The hook gate runs dead last — after every filter AND after sl/tp are computed, so the
  // hook can see the engine's own stop and target before deciding whether to override them.
  if (!gate) return base;
  return applyHookGate(base, gate, hookEnv, rules, entryMetrics, pivotForSl, atr, reason);
}

// ─── Short evaluation ─────────────────────────────────────────────────────────

function evalShort(
  rules: RegimeRules,
  candle: Candle,
  currentPivot: PivotPoint | null,
  currentAb: { time: number; signal: string } | null,
  pivots: PivotPoint[],
  ema21: number | null,
  ema60: number | null,
  atr: number,
  currentIndex: number,
  candles: Candle[],
  pivotSeq: string,
  ltMarket: string,
  htMarket: string,
  regime: RegimeKey,
  entryMetrics: EntryMetricsSnapshot,
  legPatternCtx: LegPatternCtx | null,
  gate: ResolvedHook | null,
  hookEnv: HookBarEnv
): AutoSignal | null {
  const isBearPivot = currentPivot?.type === 'bearish';
  // See evalLong: a gating hook widens the trigger set to every L count, H3+/L3+ included.
  const isLSig = gate
    ? hookEnv.trigger?.side === 'short'
    : currentAb !== null && allowedLSignals(rules).has(currentAb.signal);

  let pivotForSl: PivotPoint | null = isBearPivot ? currentPivot : null;
  let triggerLabel = '';

  if (rules.entryMode === 'PIVOT') {
    if (!isBearPivot) return null;
    triggerLabel = 'Pivot';
  } else if (rules.entryMode === 'H_SIGNAL') {
    if (!isLSig) return null;
    triggerLabel = hSignalLabel(gate, currentAb, hookEnv);
    pivotForSl = findRecentBearPivot(pivots, currentIndex, candles, rules.confluenceLookback * 2);
  } else {
    if (!isLSig) return null;
    const recent = findRecentBearPivot(pivots, currentIndex, candles, rules.confluenceLookback);
    if (!recent) return null;
    pivotForSl = recent;
    triggerLabel = `CONF ${hSignalLabel(gate, currentAb, hookEnv)}`;
  }

  if (rules.ltPivotSequence !== 'any') {
    const bearEq: Record<string, string> = { 'HH-HL': 'LH-LL', 'LH-HL': 'LH-LL', 'HH-LL': 'LH-LL', 'LH-LL': 'LH-LL' };
    const expected = bearEq[rules.ltPivotSequence] ?? rules.ltPivotSequence;
    if (pivotSeq !== expected) return null;
  }

  if (!passesMa(rules.maFilter, candle, ema21, ema60, false)) return null;

  const entry = candle.close;
  if (!passesAtrDepth(rules, entry, ema21, atr)) return null;
  if (!passesEfficiencyRatio(rules, entryMetrics.efficiencyRatio)) return null;
  if (!passesBarOverlap(rules, entryMetrics.barOverlapAvg)) return null;
  if (!passesBarRange(rules, entryMetrics.bullBarRangeAvg, entryMetrics.bearBarRangeAvg, entryMetrics.barRangeAvg, false)) return null;
  if (!passesBarBreak(rules, entryMetrics.highBreakCount, entryMetrics.lowBreakCount, false)) return null;
  if (!passesConsecutiveBreak(rules, entryMetrics.maxConsecutiveHighBreaks, entryMetrics.maxConsecutiveLowBreaks, false)) return null;
  if (!passesEmaSlope(rules.ema21SlopeFilter, rules.ema21SlopeThreshold, entryMetrics.ema21Slope, false)) return null;
  if (!passesEmaSlope(rules.ema50SlopeFilter, rules.ema50SlopeThreshold, entryMetrics.ema50Slope, false)) return null;
  if (!passesEma20GapBar(rules, entryMetrics.ema20GapBarRatio)) return null;
  if (!passesEma20Bias(rules, entryMetrics.ema20CloseAboveRatio, false)) return null;
  if (!passesSeqFilter(rules.highSeqFilter, rules.highSeqPatterns, entryMetrics.pivotHighSeq ?? [])) return null;
  if (!passesSeqFilter(rules.lowSeqFilter, rules.lowSeqPatterns, entryMetrics.pivotLowSeq ?? [])) return null;
  if (!passesPivotGap(rules, entryMetrics.pivotGapAvgBars)) return null;
  if (!passesLegPattern(rules, legPatternCtx, false)) return null;

  const sl = slShort(rules, entry, pivotForSl, atr);
  if (sl <= 0 || sl <= entry) return null;
  const risk = sl - entry;
  if (risk <= 0) return null;
  const tp = entry - risk * rules.targetRR;
  if (tp <= 0) return null;

  const reason = `Short [${REGIME_LABELS[regime]}] ${triggerLabel} | ${pivotSeq || '—'} | LT:${ltMarket} | HT:${htMarket}`;
  const base: AutoSignal = { type: 'SELL', entryPrice: entry, sl, tp, reason, regime, ltMarket, htMarket, llhhPivot: pivotSeq, entryMetrics };

  if (!gate) return base;
  return applyHookGate(base, gate, hookEnv, rules, entryMetrics, pivotForSl, atr, reason);
}

// ─── Custom entry hook — evaluation ───────────────────────────────────────────

function allowedHSignals(rules: RegimeRules): Set<string> {
  const allowed = new Set<string>();
  if (rules.allowH1) allowed.add('H1');
  if (rules.allowH2) allowed.add('H2');
  return allowed;
}

function allowedLSignals(rules: RegimeRules): Set<string> {
  const allowed = new Set<string>();
  if (rules.allowL1) allowed.add('L1');
  if (rules.allowL2) allowed.add('L2');
  return allowed;
}

// With a gating hook the marker may not exist at all — the pullback-depth filter suppresses
// markers on exactly the H3+/L3+ bars a hook is there to reach — so the label comes from the
// unfiltered trigger instead.
function hSignalLabel(
  gate: ResolvedHook | null,
  currentAb: { time: number; signal: string } | null,
  hookEnv: HookBarEnv
): string {
  if (gate) return hookEnv.trigger?.label ?? '';
  return currentAb?.signal ?? '';
}

/** Build the sl/tp the engine itself would use, for a given side and entry price. Shared by
 *  both hook modes so an overriding hook always starts from the same base the built-in
 *  chain would have produced. */
function hookDefaultsFor(
  rules: RegimeRules,
  pivotForSl: PivotPoint | null,
  atr: number
) {
  return (side: 'long' | 'short', entryPrice: number) => {
    const sl = side === 'long'
      ? slLong(rules, entryPrice, pivotForSl, atr)
      : slShort(rules, entryPrice, pivotForSl, atr);
    if (sl <= 0) return null;
    const risk = side === 'long' ? entryPrice - sl : sl - entryPrice;
    if (risk <= 0) return null;
    const tp = side === 'long' ? entryPrice + risk * rules.targetRR : entryPrice - risk * rules.targetRR;
    if (tp <= 0) return null;
    return { sl, tp };
  };
}

/** Turn a validated decision into an AutoSignal, carrying over the bar-level context. */
function signalFromDecision(
  decision: NormalizedDecision,
  hookId: string,
  reason: string,
  regime: RegimeKey,
  ltMarket: string,
  htMarket: string,
  pivotSeq: string,
  entryMetrics: EntryMetricsSnapshot
): AutoSignal {
  return {
    type: decision.side === 'long' ? 'BUY' : 'SELL',
    entryPrice: decision.entryPrice,
    sl: decision.sl,
    tp: decision.tp,
    reason: hookReason(reason, decision, hookId),
    regime,
    ltMarket,
    htMarket,
    llhhPivot: pivotSeq,
    entryMetrics,
    quantity: decision.quantity,
    hookId,
  };
}

/**
 * 'gate' mode — the built-in chain already approved this entry and computed sl/tp. The hook
 * sees both and has the final say, and may still override side/qty/SL/target.
 */
function applyHookGate(
  base: AutoSignal,
  gate: ResolvedHook,
  hookEnv: HookBarEnv,
  rules: RegimeRules,
  entryMetrics: EntryMetricsSnapshot,
  pivotForSl: PivotPoint | null,
  atr: number,
  reason: string
): AutoSignal | null {
  // A hook the user switched on must never be silently skipped — a missing registry entry
  // means the id was renamed or deleted, and passing the trade through would quietly run a
  // strategy the config no longer describes.
  if (!gate.hook || !hookEnv.trigger) return null;

  const logs: string[] = [];
  const ctx = hookEnv.buildCtx({ rules, regime: base.regime, metrics: entryMetrics, logs });
  const decision = runEntryHook({
    hook: gate.hook,
    ctx,
    rules,
    defaults: { compute: hookDefaultsFor(rules, pivotForSl, atr), entryPrice: base.entryPrice },
    logs,
    runState: hookEnv.runState,
  });
  if (!decision) return null;

  return signalFromDecision(
    decision, gate.id, reason, base.regime, base.ltMarket, base.htMarket,
    base.llhhPivot, entryMetrics
  );
}

/**
 * 'replace' mode — no built-in filters ran at all. Every H/L signal bar in an enabled
 * regime that passed the structure gates reaches the hook, at any counter value.
 *
 * Direction is NOT pre-filtered on the trigger's side: a hook is allowed to fade its trigger
 * (short an H3), and runEntryHook checks the FINAL side against rules.direction.
 */
function evalHook(
  rules: RegimeRules,
  resolved: ResolvedHook,
  hookEnv: HookBarEnv,
  candle: Candle,
  entryMetrics: EntryMetricsSnapshot,
  pivots: PivotPoint[],
  currentIndex: number,
  candles: Candle[],
  atr: number,
  pivotSeq: string,
  ltMarket: string,
  htMarket: string,
  regime: RegimeKey
): AutoSignal | null {
  const trigger = hookEnv.trigger;
  if (!trigger) return null;
  if (!resolved.hook) return null; // see applyHookGate — fail closed on an unknown id

  // Same pivot the built-in chain would have anchored a pivot-method stop to, so
  // slMethod: 'pivot' keeps working when a hook leaves the stop to the engine.
  const pivotForSl = trigger.side === 'long'
    ? findRecentBullPivot(pivots, currentIndex, candles, rules.confluenceLookback * 2)
    : findRecentBearPivot(pivots, currentIndex, candles, rules.confluenceLookback * 2);

  const logs: string[] = [];
  const ctx = hookEnv.buildCtx({ rules, regime, metrics: entryMetrics, logs });
  const decision = runEntryHook({
    hook: resolved.hook,
    ctx,
    rules,
    defaults: { compute: hookDefaultsFor(rules, pivotForSl, atr), entryPrice: candle.close },
    logs,
    runState: hookEnv.runState,
  });
  if (!decision) return null;

  const dirWord = decision.side === 'long' ? 'Long' : 'Short';
  const reason = `${dirWord} [${REGIME_LABELS[regime]}] ${trigger.label} | ${pivotSeq || '—'} | LT:${ltMarket} | HT:${htMarket}`;

  return signalFromDecision(
    decision, resolved.id, reason, regime, ltMarket, htMarket, pivotSeq, entryMetrics
  );
}

/**
 * Run just the hook for one bar, for the config UI's live filter-preview strip.
 *
 * Returns undefined when the hook is not consulted at this bar at all — no hook configured,
 * or no H/L signal fired — so the strip can omit the column instead of scoring a
 * non-decision as a failure. Otherwise true/false is exactly what the real engine's gate
 * would have concluded, because it goes through the same buildEntryHookContext +
 * runEntryHook path.
 *
 * Caveat worth knowing when reading the strip: each previewed bar gets a FRESH run state,
 * so a hook whose answer depends on ctx.state (a cooldown, a counter) will preview
 * differently from how it behaves inside a real run, where that state accumulates.
 */
export function previewEntryHook(
  candles: Candle[],
  currentIndex: number,
  config: AutoBacktestConfig,
  rules: RegimeRules,
  regime: RegimeKey,
  metrics: EntryMetricsSnapshot
): boolean | undefined {
  const resolved = resolveEntryHook(rules);
  if (!resolved) return undefined;
  const trigger = hookTriggerAt(candles, currentIndex);
  if (!trigger) return undefined;
  if (!resolved.hook) return false; // unknown id — fails closed, same as the engine

  const pivots = getPivotPointsUpTo(candles, currentIndex);
  const { ltMarket, htMarket } = analyzeMarketStructureAt(candles, currentIndex, pivots);
  const { bull, bear } = getAlBrooksLegsAt(candles, currentIndex);
  const leg = trigger.side === 'long' ? bull : bear;
  const atr = getAtrAt(candles, currentIndex);

  const logs: string[] = [];
  const runState = createHookRunState();
  const ctx = buildEntryHookContext({
    candles,
    currentIndex,
    config,
    rules,
    regime,
    trigger,
    ltMarket,
    htMarket,
    pivotSeq: getPivotSeq(pivots),
    pivots,
    ema21: getEmaAt(candles, currentIndex, 21),
    ema60: getEmaAt(candles, currentIndex, 60),
    atr,
    metrics,
    legWindow: leg ? { startIndex: leg.startIndex, endIndex: leg.endIndex } : null,
    state: runState.state,
    logs,
  });

  const pivotForSl = trigger.side === 'long'
    ? findRecentBullPivot(pivots, currentIndex, candles, rules.confluenceLookback * 2)
    : findRecentBearPivot(pivots, currentIndex, candles, rules.confluenceLookback * 2);

  return runEntryHook({
    hook: resolved.hook,
    ctx,
    rules,
    defaults: {
      compute: hookDefaultsFor(rules, pivotForSl, atr),
      entryPrice: candles[currentIndex].close,
    },
    logs,
    runState,
  }) !== null;
}

/**
 * The single place trade quantity is decided, for every caller of evaluateAutoSignals.
 *
 * A hook-set quantity wins outright — it bypasses useAutoQty/riskPerTrade/minQuantity,
 * because a hook that sized the trade has already accounted for its own risk. Otherwise the
 * engine's own sizing applies. Previously this arithmetic was duplicated in the batch
 * simulator and the store action; they must not drift.
 */
export function resolveTradeQuantity(
  signal: AutoSignal,
  config: AutoBacktestConfig,
  fallbackQty: number
): { qty: number; skipReason?: string } {
  if (signal.quantity !== undefined) return { qty: signal.quantity };
  if (!config.useAutoQty) return { qty: fallbackQty };

  const riskPoints = Math.abs(signal.entryPrice - signal.sl);
  const qty = riskPoints > 0 ? Math.floor(config.riskPerTrade / riskPoints) : 0;
  if (qty < config.minQuantity) {
    return {
      qty,
      skipReason: `Skipped: qty ${qty} < min ${config.minQuantity} (SL ${riskPoints.toFixed(1)} pts too wide)`,
    };
  }
  return { qty };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// The six strength filters whose metric windows come from the completed breakout leg
// in H/L entry modes. EMA slope and EMA20-bias filters are deliberately excluded —
// slopes keep their configured lookbacks, bias windows at the entry bar.
export function legStrengthFiltersActive(rules: RegimeRules): boolean {
  return (rules.efficiencyRatioFilter ?? 'none') !== 'none'
    || (rules.barOverlapFilter ?? 'none') !== 'none'
    || (rules.barRangeFilter ?? 'none') !== 'none'
    || (rules.barBreakFilter ?? 'none') !== 'none'
    || (rules.ema20GapBarFilter ?? 'none') !== 'none'
    || (rules.consecutiveBreakFilter ?? 'none') !== 'none';
}

export function passesEfficiencyRatio(rules: RegimeRules, effRatio: number | undefined): boolean {
  const filter = rules.efficiencyRatioFilter ?? 'none';
  if (filter === 'none' || effRatio === undefined) return true;
  const threshold = rules.efficiencyRatioThreshold ?? 0.3;
  if (filter === 'min') return effRatio >= threshold;
  if (filter === 'max') return effRatio <= threshold;
  return true;
}

// Flips the sign of a signed metric (slope, break-count differential) so 'min'/'max'
// filters can be expressed as "in the trade's favor" regardless of long/short.
function aligned(value: number | undefined, isLong: boolean): number | undefined {
  if (value === undefined) return undefined;
  return isLong ? value : -value;
}

export function passesBarOverlap(rules: RegimeRules, overlapAvg: number | undefined): boolean {
  const filter = rules.barOverlapFilter ?? 'none';
  if (filter === 'none' || overlapAvg === undefined) return true;
  const threshold = rules.barOverlapThreshold ?? 0.4;
  if (filter === 'min') return overlapAvg >= threshold;
  if (filter === 'max') return overlapAvg <= threshold;
  return true;
}

export function passesBarRange(
  rules: RegimeRules,
  bullAvg: number | undefined,
  bearAvg: number | undefined,
  overallAvg: number | undefined,
  isLong: boolean
): boolean {
  const filter = rules.barRangeFilter ?? 'none';
  if (filter === 'none') return true;
  if (filter === 'dominance') {
    if (bullAvg === undefined || bearAvg === undefined) return true;
    const alignedAvg = isLong ? bullAvg : bearAvg;
    const oppositeAvg = isLong ? bearAvg : bullAvg;
    if (oppositeAvg <= 0) return true;
    const threshold = rules.barRangeDominanceThreshold ?? 1.0;
    return alignedAvg / oppositeAvg >= threshold;
  }
  if (overallAvg === undefined) return true;
  const threshold = rules.barRangeThreshold ?? 0;
  if (filter === 'min') return overallAvg >= threshold;
  if (filter === 'max') return overallAvg <= threshold;
  return true;
}

export function passesBarBreak(
  rules: RegimeRules,
  highBreakCount: number | undefined,
  lowBreakCount: number | undefined,
  isLong: boolean
): boolean {
  const filter = rules.barBreakFilter ?? 'none';
  const alignedCount = isLong ? highBreakCount : lowBreakCount;
  if (filter === 'none' || alignedCount === undefined) return true;
  const threshold = rules.barBreakThreshold ?? 5;
  if (filter === 'min') return alignedCount >= threshold;
  if (filter === 'max') return alignedCount <= threshold;
  return true;
}

export function passesConsecutiveBreak(
  rules: RegimeRules,
  maxHighRun: number | undefined,
  maxLowRun: number | undefined,
  isLong: boolean
): boolean {
  const filter = rules.consecutiveBreakFilter ?? 'none';
  const alignedRun = isLong ? maxHighRun : maxLowRun;
  if (filter === 'none' || alignedRun === undefined) return true;
  const threshold = rules.consecutiveBreakThreshold ?? 4;
  if (filter === 'min') return alignedRun >= threshold;
  if (filter === 'max') return alignedRun <= threshold;
  return true;
}

export function passesSeqFilter(filter: 'none' | 'custom' | undefined, patterns: string[] | undefined, seq: string[]): boolean {
  const mode = filter ?? 'none';
  if (mode === 'none') return true;
  if (seq.length < 4) return true; // not enough pivot history yet — pass through
  if (!patterns || patterns.length === 0) return true; // nothing selected — no-op
  return patterns.includes(seq.join('-'));
}

export function passesPivotGap(rules: RegimeRules, gapAvg: number | undefined): boolean {
  const filter = rules.pivotGapFilter ?? 'none';
  if (filter === 'none' || gapAvg === undefined) return true;
  const threshold = rules.pivotGapThreshold ?? 5;
  if (filter === 'min') return gapAvg >= threshold;
  if (filter === 'max') return gapAvg <= threshold;
  return true;
}

export function passesEmaSlope(
  filter: 'none' | 'min' | 'max' | undefined,
  threshold: number | undefined,
  slope: number | undefined,
  isLong: boolean
): boolean {
  const mode = filter ?? 'none';
  const alignedSlope = aligned(slope, isLong);
  if (mode === 'none' || alignedSlope === undefined) return true;
  const t = threshold ?? 0;
  if (mode === 'min') return alignedSlope >= t;
  if (mode === 'max') return alignedSlope <= t;
  return true;
}

export function passesEma20GapBar(rules: RegimeRules, gapBarRatio: number | undefined): boolean {
  const filter = rules.ema20GapBarFilter ?? 'none';
  if (filter === 'none' || gapBarRatio === undefined) return true;
  const threshold = rules.ema20GapBarThreshold ?? 0.5;
  if (filter === 'min') return gapBarRatio >= threshold;
  if (filter === 'max') return gapBarRatio <= threshold;
  return true;
}

export function passesEma20Bias(rules: RegimeRules, closeAboveRatio: number | undefined, isLong: boolean): boolean {
  const filter = rules.ema20BiasFilter ?? 'none';
  if (filter === 'none' || closeAboveRatio === undefined) return true;
  const alignedRatio = isLong ? closeAboveRatio : 1 - closeAboveRatio;
  const threshold = rules.ema20BiasThreshold ?? 0.5;
  if (filter === 'min') return alignedRatio >= threshold;
  if (filter === 'max') return alignedRatio <= threshold;
  return true;
}

export function passesAtrDepth(rules: RegimeRules, entry: number, ema21: number | null, atr: number): boolean {
  const filter = rules.atrDepthFilter ?? 'none';
  const threshold = rules.atrDepthThreshold ?? 1.5;
  if (filter === 'none' || !ema21 || atr <= 0) return true;
  const depth = Math.abs(entry - ema21) / atr;
  if (filter === 'max') return depth <= threshold;
  if (filter === 'min') return depth >= threshold;
  return true;
}

// Shared LT/HT structure gate — buckets the raw analyzeMarketStructure() string
// (Bull-Trend/Bull-Trending-range/Bear-Trend/Bear-Trending-range/Bull-Reversal/
// Bear-Reversal/Range) against one of the 5 filter options. Deliberately stricter
// than getRegimeKey's uptrend/downtrend bucketing: 'bull_trend'/'bear_trend' here
// match only the clean trend state — the choppy Trending-range variant falls into
// 'range' instead.
export function passesStructureFilter(filter: string | undefined, market: string): boolean {
  const f = filter ?? 'any';
  if (f === 'any') return true;
  if (f === 'bull_trend') return market === 'Bull-Trend';
  if (f === 'bear_trend') return market === 'Bear-Trend';
  if (f === 'reversal') return market === 'Bull-Reversal' || market === 'Bear-Reversal';
  if (f === 'range') return market === 'Range' || market === 'Bull-Trending-range' || market === 'Bear-Trending-range';
  return true;
}

export function passesMa(filter: string, candle: Candle, ema21: number | null, ema60: number | null, forLong: boolean): boolean {
  const buf = 0.0001;
  if (filter === 'none') return true;
  if (filter === 'above_ema21') {
    if (!ema21) return false;
    return forLong ? candle.close > ema21 : candle.close < ema21;
  }
  if (filter === 'on_or_above_ema21') {
    if (!ema21) return false;
    if (forLong) return candle.close > ema21 || (candle.low <= ema21 * (1 + buf) && candle.high >= ema21 * (1 - buf));
    return candle.close < ema21 || (candle.high >= ema21 * (1 - buf) && candle.low <= ema21 * (1 + buf));
  }
  if (filter === 'above_ema60') {
    if (!ema60) return false;
    return forLong ? candle.close > ema60 : candle.close < ema60;
  }
  return true;
}

function slLong(rules: RegimeRules, entry: number, pivot: PivotPoint | null, atr: number): number {
  if (rules.slMethod === 'pivot' && pivot) return entry - pivot.slDistance;
  if (rules.slMethod === 'atr' && atr > 0) return entry - atr * rules.slAtrMultiplier;
  return entry - rules.slFixedPoints;
}

function slShort(rules: RegimeRules, entry: number, pivot: PivotPoint | null, atr: number): number {
  if (rules.slMethod === 'pivot' && pivot) return entry + pivot.slDistance;
  if (rules.slMethod === 'atr' && atr > 0) return entry + atr * rules.slAtrMultiplier;
  return entry + rules.slFixedPoints;
}

function getPivotSeq(pivots: PivotPoint[]): string {
  let bull: PivotPoint | null = null;
  let bear: PivotPoint | null = null;
  for (let i = pivots.length - 1; i >= 0; i--) {
    if (pivots[i].type === 'bullish' && !bull) bull = pivots[i];
    if (pivots[i].type === 'bearish' && !bear) bear = pivots[i];
    if (bull && bear) break;
  }
  if (!bull || !bear || !bull.trendLabel || !bear.trendLabel) return '';
  return `${bear.trendLabel}-${bull.trendLabel}`;
}

export function getEmaAt(candles: Candle[], index: number, period: number): number | null {
  return getEmaValueAt(candles, index, period);
}

export function getAtrAt(candles: Candle[], index: number): number {
  return getAtrValueAt(candles, index, 14);
}

function findRecentBullPivot(pivots: PivotPoint[], idx: number, candles: Candle[], lookback: number): PivotPoint | null {
  const ts = candles[idx].timestamp;
  const minTs = idx >= lookback ? candles[idx - lookback].timestamp : 0;
  for (let i = pivots.length - 1; i >= 0; i--) {
    const p = pivots[i];
    if (p.type === 'bullish' && p.time <= ts && p.time >= minTs) return p;
  }
  return null;
}

function findRecentBearPivot(pivots: PivotPoint[], idx: number, candles: Candle[], lookback: number): PivotPoint | null {
  const ts = candles[idx].timestamp;
  const minTs = idx >= lookback ? candles[idx - lookback].timestamp : 0;
  for (let i = pivots.length - 1; i >= 0; i--) {
    const p = pivots[i];
    if (p.type === 'bearish' && p.time <= ts && p.time >= minTs) return p;
  }
  return null;
}

// ─── Exit engine (auto-BT positions only) ─────────────────────────────────────
//
// Both per-bar loops (interactive step-through via autoBacktestActions and the
// batch simulator) call these two pure functions so their exit behavior stays
// identical by construction. Canonical per-bar order:
//   1. evaluateTrailStop        (before the SL/TP touch check)
//   2. SL/TP touch check        (existing machinery, possibly-trailed SL)
//   3. evaluateAutoExitSignal   (REVERSAL → OPP_SIGNAL → LEG_DECAY, fill at close)
//   4. auto square-off
//   5. entry check

export type AutoExitReason = 'REVERSAL' | 'OPP_SIGNAL' | 'LEG_DECAY';

export interface AutoExitPositionInfo {
  quantity: number;               // signed — sign gives direction
  stopLoss?: number;
  entryBarIndex?: number;
  entryRegime?: RegimeKey;        // rules come from config[entryRegime]; fallback: current ltMarket's regime
  exitWithTrendSeen?: boolean;
  exitAgainstBars?: number;
}

// Generic min/max gate for the leg-decay checks — same shape as the entry
// predicates but keyed by explicit filter/threshold instead of RegimeRules fields.
export function passesMinMax(
  filter: 'none' | 'min' | 'max' | undefined,
  threshold: number,
  value: number | undefined
): boolean {
  const mode = filter ?? 'none';
  if (mode === 'none' || value === undefined) return true;
  if (mode === 'min') return value >= threshold;
  return value <= threshold;
}

/** Supplies the leg-pattern feature window for the current bar, built at most once per
 *  bar and shared across every regime that asks. See evaluateAutoSignals. */
export type LegPatternCtx = (needsPerCandle: boolean) => LegPatternWindow;

/** True when this regime has a leg pattern that would actually filter something. */
export function legPatternRuleActive(rules: RegimeRules): boolean {
  return legPatternActive(rules.legPattern);
}

/**
 * The leg-pattern entry gate.
 *
 * Deliberately the LAST gate in the chain: it is by far the most expensive one, and the
 * flat scalar filters ahead of it already reject most bars, so the window is built only
 * for the few bars that survive everything else. (Spec §6.1's cheapest-first ordering
 * applies *within* the pattern's own tree — window aggregates before the matcher — which
 * is handled inside the engine. Both orderings hold, at their own levels.)
 *
 * Unconfigured is a strict no-op that never builds a window, so a regime without a
 * pattern pays literally nothing.
 */
export function passesLegPattern(
  rules: RegimeRules,
  legPatternCtx: LegPatternCtx | null,
  isLong: boolean
): boolean {
  const matcher: Matcher | null = getMatcher(rules.legPattern);
  if (!matcher) return true;
  // No context supplied (e.g. a caller that cannot build windows) — the pattern cannot be
  // honoured, and a filter the user switched on must not be silently skipped.
  if (!legPatternCtx) return false;
  return matcher.test(legPatternCtx(matcher.needsPerCandle), isLong);
}

const resolveExitRules = (
  candles: Candle[],
  currentIndex: number,
  entryRegime: RegimeKey | undefined,
  config: AutoBacktestConfig
): RegimeRules => {
  if (entryRegime) return config[entryRegime];
  // Restored old session with an open auto position but no stamped regime —
  // fall back to the regime the current LT structure maps to.
  const pivots = getPivotPointsUpTo(candles, currentIndex);
  const { ltMarket } = analyzeMarketStructureAt(candles, currentIndex, pivots);
  return config[getRegimeKey(ltMarket)];
};

// Phase 1 — pivot trailing stop. Uses only pivots confirmed through bar
// currentIndex-1, so a pivot confirming on the current bar can never move the SL
// that this same bar's touch check then tests. Trails behind the pivot's 3-bar
// swing extreme (the same cluster its slDistance is measured from), padded by
// the buffer. Ratchet only: returns null unless the candidate TIGHTENS the stop.
export function evaluateTrailStop(
  candles: Candle[],
  currentIndex: number,
  position: Pick<AutoExitPositionInfo, 'quantity' | 'stopLoss' | 'entryRegime'>,
  config: AutoBacktestConfig
): { newStopLoss: number } | null {
  if (currentIndex < 5 || position.quantity === 0) return null;
  const rules = resolveExitRules(candles, currentIndex, position.entryRegime, config);
  if (!rules.exitTrailPivot) return null;

  const isLong = position.quantity > 0;
  const pivots = getPivotPointsUpTo(candles, currentIndex - 1);
  let pivot: PivotPoint | null = null;
  for (let i = pivots.length - 1; i >= 0; i--) {
    if (pivots[i].type === (isLong ? 'bullish' : 'bearish')) { pivot = pivots[i]; break; }
  }
  if (!pivot || pivot.barIndex < 2) return null;

  const buffer = rules.exitTrailPivotBufferPoints ?? 2;
  const b = pivot.barIndex;
  let candidate: number;
  if (isLong) {
    const swingLow = Math.min(candles[b].low, candles[b - 1].low, candles[b - 2].low);
    candidate = swingLow - buffer;
    if (position.stopLoss !== undefined && candidate <= position.stopLoss) return null;
  } else {
    const swingHigh = Math.max(candles[b].high, candles[b - 1].high, candles[b - 2].high);
    candidate = swingHigh + buffer;
    if (position.stopLoss !== undefined && candidate >= position.stopLoss) return null;
  }
  if (candidate <= 0) return null;
  return { newStopLoss: candidate };
}

// Phase 2 — signal exits, evaluated on bar close (fill = candles[currentIndex].close).
// Fixed precedence: REVERSAL → OPP_SIGNAL → LEG_DECAY. Always returns the updated
// per-bar reversal state — callers must persist it onto the position even when
// exit is null, or the confirm-bars counter resets every bar.
export function evaluateAutoExitSignal(
  candles: Candle[],
  currentIndex: number,
  position: AutoExitPositionInfo,
  config: AutoBacktestConfig
): {
  exit: { reason: AutoExitReason; detail: string } | null;
  state: { exitWithTrendSeen: boolean; exitAgainstBars: number };
} {
  const state = {
    exitWithTrendSeen: position.exitWithTrendSeen ?? false,
    exitAgainstBars: position.exitAgainstBars ?? 0,
  };
  if (currentIndex < 50 || position.quantity === 0) return { exit: null, state };

  const rules = resolveExitRules(candles, currentIndex, position.entryRegime, config);
  if (!rules.exitOnReversal && !rules.exitOnOppSignal && !rules.exitLegDecay) return { exit: null, state };
  const isLong = position.quantity > 0;

  // 1. REVERSAL — LT structure against the position for N consecutive checks
  if (rules.exitOnReversal) {
    const pivots = getPivotPointsUpTo(candles, currentIndex);
    const { ltMarket } = analyzeMarketStructureAt(candles, currentIndex, pivots);
    const isAgainst = isLong ? ltMarket.startsWith('Bear') : ltMarket.startsWith('Bull');
    const isWith = isLong ? ltMarket.startsWith('Bull') : ltMarket.startsWith('Bear');
    if (isWith) state.exitWithTrendSeen = true;
    state.exitAgainstBars = isAgainst ? state.exitAgainstBars + 1 : 0;
    const armed = state.exitWithTrendSeen || !(rules.exitReversalRequireWithTrend ?? true);
    if (armed && state.exitAgainstBars >= (rules.exitReversalConfirmBars ?? 1)) {
      return { exit: { reason: 'REVERSAL', detail: `LT:${ltMarket} against for ${state.exitAgainstBars} bar(s)` }, state };
    }
  }

  // 2. OPP_SIGNAL — opposite Brooks pullback signal on the current bar
  if (rules.exitOnOppSignal) {
    const marker = getAlBrooksMarkersUpTo(candles, currentIndex).find(m => m.time === candles[currentIndex].timestamp) ?? null;
    if (marker) {
      const opp1 = isLong ? 'L1' : 'H1';
      const opp2 = isLong ? 'L2' : 'H2';
      const fired =
        (marker.signal === opp1 && (rules.exitOppAllow1 ?? false)) ||
        (marker.signal === opp2 && (rules.exitOppAllow2 ?? true));
      if (fired) {
        return { exit: { reason: 'OPP_SIGNAL', detail: `${marker.signal} against ${isLong ? 'long' : 'short'}` }, state };
      }
    }
  }

  // 3. LEG_DECAY — re-grade the newest completed with-trend leg formed after entry
  if (rules.exitLegDecay && position.entryBarIndex !== undefined
    && currentIndex - position.entryBarIndex >= (rules.exitLegDecayMinBarsInTrade ?? 3)) {
    const legs = getAlBrooksLegsAt(candles, currentIndex);
    const leg = isLong ? legs.bull : legs.bear;
    // Only grade legs whose extreme formed after entry — never re-judge the
    // entry leg the confirmation filters already approved.
    if (leg && leg.endIndex > position.entryBarIndex) {
      const metrics = computeEntryMetrics(candles, currentIndex, config, leg);
      if (!metrics.legTooShort) {
        const fails: string[] = [];
        if (!passesMinMax(rules.exitDecayEfficiencyFilter, rules.exitDecayEfficiencyThreshold ?? 0.25,
          metrics.efficiencyRatio)) fails.push('ER');
        if (!passesMinMax(rules.exitDecayConsecBreakFilter, rules.exitDecayConsecBreakThreshold ?? 3,
          isLong ? metrics.maxConsecutiveHighBreaks : metrics.maxConsecutiveLowBreaks)) fails.push('consecBreak');
        if (!passesMinMax(rules.exitDecayBarBreakFilter, rules.exitDecayBarBreakThreshold ?? 4,
          isLong ? metrics.highBreakCount : metrics.lowBreakCount)) fails.push('barBreak');
        if (!passesMinMax(rules.exitDecayEma21SlopeFilter, rules.exitDecayEma21SlopeThreshold ?? 0,
          aligned(metrics.ema21Slope, isLong))) fails.push('ema21Slope');
        if (!passesMinMax(rules.exitDecayGapBarFilter, rules.exitDecayGapBarThreshold ?? 0.3,
          metrics.ema20GapBarRatio)) fails.push('gapBar');
        if (fails.length >= (rules.exitLegDecayMinFails ?? 1)) {
          return { exit: { reason: 'LEG_DECAY', detail: `leg[${leg.startIndex}-${leg.endIndex}] failed: ${fails.join(', ')}` }, state };
        }
      }
    }
  }

  return { exit: null, state };
}

// Count of exit mechanisms switched on for a regime — UI badge helper.
export function countActiveExitMechanisms(rules: RegimeRules): number {
  return [rules.exitOnReversal, rules.exitOnOppSignal, rules.exitTrailPivot, rules.exitLegDecay]
    .filter(Boolean).length;
}

// ─── Current market state utility (used by UI for live display) ───────────────

export function getCurrentMarketState(candles: Candle[], currentIndex: number): { ltMarket: string; htMarket: string; regime: RegimeKey } {
  if (currentIndex < 25 || candles.length < 26) {
    return { ltMarket: 'Range', htMarket: 'Range', regime: 'range' };
  }
  const pivots = getPivotPointsUpTo(candles, currentIndex);
  const { ltMarket, htMarket } = analyzeMarketStructureAt(candles, currentIndex, pivots);
  return { ltMarket, htMarket, regime: getRegimeKey(ltMarket) };
}
