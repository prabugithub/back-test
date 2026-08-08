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
  const { brrAvg } = averageBarQuality(barQualitySamples);
  const { brrAvgIQR } = averageBarQualityIQR(barQualitySamples);
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

export function evaluateAutoSignals(
  candles: Candle[],
  currentIndex: number,
  config: AutoBacktestConfig
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

  for (const regime of regimeOrder) {
    const regimeRules = config[regime];
    if (!regimeRules.enabled) continue;
    if (!passesStructureFilter(regimeRules.htStructureFilter, htMarket)) continue;
    if (!passesStructureFilter(regimeRules.ltStructureFilter, ltMarket)) continue;

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

    if (regimeRules.direction !== 'SHORT_ONLY') {
      const signal = evalLong(regimeRules, currentCandle, currentPivot, currentAbMarker, pivots, ema21, ema60, atr, currentIndex, candles, pivotSeq, ltMarket, htMarket, regime, entryMetrics);
      if (signal) return signal;
    }

    if (regimeRules.direction !== 'LONG_ONLY') {
      const signal = evalShort(regimeRules, currentCandle, currentPivot, currentAbMarker, pivots, ema21, ema60, atr, currentIndex, candles, pivotSeq, ltMarket, htMarket, regime, entryMetrics);
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
  entryMetrics: EntryMetricsSnapshot
): AutoSignal | null {
  const allowed = new Set<string>();
  if (rules.allowH1) allowed.add('H1');
  if (rules.allowH2) allowed.add('H2');

  const isBullPivot = currentPivot?.type === 'bullish';
  const isHSig = currentAb !== null && allowed.has(currentAb.signal);

  let pivotForSl: PivotPoint | null = isBullPivot ? currentPivot : null;
  let triggerLabel = '';

  if (rules.entryMode === 'PIVOT') {
    if (!isBullPivot) return null;
    triggerLabel = 'Pivot';
  } else if (rules.entryMode === 'H_SIGNAL') {
    if (!isHSig) return null;
    triggerLabel = currentAb!.signal;
    pivotForSl = findRecentBullPivot(pivots, currentIndex, candles, rules.confluenceLookback * 2);
  } else {
    if (!isHSig) return null;
    const recent = findRecentBullPivot(pivots, currentIndex, candles, rules.confluenceLookback);
    if (!recent) return null;
    pivotForSl = recent;
    triggerLabel = `CONF ${currentAb!.signal}`;
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

  const sl = slLong(rules, entry, pivotForSl, atr);
  if (sl <= 0 || sl >= entry) return null;
  const risk = entry - sl;
  if (risk <= 0) return null;
  const tp = entry + risk * rules.targetRR;

  const reason = `Long [${REGIME_LABELS[regime]}] ${triggerLabel} | ${pivotSeq || '—'} | LT:${ltMarket} | HT:${htMarket}`;
  return { type: 'BUY', entryPrice: entry, sl, tp, reason, regime, ltMarket, htMarket, llhhPivot: pivotSeq, entryMetrics };
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
  entryMetrics: EntryMetricsSnapshot
): AutoSignal | null {
  const allowed = new Set<string>();
  if (rules.allowL1) allowed.add('L1');
  if (rules.allowL2) allowed.add('L2');

  const isBearPivot = currentPivot?.type === 'bearish';
  const isLSig = currentAb !== null && allowed.has(currentAb.signal);

  let pivotForSl: PivotPoint | null = isBearPivot ? currentPivot : null;
  let triggerLabel = '';

  if (rules.entryMode === 'PIVOT') {
    if (!isBearPivot) return null;
    triggerLabel = 'Pivot';
  } else if (rules.entryMode === 'H_SIGNAL') {
    if (!isLSig) return null;
    triggerLabel = currentAb!.signal;
    pivotForSl = findRecentBearPivot(pivots, currentIndex, candles, rules.confluenceLookback * 2);
  } else {
    if (!isLSig) return null;
    const recent = findRecentBearPivot(pivots, currentIndex, candles, rules.confluenceLookback);
    if (!recent) return null;
    pivotForSl = recent;
    triggerLabel = `CONF ${currentAb!.signal}`;
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

  const sl = slShort(rules, entry, pivotForSl, atr);
  if (sl <= 0 || sl <= entry) return null;
  const risk = sl - entry;
  if (risk <= 0) return null;
  const tp = entry - risk * rules.targetRR;
  if (tp <= 0) return null;

  const reason = `Short [${REGIME_LABELS[regime]}] ${triggerLabel} | ${pivotSeq || '—'} | LT:${ltMarket} | HT:${htMarket}`;
  return { type: 'SELL', entryPrice: entry, sl, tp, reason, regime, ltMarket, htMarket, llhhPivot: pivotSeq, entryMetrics };
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
