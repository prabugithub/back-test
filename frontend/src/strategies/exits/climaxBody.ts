/**
 * Climax Profit (body + range) — the Climax Profit exit, but the climax bar must be oversized
 * by BOTH its range (high − low) AND its body (|close − open|).
 *
 * A long-wick bar with a small body (a rejection / spinning top) has a big range but did not
 * actually move price; requiring the body too means only bars that closed far from where they
 * opened count. Kept as a separate hook so it can be A/B tested against the range version.
 *
 * ── Rules ────────────────────────────────────────────────────────────────────
 *
 *   • big range — high − low ≥ `climaxExitMultiple` × the mean range of the
 *                 `climaxExitLookback` bars BEFORE it (exactly the Climax Profit rule)
 *   • big body  — AND |close − open| ≥ `climaxExitMultiple` × the mean |close − open| of the
 *                 same bars (same Session Settings → Climax Exit fields for both)
 *   • in profit / not the entry bar — as Climax Profit
 *   • double top / bottom rule — unchanged, shared with Climax Profit (`doubleTopReason`)
 */
import type { ExitHook, ExitHookContext } from '../../utils/exitHook';
import { climaxExitSettings, doubleTopReason, isClimaxBar } from './climax';

/**
 * Body ratio of `candles[k]` against the mean body of the `lookback` bars before it, or null
 * when there is no full baseline, the baseline is flat, or the ratio is below `multiple`.
 */
export function isClimaxBodyBar(
  candles: readonly { open: number; close: number }[], k: number, lookback: number, multiple: number,
): number | null {
  if (k < lookback || k >= candles.length) return null;
  let sum = 0;
  for (let j = k - lookback; j < k; j++) sum += Math.abs(candles[j].close - candles[j].open);
  const avgBody = sum / lookback;
  if (avgBody <= 0) return null;
  const ratio = Math.abs(candles[k].close - candles[k].open) / avgBody;
  return ratio >= multiple ? ratio : null;
}

function climaxBodyReason(ctx: ExitHookContext): string | null {
  const { candles, index, position } = ctx;
  const { lookback, multiple } = climaxExitSettings(ctx);
  const rangeRatio = isClimaxBar(candles, index, lookback, multiple);
  if (rangeRatio === null) return null;
  const bodyRatio = isClimaxBodyBar(candles, index, lookback, multiple);
  if (bodyRatio === null) return null;
  return `climax-body: ${rangeRatio.toFixed(1)}x avg range, ${bodyRatio.toFixed(1)}x avg body ` +
    `(${lookback} bars), booked ${position.openPoints.toFixed(2)} pts`;
}

export const climaxProfitBodyExit: ExitHook = ctx => {
  const { position } = ctx;
  if (position.barsInTrade === null || position.barsInTrade < 1) return false;
  if (position.openPoints <= 0) return false;

  const reason = climaxBodyReason(ctx) ?? doubleTopReason(ctx);
  return reason ? { reason } : false;
};
