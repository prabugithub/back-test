// Smoke tests for the Chop Guard entry hook (src/strategies/chopGuard.ts): the pure verdict
// at each threshold, long/short mirror, fail-open on missing data, the hook through a fake
// context, and a Gate-mode run on bundled NIFTY 50 15m data (guard off vs on).
//
//   npm run backtest:chopguard   (tsx scripts/chopGuardSmoke.ts)
import { createRequire } from 'node:module';
import type { Candle, Trade } from '../src/types';
import { defaultAutoBacktestConfig, type AutoBacktestConfig } from '../src/utils/autoBacktestEngine';
import { runBatchSimulation } from '../src/utils/batchBacktestSimulator';
import { chopGuard, chopGuardSettings, chopRead, DEFAULT_CHOP_GUARD } from '../src/strategies/chopGuard';
import { getEntryHook } from '../src/strategies';
import { hookProbeStore } from '../src/strategies/debug';

let passed = 0, failed = 0;
const assert = (c: boolean, m: string) => {
  if (c) { passed++; console.log(`  ✓ ${m}`); } else { failed++; console.error(`  ✗ FAIL: ${m}`); }
};

const S = chopGuardSettings({});

console.log('\n1. chopRead verdict');
{
  // close 1012, EMA21 1000, ATR 10 → +1.2 ATR for a long, −1.2 for a short
  assert(!chopRead(0.5, 1012, 1000, 10, true, S).blocked, 'trending long (er 0.5, +1.2 ATR) allowed');
  assert(chopRead(0.5, 1012, 1000, 10, false, S).blocked, 'same bar as a short is on the wrong side of EMA21 → blocked');
  assert(!chopRead(0.5, 988, 1000, 10, false, S).blocked, 'mirror: short 1.2 ATR below EMA21 allowed');
  assert(chopRead(0.19, 1012, 1000, 10, true, S).blocked, 'er 0.19 < 0.2 → chop');
  assert(!chopRead(0.2, 1012, 1000, 10, true, S).blocked, 'er exactly 0.2 → not chop');
  assert(chopRead(0.5, 1003.9, 1000, 10, true, S).blocked, '+0.39 ATR above EMA21 → blocked');
  assert(!chopRead(0.5, 1004, 1000, 10, true, S).blocked, '+0.40 ATR above EMA21 → allowed');
  assert(/chop er=.*ema/.test(chopRead(0.1, 1001, 1000, 10, true, S).reason), 'both failures named in the reason');
  assert(!chopRead(undefined, 1012, 1000, 10, true, S).blocked, 'missing ER fails open');
  assert(!chopRead(0.5, 1001, null, 10, true, S).blocked, 'missing EMA21 fails open');
  assert(!chopRead(0.5, 1001, 1000, 0, true, S).blocked, 'zero ATR fails open');
  assert(!chopRead(0.1, 1012, 1000, 10, true, chopGuardSettings({ chopMinEfficiency: 0 })).blocked, 'Chop Min ER 0 disables the ER check');
  assert(chopGuardSettings({ chopMinEfficiency: 5 }).chopMinEfficiency === 1, 'ER threshold clamped to [0, 1]');
  assert(chopGuardSettings({ chopMinEmaAtr: NaN }).chopMinEmaAtr === DEFAULT_CHOP_GUARD.chopMinEmaAtr, 'non-finite EMA threshold falls back to default');
}

console.log('\n2. the hook');
{
  const candle = { timestamp: 1767600000, open: 1010, high: 1013, low: 1009, close: 1012, volume: 0 } as Candle;
  const run = (er: number, side: 'long' | 'short') => {
    const logs: string[] = [];
    const res = chopGuard({
      candles: [candle], index: 0, absoluteIndex: 0, candle, fullCandles: [candle],
      trigger: { source: 'signal', label: side === 'long' ? 'H1' : 'L1', side, count: 1, barIndex: 0 },
      regime: 'trending', ltMarket: '', htMarket: '', pivotSeq: '', ema21: 1000, ema60: null, atr: 10,
      pivots: [], metrics: { efficiencyRatio: er }, legWindow: null, signals: [],
      config: defaultAutoBacktestConfig, state: {}, log: (m: string) => logs.push(m),
    } as never);
    return { res, logs, row: hookProbeStore.rows[hookProbeStore.rows.length - 1] };
  };
  const ok = run(0.5, 'long');
  assert(ok.res === true && ok.logs[0]?.startsWith('chop ok') && ok.row.chopBlocked === false, 'clean long → true, reason logged, probe row');
  const bad = run(0.1, 'long');
  assert(bad.res === false && bad.logs.length === 0 && bad.row.chopBlocked === true, 'chop → false, nothing logged');
  assert(getEntryHook('climax-rejection') === chopGuard, 'retired id climax-rejection resolves to Chop Guard');
}

console.log('\n3. Gate mode on NIFTY 50 15m (last 3 years), pivot-entry config');
{
  const raw = createRequire(import.meta.url)('../src/assets/market-data/NIFTY_50_15minute.json') as Array<{ date: string; open: number; high: number; low: number; close: number }>;
  const C: Candle[] = raw.slice(-25 * 750).map(d => ({
    timestamp: Date.parse(d.date.replace(' ', 'T') + '+05:30') / 1000, open: d.open, high: d.high, low: d.low, close: d.close, volume: 0,
  }));
  const regime = { entryMode: 'PIVOT', slMethod: 'atr', slAtrMultiplier: 2, targetRR: 2, exitOnReversal: true, exitReversalConfirmBars: 2, maFilter: 'on_or_above_ema21' };
  const D = defaultAutoBacktestConfig;
  const base = {
    ...D, enabled: true, autoSquareOff: false, slTpFillMode: 'exact',
    uptrend: { ...D.uptrend, ...regime, enabled: true, direction: 'LONG_ONLY' },
    downtrend: { ...D.downtrend, ...regime, enabled: true, direction: 'SHORT_ONLY' },
    range: { ...D.range, ...regime, enabled: true, direction: 'BOTH' },
    reversal: { ...D.reversal, enabled: false },
  } as AutoBacktestConfig;
  const hook = { entryHookId: 'chop-guard', entryHookMode: 'gate' } as const;
  const on = {
    ...base, uptrend: { ...base.uptrend, ...hook }, downtrend: { ...base.downtrend, ...hook }, range: { ...base.range, ...hook },
  } as AutoBacktestConfig;

  const rOf = (trades: Trade[]) => {
    const out: number[] = [];
    let open: Trade | null = null;
    for (const t of trades) {
      if (t.pnl === undefined) { open = t; continue; }
      if (!open) continue;
      const risk = Math.abs(open.price - (open.stopLoss ?? open.price)) || 1;
      out.push(t.pnl / risk / open.quantity);
      open = null;
    }
    return out;
  };
  const sum = (r: number[]) => {
    const gp = r.filter(x => x > 0).reduce((a, x) => a + x, 0), gl = -r.filter(x => x <= 0).reduce((a, x) => a + x, 0);
    return `${r.length} trades, avg ${(r.reduce((a, x) => a + x, 0) / (r.length || 1)).toFixed(3)}R, PF ${(gl ? gp / gl : 0).toFixed(2)}`;
  };
  const off = rOf(runBatchSimulation(C, base, 60, 'NIFTY', 1, '15').trades);
  const gated = rOf(runBatchSimulation(C, on, 60, 'NIFTY', 1, '15').trades);
  console.log(`   off:  ${sum(off)}`);
  console.log(`   gate: ${sum(gated)}`);
  assert(gated.length > 0 && gated.length < off.length, 'gate keeps some entries and removes some');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
