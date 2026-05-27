// @backtest-only — pure signal evaluation, no side effects, no live imports.

import type { Candle } from '../types';
import {
  calculatePivotPoints,
  calculateAlBrooks,
  calculateEMA,
  calculateATR,
  type PivotPoint,
} from './indicators';
import { analyzeMarketStructure } from './pivotAnalysis';

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

  // MA filter
  maFilter: 'none' | 'above_ema21' | 'on_or_above_ema21' | 'above_ema60';

  // Higher timeframe structure required for this regime
  htStructureFilter: 'any' | 'bull_trend' | 'bear_trend';

  // Risk
  slMethod: 'pivot' | 'atr' | 'fixed';
  slAtrMultiplier: number;
  slFixedPoints: number;
  targetRR: number;
}

// ─── Global config ────────────────────────────────────────────────────────────

export interface AutoBacktestConfig {
  enabled: boolean;

  // Skip new entry if a position is already open
  skipIfPositionOpen: boolean;

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
};

export const defaultAutoBacktestConfig: AutoBacktestConfig = {
  enabled: false,
  skipIfPositionOpen: true,
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
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function evaluateAutoSignals(
  candles: Candle[],
  currentIndex: number,
  config: AutoBacktestConfig
): AutoSignal | null {
  if (currentIndex < 50 || candles.length < 51) return null;

  const visibleCandles = candles.slice(0, currentIndex + 1);
  const currentCandle = candles[currentIndex];
  const currentTs = currentCandle.timestamp;

  // Pre-compute indicators
  const pivots = calculatePivotPoints(visibleCandles);
  const alBrooks = calculateAlBrooks(visibleCandles);
  const ema21 = getEmaAt(candles, currentIndex, 21);
  const ema60 = getEmaAt(candles, currentIndex, 60);
  const atr = getAtrAt(candles, currentIndex);

  // Detect regime from LT market structure
  const { ltMarket, htMarket } = analyzeMarketStructure(visibleCandles, pivots);
  const regime = getRegimeKey(ltMarket);
  const regimeRules = config[regime];

  // Per-regime HT filter
  if (!passesHtFilter(regimeRules.htStructureFilter, htMarket)) return null;

  // Regime must be enabled
  if (!regimeRules.enabled) return null;

  // Shared indicators at this bar
  const currentPivot = pivots.find(p => p.time === currentTs) ?? null;
  const currentAbMarker = alBrooks.find(m => m.time === currentTs) ?? null;
  const pivotSeq = getPivotSeq(pivots);

  if (regimeRules.direction !== 'SHORT_ONLY') {
    const signal = evalLong(regimeRules, currentCandle, currentPivot, currentAbMarker, pivots, ema21, ema60, atr, currentIndex, candles, pivotSeq, ltMarket, htMarket, regime);
    if (signal) return signal;
  }

  if (regimeRules.direction !== 'LONG_ONLY') {
    const signal = evalShort(regimeRules, currentCandle, currentPivot, currentAbMarker, pivots, ema21, ema60, atr, currentIndex, candles, pivotSeq, ltMarket, htMarket, regime);
    if (signal) return signal;
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
  regime: RegimeKey
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
  const sl = slLong(rules, entry, pivotForSl, atr);
  if (sl <= 0 || sl >= entry) return null;
  const risk = entry - sl;
  if (risk <= 0) return null;
  const tp = entry + risk * rules.targetRR;

  const reason = `Long [${REGIME_LABELS[regime]}] ${triggerLabel} | ${pivotSeq || '—'} | LT:${ltMarket} | HT:${htMarket}`;
  return { type: 'BUY', entryPrice: entry, sl, tp, reason, regime, ltMarket, htMarket, llhhPivot: pivotSeq };
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
  regime: RegimeKey
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
  const sl = slShort(rules, entry, pivotForSl, atr);
  if (sl <= 0 || sl <= entry) return null;
  const risk = sl - entry;
  if (risk <= 0) return null;
  const tp = entry - risk * rules.targetRR;
  if (tp <= 0) return null;

  const reason = `Short [${REGIME_LABELS[regime]}] ${triggerLabel} | ${pivotSeq || '—'} | LT:${ltMarket} | HT:${htMarket}`;
  return { type: 'SELL', entryPrice: entry, sl, tp, reason, regime, ltMarket, htMarket, llhhPivot: pivotSeq };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function passesHtFilter(filter: string, htMarket: string): boolean {
  if (filter === 'any') return true;
  if (filter === 'bull_trend') return htMarket === 'Bull-Trend';
  if (filter === 'bear_trend') return htMarket === 'Bear-Trend';
  return true;
}

function passesMa(filter: string, candle: Candle, ema21: number | null, ema60: number | null, forLong: boolean): boolean {
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

function getEmaAt(candles: Candle[], index: number, period: number): number | null {
  const ema = calculateEMA(candles.slice(0, index + 1), period);
  return ema.length ? ema[ema.length - 1].value : null;
}

function getAtrAt(candles: Candle[], index: number): number {
  const atr = calculateATR(candles.slice(0, index + 1), 14);
  return atr.length ? atr[atr.length - 1].value : 0;
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

// ─── Current market state utility (used by UI for live display) ───────────────

export function getCurrentMarketState(candles: Candle[], currentIndex: number): { ltMarket: string; htMarket: string; regime: RegimeKey } {
  if (currentIndex < 25 || candles.length < 26) {
    return { ltMarket: 'Range', htMarket: 'Range', regime: 'range' };
  }
  const visible = candles.slice(0, currentIndex + 1);
  const pivots = calculatePivotPoints(visible);
  const { ltMarket, htMarket } = analyzeMarketStructure(visible, pivots);
  return { ltMarket, htMarket, regime: getRegimeKey(ltMarket) };
}
