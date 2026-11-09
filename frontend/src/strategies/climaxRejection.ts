/**
 * Climax Rejection Guard — refuses entries the recent bars argue against.
 *
 * A Gate-mode filter: the regime's own chain decides the trade and this hook can only refuse
 * it. It never changes side, stop, target or quantity. Every rule is mirrored per side; the
 * LONG side is described (shorts swap bull ↔ bear, high ↔ low). The first rule
 * that hits blocks the entry. "Baseline" = the mean range of the `climaxExitLookback` bars
 * before a bar (Session Settings → Climax Lookback).
 *
 *   0. failed climax  — a BULL bar ≥ `climaxReversalMultiple` (4.5) × baseline within the last
 *                       `climaxReversalWindow` (20) bars, whose high has not been exceeded since,
 *                       followed by a bear bar: the buyers were rejected → no long
 *   1. climax against — a BEAR bar ≥ `climaxAgainstMultiple` (3) × baseline within the last
 *                       `climaxAgainstBlockBars` (50) bars → no long
 *
 * No double top / bottom rules here — those live in the Climax exits only.
 * Look-ahead safe: reads only candles ≤ the trigger bar.
 */
import type { Candle } from '../types';
import type { EntryHook } from '../utils/entryHook';
import { climaxReversalSettings, isClimaxBar } from './exits/climax';
import { probe } from './debug';

/** Fallbacks for the optional `AutoBacktestConfig` fields of rule 1. */
export const DEFAULT_CLIMAX_REJECTION = {
  climaxAgainstMultiple: 3,
  climaxAgainstBlockBars: 50,
} as const;

type RejectionConfig = { [K in keyof typeof DEFAULT_CLIMAX_REJECTION]?: number };

export function climaxRejectionSettings(c: RejectionConfig): { [K in keyof typeof DEFAULT_CLIMAX_REJECTION]: number } {
  const d = DEFAULT_CLIMAX_REJECTION;
  const mult = (v: number | undefined, def: number) => (Number.isFinite(v) && (v as number) > 1 ? (v as number) : def);
  const bars = (v: number | undefined, def: number) => (Number.isFinite(v) ? Math.max(1, Math.floor(v as number)) : def);
  return {
    climaxAgainstMultiple: mult(c.climaxAgainstMultiple, d.climaxAgainstMultiple),
    climaxAgainstBlockBars: bars(c.climaxAgainstBlockBars, d.climaxAgainstBlockBars),
  };
}

const isBull = (k: Candle) => k.close > k.open;
const isBear = (k: Candle) => k.close < k.open;
/** A bar pointing against an entry on this side: bear for a long, bull for a short. */
const against = (k: Candle, long: boolean) => (long ? isBear(k) : isBull(k));

// ─── Rule 0: failed climax ─────────────────────────────────────────────────────

export interface ClimaxRejection {
  climaxBar: number;
  ratio: number;
  level: number;      // the climax extreme that held (low for a bear climax, high for a bull one)
  reversalBar: number;
}

/** The newest failed climax against `long` (a bull climax blocks longs, a bear one shorts)
 *  within the window ending at bar `i`, or null. */
export function findClimaxRejection(
  candles: readonly Candle[], i: number, long: boolean, lookback: number, multiple: number, window: number,
): ClimaxRejection | null {
  for (let c = i - 1; c >= Math.max(lookback, i - window); c--) {
    const bar = candles[c];
    if (long ? !isBull(bar) : !isBear(bar)) continue; // climax must point the trade's way
    const ratio = isClimaxBar(candles, c, lookback, multiple);
    if (ratio === null) continue;

    const level = long ? bar.high : bar.low;
    let held = true, reversalBar = -1;
    for (let x = c + 1; x <= i; x++) {
      const k = candles[x];
      if (long ? k.high > level : k.low < level) { held = false; break; }
      if (reversalBar < 0 && against(k, long)) reversalBar = x;
    }
    if (held && reversalBar >= 0) return { climaxBar: c, ratio, level, reversalBar };
  }
  return null;
}

// ─── Rule 1: big bar against the side ─────────────────────────────────────────

export interface ClimaxAgainst { bar: number; ratio: number }

/** The newest bar in [i − blockBars, i] pointing against `long` with range ≥ multiple × baseline. */
export function findClimaxAgainst(
  candles: readonly Candle[], i: number, long: boolean, lookback: number, multiple: number, blockBars: number,
): ClimaxAgainst | null {
  for (let c = i; c >= Math.max(lookback, i - blockBars); c--) {
    if (!against(candles[c], long)) continue;
    const ratio = isClimaxBar(candles, c, lookback, multiple);
    if (ratio !== null) return { bar: c, ratio };
  }
  return null;
}

// ─── The hook ─────────────────────────────────────────────────────────────────

type Rule = 'failedClimax' | 'climaxAgainst';

export const climaxRejectionGuard: EntryHook = ctx => {
  const long = ctx.trigger.side === 'long';
  const candles = ctx.fullCandles, i = ctx.absoluteIndex;
  const { lookback, multiple, window } = climaxReversalSettings(ctx.config);
  const rs = climaxRejectionSettings(ctx.config);
  const px = (v: number) => v.toFixed(2);
  const sideName = long ? 'long' : 'short';

  let rule: Rule | null = null, detail = '';
  const r0 = findClimaxRejection(candles, i, long, lookback, multiple, window);
  if (r0) {
    rule = 'failedClimax';
    detail = `${long ? 'bull' : 'bear'} ${r0.ratio.toFixed(1)}x @${r0.climaxBar}, ${long ? 'high' : 'low'} ${px(r0.level)} held, reversal @${r0.reversalBar}`;
  }
  if (!rule) {
    const r1 = findClimaxAgainst(candles, i, long, lookback, rs.climaxAgainstMultiple, rs.climaxAgainstBlockBars);
    if (r1) { rule = 'climaxAgainst'; detail = `${long ? 'bear' : 'bull'} ${r1.ratio.toFixed(1)}x @${r1.bar} (${i - r1.bar} bars ago)`; }
  }

  probe(ctx, { crBlocked: rule !== null, crRule: rule, crDetail: detail || null });
  if (rule) return false;
  ctx.log(`climax rejection ok (${sideName})`);
  return true;
};
