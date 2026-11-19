/**
 * Chop Guard — skip entries when the market is chopping. Gate mode, both sides.
 *
 * A veto only: the regime's own chain decides the trade and this hook can refuse it. It never
 * changes side, stop, target or quantity. Two reads the engine already computes, nothing new:
 *
 *   1. chop          — Kaufman efficiency ratio (ctx.metrics.efficiencyRatio, the same value the
 *                      ER filter uses, over Session Settings' ER lookback) < `chopMinEfficiency`.
 *                      Price is travelling a long way to get nowhere.
 *   2. no displacement — the close is not at least `chopMinEmaAtr` ATRs beyond EMA21 on the
 *                      trade's side (above for a long, below for a short). Price hugging, or on
 *                      the wrong side of, its mean has no directional pressure behind the entry.
 *
 * Either one blocks. Missing data (no ER, EMA21 or ATR yet) never blocks.
 *
 * Why these two and not the pivot structure: on the bundled 15m indices (7 × 3 years, 4,603
 * trades) the pivot classifier's broad/sub state, pivot efficiency and HH/HL labels barely moved
 * R per trade, while these two split it cleanly (worst quintile ~+0.04R vs best ~+0.26R).
 * Together they took avg R 0.140 → 0.181 and PF 1.24 → 1.31, stable across both halves.
 */
import type { EntryHook } from '../utils/entryHook';
import { probe } from './debug';

export const DEFAULT_CHOP_GUARD = {
  /** Efficiency ratio below which the market is chop. 0 = never blocks on ER. */
  chopMinEfficiency: 0.2,
  /** Close beyond EMA21 on the trade's side, in ATR, required to enter. */
  chopMinEmaAtr: 0.4,
} as const;

export type ChopGuardSettings = { -readonly [K in keyof typeof DEFAULT_CHOP_GUARD]: number };

export function chopGuardSettings(c: Partial<ChopGuardSettings>): ChopGuardSettings {
  const d = DEFAULT_CHOP_GUARD;
  const er = c.chopMinEfficiency, ema = c.chopMinEmaAtr;
  return {
    chopMinEfficiency: Number.isFinite(er) ? Math.min(1, Math.max(0, er as number)) : d.chopMinEfficiency,
    chopMinEmaAtr: Number.isFinite(ema) ? (ema as number) : d.chopMinEmaAtr,
  };
}

export interface ChopRead {
  blocked: boolean;
  reason: string;
  /** Close beyond EMA21 on the trade's side, in ATR; null when not measurable. */
  emaAtr: number | null;
}

/** Pure verdict — exported for tests and for reuse outside the hook. */
export function chopRead(
  er: number | undefined | null, close: number, ema21: number | null, atr: number, long: boolean, s: ChopGuardSettings,
): ChopRead {
  const emaAtr = ema21 !== null && Number.isFinite(ema21) && atr > 0 ? ((close - ema21) * (long ? 1 : -1)) / atr : null;
  const blocks: string[] = [];
  if (er !== undefined && er !== null && Number.isFinite(er) && er < s.chopMinEfficiency) blocks.push(`chop er=${er.toFixed(2)}<${s.chopMinEfficiency}`);
  if (emaAtr !== null && emaAtr < s.chopMinEmaAtr) blocks.push(`ema ${emaAtr >= 0 ? '+' : ''}${emaAtr.toFixed(2)}atr<${s.chopMinEmaAtr}`);
  const erTxt = er === undefined || er === null || !Number.isFinite(er) ? 'na' : er.toFixed(2);
  const emaTxt = emaAtr === null ? 'na' : `${emaAtr >= 0 ? '+' : ''}${emaAtr.toFixed(2)}atr`;
  return {
    blocked: blocks.length > 0,
    reason: blocks.length ? `chop blocked: ${blocks.join(', ')}` : `chop ok: er=${erTxt} ema=${emaTxt}`,
    emaAtr,
  };
}

export const chopGuard: EntryHook = ctx => {
  const long = ctx.trigger.side === 'long';
  const er = ctx.metrics.efficiencyRatio;
  const v = chopRead(er, ctx.candle.close, ctx.ema21, ctx.atr, long, chopGuardSettings(ctx.config));
  probe(ctx, {
    chopBlocked: v.blocked,
    chopEr: er === undefined ? null : Number(er.toFixed(3)),
    chopEmaAtr: v.emaAtr === null ? null : Number(v.emaAtr.toFixed(3)),
    chopReason: v.reason,
  });
  if (v.blocked) return false;
  ctx.log(v.reason);
  return true;
};
