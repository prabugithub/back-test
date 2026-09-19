/**
 * Stop-loss primitives, and the pivot each one anchors to.
 *
 * ── Why these live in a leaf module and not in autoBacktestEngine ───────────
 *
 * They were private to `autoBacktestEngine.ts`, which is fine until something OUTSIDE the
 * engine needs to know what stop a bar would get. A custom entry hook that wants to reason
 * about reward:risk before deciding is exactly that case: `EntryHookContext` deliberately
 * carries no `sl` field (the engine computes it around the hook, not for it), so a hook has
 * to derive the prospective stop itself — and the one thing it must not do is derive it
 * DIFFERENTLY from the engine that will actually book the trade.
 *
 * `src/strategies/*` cannot import the engine: `autoBacktestEngine.ts` value-imports
 * `getEntryHook` from `../strategies`, so a strategy importing the engine back would close
 * a runtime import cycle — the kind that surfaces as "undefined is not a function" during
 * module init in the worker build, not as a compile error. A leaf module both sides import
 * has no such edge. (`RegimeRules` below is a TYPE-only import, which is erased at build
 * time and therefore not a cycle.)
 *
 * Everything here is pure: rules + price + pivot + ATR in, a number out.
 */
import type { Candle } from '../types';
import type { PivotPoint } from './indicators';
import type { RegimeRules } from './autoBacktestEngine';

/** The most recent bullish (swing-low) pivot at or before `idx`, within `lookback` bars. */
export function findRecentBullPivot(pivots: PivotPoint[], idx: number, candles: Candle[], lookback: number): PivotPoint | null {
  const ts = candles[idx].timestamp;
  const minTs = idx >= lookback ? candles[idx - lookback].timestamp : 0;
  for (let i = pivots.length - 1; i >= 0; i--) {
    const p = pivots[i];
    if (p.type === 'bullish' && p.time <= ts && p.time >= minTs) return p;
  }
  return null;
}

/** The most recent bearish (swing-high) pivot at or before `idx`, within `lookback` bars. */
export function findRecentBearPivot(pivots: PivotPoint[], idx: number, candles: Candle[], lookback: number): PivotPoint | null {
  const ts = candles[idx].timestamp;
  const minTs = idx >= lookback ? candles[idx - lookback].timestamp : 0;
  for (let i = pivots.length - 1; i >= 0; i--) {
    const p = pivots[i];
    if (p.type === 'bearish' && p.time <= ts && p.time >= minTs) return p;
  }
  return null;
}

export function slLong(rules: RegimeRules, entry: number, pivot: PivotPoint | null, atr: number): number {
  if (rules.slMethod === 'pivot' && pivot) return entry - pivot.slDistance;
  if (rules.slMethod === 'atr' && atr > 0) return entry - atr * rules.slAtrMultiplier;
  return entry - rules.slFixedPoints;
}

export function slShort(rules: RegimeRules, entry: number, pivot: PivotPoint | null, atr: number): number {
  if (rules.slMethod === 'pivot' && pivot) return entry + pivot.slDistance;
  if (rules.slMethod === 'atr' && atr > 0) return entry + atr * rules.slAtrMultiplier;
  return entry + rules.slFixedPoints;
}

/**
 * The pivot a `slMethod: 'pivot'` stop anchors to for `side` at `idx`.
 *
 * The `confluenceLookback * 2` window is the engine's own choice, kept here so the engine's
 * hook paths and a hook's own reasoning cannot drift apart on it.
 */
export function resolvePivotForSl(
  side: 'long' | 'short',
  pivots: PivotPoint[],
  idx: number,
  candles: Candle[],
  rules: Pick<RegimeRules, 'confluenceLookback'>
): PivotPoint | null {
  const lookback = rules.confluenceLookback * 2;
  return side === 'long'
    ? findRecentBullPivot(pivots, idx, candles, lookback)
    : findRecentBearPivot(pivots, idx, candles, lookback);
}

/**
 * The stop the engine WOULD place for `side` at `entryPrice` on bar `idx`, given these rules.
 *
 * This is the composition `hookDefaultsFor` performs in 'replace' mode, exposed so a hook can
 * size its own reward:risk reasoning against the real number. Two caveats, both deliberate:
 *
 *   - It is EXACT for `slMethod: 'atr'` and `'fixed'`, which ignore the pivot entirely.
 *   - For `slMethod: 'pivot'` it is exact on the hook paths (`evalHookReplace` /
 *     `previewEntryHook` resolve the pivot the same way). The built-in chain in
 *     `evalLong`/`evalShort` may anchor to the TRIGGER bar's own pivot when that bar is
 *     itself a pivot, so a 'gate'-mode hook can see a slightly different stop from the one
 *     finally booked. Prefer returning your own `sl` if that matters to your logic.
 *
 * Returns null when no valid stop exists (non-positive, or on the wrong side of entry) —
 * the same condition under which `hookDefaultsFor` returns null and the trade is skipped.
 */
export function prospectiveStop(
  side: 'long' | 'short',
  entryPrice: number,
  rules: Pick<RegimeRules, 'slMethod' | 'slAtrMultiplier' | 'slFixedPoints' | 'confluenceLookback'>,
  pivots: PivotPoint[],
  candles: Candle[],
  idx: number,
  atr: number
): number | null {
  const pivot = resolvePivotForSl(side, pivots, idx, candles, rules);
  const full = rules as RegimeRules;
  const sl = side === 'long'
    ? slLong(full, entryPrice, pivot, atr)
    : slShort(full, entryPrice, pivot, atr);
  if (!(sl > 0)) return null;
  const risk = side === 'long' ? entryPrice - sl : sl - entryPrice;
  if (!(risk > 0)) return null;
  return sl;
}
