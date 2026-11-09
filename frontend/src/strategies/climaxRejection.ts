/**
 * Climax Rejection Guard — refuses entries the recent bars argue against.
 *
 * A Gate-mode filter: the regime's own chain decides the trade and this hook can only refuse
 * it. It never changes side, stop, target or quantity. Every rule is mirrored per side; the
 * LONG side is described (shorts swap bull ↔ bear, high ↔ low, top ↔ bottom). The first rule
 * that hits blocks the entry. "Baseline" = the mean range of the `climaxExitLookback` bars
 * before a bar (Session Settings → Climax Lookback); `tol` = `doubleTopTolAtr` × ATR.
 *
 *   0. failed climax  — a BULL bar ≥ `climaxReversalMultiple` (4.5) × baseline within the last
 *                       `climaxReversalWindow` (20) bars, whose high has not been exceeded since,
 *                       followed by a bear bar: the buyers were rejected → no long
 *   1. climax against — a BEAR bar ≥ `climaxAgainstMultiple` (3) × baseline within the last
 *                       `climaxAgainstBlockBars` (50) bars → no long
 *   2. double top +   — a BEAR bar ≥ `dtReversalMultiple` (2) × baseline within the last
 *      big reversal     `dtReversalBlockBars` (50) bars, coming off a double top whose second
 *                       top is the highest high of the `dtReversalWithinBars` (9) bars up to it
 *                       → no long, until a close above the top level + tol lifts it
 *   3. at a double top — the highest high of the last `doubleTopMinGap` (25) bars forms a double
 *                       top with a swing top ≥ that many bars earlier, and the trigger bar's high
 *                       is still within tol of it → no long
 *
 * Double tops come from `findDoubleTopAt` (exits/climax.ts), the same detector the Climax
 * exits use. Look-ahead safe: reads only candles ≤ the trigger bar.
 */
import type { Candle } from '../types';
import type { EntryHook } from '../utils/entryHook';
import {
  climaxReversalSettings, doubleTopSettings, findDoubleTopAt, isClimaxBar,
} from './exits/climax';
import { probe } from './debug';

/** Fallbacks for the optional `AutoBacktestConfig` fields of rules 1 and 2. */
export const DEFAULT_CLIMAX_REJECTION = {
  climaxAgainstMultiple: 3,
  climaxAgainstBlockBars: 50,
  dtReversalMultiple: 2,
  dtReversalWithinBars: 9,
  dtReversalBlockBars: 50,
} as const;

type RejectionConfig = { [K in keyof typeof DEFAULT_CLIMAX_REJECTION]?: number };

export function climaxRejectionSettings(c: RejectionConfig): { [K in keyof typeof DEFAULT_CLIMAX_REJECTION]: number } {
  const d = DEFAULT_CLIMAX_REJECTION;
  const mult = (v: number | undefined, def: number) => (Number.isFinite(v) && (v as number) > 1 ? (v as number) : def);
  const bars = (v: number | undefined, def: number) => (Number.isFinite(v) ? Math.max(1, Math.floor(v as number)) : def);
  return {
    climaxAgainstMultiple: mult(c.climaxAgainstMultiple, d.climaxAgainstMultiple),
    climaxAgainstBlockBars: bars(c.climaxAgainstBlockBars, d.climaxAgainstBlockBars),
    dtReversalMultiple: mult(c.dtReversalMultiple, d.dtReversalMultiple),
    dtReversalWithinBars: bars(c.dtReversalWithinBars, d.dtReversalWithinBars),
    dtReversalBlockBars: bars(c.dtReversalBlockBars, d.dtReversalBlockBars),
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

// ─── Rule 2: double top / bottom followed by a big reversal bar ───────────────

export interface DoubleTopReversal { reversalBar: number; ratio: number; top1: number; top2: number; level: number }

export function findDoubleTopReversal(
  candles: readonly Candle[], i: number, long: boolean, lookback: number,
  multiple: number, withinBars: number, blockBars: number, minGap: number, tol: number,
): DoubleTopReversal | null {
  // Longs are blocked by a double TOP (x = high), shorts by a double BOTTOM (x = −low).
  const x = (k: number) => (long ? candles[k].high : -candles[k].low);
  const closeX = (k: number) => (long ? candles[k].close : -candles[k].close);

  for (let r = i; r >= Math.max(lookback, i - blockBars); r--) {
    if (!against(candles[r], long)) continue;
    const ratio = isClimaxBar(candles, r, lookback, multiple);
    if (ratio === null) continue;

    let top2 = r;
    for (let k = r - 1; k >= Math.max(0, r - withinBars); k--) if (x(k) > x(top2)) top2 = k;
    const dt = findDoubleTopAt(candles, top2, long, minGap, tol);
    if (!dt) continue;

    // A close back through the level after the reversal bar lifts the block.
    const levelX = Math.max(dt.x1, dt.x2);
    let broken = false;
    for (let k = r + 1; k <= i && !broken; k++) if (closeX(k) > levelX + tol) broken = true;
    if (broken) continue;
    return { reversalBar: r, ratio, top1: dt.top1, top2: dt.top2, level: dt.price(levelX) };
  }
  return null;
}

// ─── Rule 3: entering into a double top / bottom ──────────────────────────────

export interface AtDoubleTop { top1: number; top2: number; level: number }

export function findAtDoubleTop(
  candles: readonly Candle[], i: number, long: boolean, minGap: number, tol: number,
): AtDoubleTop | null {
  const x = (k: number) => (long ? candles[k].high : -candles[k].low);
  let top2 = i;
  for (let k = i - 1; k > Math.max(-1, i - minGap); k--) if (x(k) > x(top2)) top2 = k;
  if (x(i) < x(top2) - tol) return null; // price has left the level
  const dt = findDoubleTopAt(candles, top2, long, minGap, tol);
  return dt ? { top1: dt.top1, top2: dt.top2, level: dt.price(Math.max(dt.x1, dt.x2)) } : null;
}

// ─── The hook ─────────────────────────────────────────────────────────────────

type Rule = 'failedClimax' | 'climaxAgainst' | 'dtReversal' | 'atDoubleTop';

export const climaxRejectionGuard: EntryHook = ctx => {
  const long = ctx.trigger.side === 'long';
  const candles = ctx.fullCandles, i = ctx.absoluteIndex;
  const { lookback, multiple, window } = climaxReversalSettings(ctx.config);
  const rs = climaxRejectionSettings(ctx.config);
  const dts = doubleTopSettings(ctx.config);
  const tol = ctx.atr > 0 ? dts.tolAtr * ctx.atr : 0;
  const px = (v: number) => v.toFixed(2);
  const sideName = long ? 'long' : 'short';
  const pattern = long ? 'double top' : 'double bottom';

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
  if (!rule && tol > 0) {
    const r2 = findDoubleTopReversal(candles, i, long, lookback, rs.dtReversalMultiple,
      rs.dtReversalWithinBars, rs.dtReversalBlockBars, dts.minGap, tol);
    if (r2) {
      rule = 'dtReversal';
      detail = `${pattern} ${px(r2.level)} (@${r2.top1}/@${r2.top2}), ${r2.ratio.toFixed(1)}x reversal @${r2.reversalBar}`;
    }
  }
  if (!rule && tol > 0) {
    const r3 = findAtDoubleTop(candles, i, long, dts.minGap, tol);
    if (r3) { rule = 'atDoubleTop'; detail = `at ${pattern} ${px(r3.level)} (@${r3.top1}/@${r3.top2})`; }
  }

  probe(ctx, { crBlocked: rule !== null, crRule: rule, crDetail: detail || null });
  if (rule) return false;
  ctx.log(`climax rejection ok (${sideName})`);
  return true;
};
