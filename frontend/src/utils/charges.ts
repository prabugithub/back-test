import type { Trade } from '../types';
import type { GroupedPosition } from './tradeAnalysis';

/**
 * Indian F&O trading charges — FUTURES model.
 *
 * Backtest trades record the underlying price × quantity (no option premium), so
 * every fill's turnover is `price × quantity` and the futures rate set applies.
 * Charges are a derived overlay: stored `Trade.pnl` stays gross, and the numbers
 * here are recomputed from the current settings every time they are displayed —
 * editing a rate updates every view retroactively.
 */
export interface ChargesConfig {
  brokeragePerOrder: number; // ₹ flat per executed order (every fill)
  sttSellPct: number;        // % of SELL-side turnover
  exchangePct: number;       // % of all turnover (NSE/BSE transaction charge)
  sebiPerCrore: number;      // ₹ per crore of all turnover
  ipftPerCrore: number;      // ₹ per crore of all turnover (NSE Investor Protection Fund)
  stampBuyPct: number;       // % of BUY-side turnover
  gstPct: number;            // % on brokerage + exchange + SEBI + IPFT
}

export const DEFAULT_FUTURES_CHARGES: ChargesConfig = {
  brokeragePerOrder: 20,
  sttSellPct: 0.05,
  exchangePct: 0.00173,
  sebiPerCrore: 10,
  ipftPerCrore: 0.1,
  stampBuyPct: 0.002,
  gstPct: 18,
};

export interface ChargesBreakdown {
  brokerage: number;
  stt: number;
  exchange: number;
  sebi: number;
  ipft: number;
  stamp: number;
  gst: number;
  total: number;
  turnover: number;
  orders: number; // fills that were charged brokerage
}

const CRORE = 1e7;

export const emptyCharges = (): ChargesBreakdown => ({
  brokerage: 0, stt: 0, exchange: 0, sebi: 0, ipft: 0, stamp: 0, gst: 0, total: 0, turnover: 0, orders: 0,
});

function addInto(acc: ChargesBreakdown, c: ChargesBreakdown): void {
  acc.brokerage += c.brokerage;
  acc.stt += c.stt;
  acc.exchange += c.exchange;
  acc.sebi += c.sebi;
  acc.ipft += c.ipft;
  acc.stamp += c.stamp;
  acc.gst += c.gst;
  acc.total += c.total;
  acc.turnover += c.turnover;
  acc.orders += c.orders;
}

/** Charges for one fill. `chargeBrokerage=false` for the second half of a split flip fill (same order). */
export function computeExecutionCharges(
  trade: Pick<Trade, 'type' | 'price' | 'quantity'>,
  cfg: ChargesConfig,
  chargeBrokerage = true,
): ChargesBreakdown {
  const turnover = Math.abs(trade.price * trade.quantity);
  const isSell = trade.type === 'SELL';
  const brokerage = chargeBrokerage ? cfg.brokeragePerOrder : 0;
  const stt = isSell ? turnover * cfg.sttSellPct / 100 : 0;
  const exchange = turnover * cfg.exchangePct / 100;
  const sebi = turnover * cfg.sebiPerCrore / CRORE;
  const ipft = turnover * cfg.ipftPerCrore / CRORE;
  const stamp = isSell ? 0 : turnover * cfg.stampBuyPct / 100;
  const gst = (brokerage + exchange + sebi + ipft) * cfg.gstPct / 100;
  return {
    brokerage, stt, exchange, sebi, ipft, stamp, gst,
    total: brokerage + stt + exchange + sebi + ipft + stamp + gst,
    turnover,
    orders: chargeBrokerage ? 1 : 0,
  };
}

/**
 * Charges per grouped position plus session totals. A flip fill is split by
 * groupTradesIntoPositions into two executions sharing one trade id — it was one
 * order, so brokerage is charged once (to whichever position sees it first, i.e.
 * the closing one in chronological order).
 */
export function computePositionsCharges(
  positions: GroupedPosition[],
  cfg: ChargesConfig,
): { byPositionId: Map<string, ChargesBreakdown>; totals: ChargesBreakdown } {
  const byPositionId = new Map<string, ChargesBreakdown>();
  const totals = emptyCharges();
  const brokered = new Set<string>();

  // groupTradesIntoPositions returns most-recent-first; walk oldest-first so a flip's
  // brokerage lands on the position it closed.
  const chronological = [...positions].sort((a, b) => a.entryTime - b.entryTime);
  for (const pos of chronological) {
    const acc = emptyCharges();
    for (const exec of pos.executions) {
      const firstSeen = !exec.id || !brokered.has(exec.id);
      if (exec.id) brokered.add(exec.id);
      addInto(acc, computeExecutionCharges(exec, cfg, firstSeen));
    }
    byPositionId.set(pos.id, acc);
    addInto(totals, acc);
  }
  return { byPositionId, totals };
}

/** Positions with realizedPnL reduced by their charges — feed to calculatePerformanceStats for net stats. */
export function toNetPositions(
  positions: GroupedPosition[],
  byPositionId: Map<string, ChargesBreakdown>,
): GroupedPosition[] {
  return positions.map(p => ({ ...p, realizedPnL: p.realizedPnL - (byPositionId.get(p.id)?.total ?? 0) }));
}

/** Coerces arbitrary (possibly partial / persisted) input into a valid config — missing or invalid fields fall back to defaults, negatives clamp to 0. */
export function normalizeChargesConfig(raw: unknown): ChargesConfig {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_FUTURES_CHARGES };
  for (const key of Object.keys(out) as (keyof ChargesConfig)[]) {
    const v = Number(src[key]);
    if (src[key] !== undefined && src[key] !== null && src[key] !== '' && Number.isFinite(v)) {
      out[key] = Math.max(0, v);
    }
  }
  return out;
}
