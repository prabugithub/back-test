// Smoke tests for the Climax Rejection entry guard (src/strategies/climaxRejection.ts):
// rule 0 failed climax, rule 1 climax against, rule 2 double top/bottom + big reversal,
// rule 3 at a double top/bottom — each on hand-built candles, long side and its mirror.
//
//   npm run backtest:climaxrejection   (tsx scripts/climaxRejectionSmoke.ts)
import type { Candle } from '../src/types';
import { defaultAutoBacktestConfig, type AutoBacktestConfig } from '../src/utils/autoBacktestEngine';
import {
  climaxRejectionGuard, findAtDoubleTop, findClimaxAgainst, findClimaxRejection, findDoubleTopReversal,
} from '../src/strategies/climaxRejection';
import { hookProbeStore } from '../src/strategies/debug';

let passed = 0, failed = 0;
const assert = (c: boolean, m: string) => {
  if (c) { passed++; console.log(`  ✓ ${m}`); } else { failed++; console.error(`  ✗ FAIL: ${m}`); }
};

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const T0 = Date.UTC(2026, 0, 5, 3, 45, 0) / 1000;
const bar = (open: number, close: number, high?: number, low?: number): Candle => ({
  timestamp: 0, open, close, high: high ?? Math.max(open, close), low: low ?? Math.min(open, close), volume: 1000,
});
/** Quiet bars around `p`: range 10, alternating colour. */
const flat = (n: number, p = 1000) => Array.from({ length: n }, (_, i) => bar(p + (i % 2 ? 1 : -1), p - (i % 2 ? 1 : -1), p + 5, p - 5));
/** Bars following a close path: open = previous close, ±3 wicks. */
function path(n: number, f: (i: number) => number): Candle[] {
  const c: Candle[] = [];
  for (let i = 0; i < n; i++) {
    const open = i ? c[i - 1].close : f(0), close = f(i);
    c.push(bar(open, close, Math.max(open, close) + 3, Math.min(open, close) - 3));
  }
  return c;
}
const stamp = (c: Candle[]) => c.map((k, i) => ({ ...k, timestamp: T0 + i * 60 }));
/** Price mirror around 1000: a long fixture becomes the same fixture for a short. */
const flip = (c: Candle[]) => c.map(k => ({ ...k, open: 2000 - k.open, close: 2000 - k.close, high: 2000 - k.low, low: 2000 - k.high }));
const lin = (pts: [number, number][]) => (i: number) => {
  let k = 0;
  while (k < pts.length - 2 && i > pts[k + 1][0]) k++;
  const [x0, y0] = pts[k], [x1, y1] = pts[k + 1];
  return y0 + ((y1 - y0) * Math.min(1, Math.max(0, (i - x0) / (x1 - x0))));
};

const LB = 20, TOL = 5;

// ─── Rule 0 ───────────────────────────────────────────────────────────────────
console.log('\n0. failed climax (4.5x bear bar, low held, bull bar → no short)');
{
  const base = flat(25, 1050);
  const bear = bar(1050, 1000, 1052, 1000); // range 52 ≈ 5.2x
  const held = [...base, bear, bar(1002, 1004, 1006, 1001), bar(1004, 1003, 1005, 1002)];
  assert(findClimaxRejection(held, held.length - 1, false, LB, 4.5, 20)?.climaxBar === 25, 'short blocked while 1000 holds after a bull bar');
  assert(findClimaxRejection(held, held.length - 1, true, LB, 4.5, 20) === null, 'longs untouched by a bear climax');
  const broke = [...base, bear, bar(1002, 1004, 1006, 1001), bar(1004, 998, 1005, 997)];
  assert(findClimaxRejection(broke, broke.length - 1, false, LB, 4.5, 20) === null, 'a low below 1000 lifts it');
  const expired = [...held, ...flat(20, 1004)];
  assert(findClimaxRejection(expired, expired.length - 1, false, LB, 4.5, 20) === null, 'window of 20 bars expires');
  const f = flip(held);
  assert(findClimaxRejection(f, f.length - 1, true, LB, 4.5, 20)?.climaxBar === 25, 'mirror: failed bull climax blocks longs');
}

// ─── Rule 1 ───────────────────────────────────────────────────────────────────
console.log('\n1. climax against (3x bar against the side → blocked 50 bars)');
{
  const C = [...flat(30), bar(1003, 970, 1004, 969), ...flat(60, 975)]; // range 35 = 3.5x
  assert(findClimaxAgainst(C, 40, true, LB, 3, 50)?.bar === 30, 'long blocked 10 bars after a 3.5x bear bar');
  assert(findClimaxAgainst(C, 80, true, LB, 3, 50)?.bar === 30, '…still blocked at 50 bars');
  assert(findClimaxAgainst(C, 81, true, LB, 3, 50) === null, '…free at 51 bars');
  assert(findClimaxAgainst(C, 40, false, LB, 3, 50) === null, 'a bear bar does not block shorts');
  const small = [...flat(30), bar(1003, 977, 1004, 976), ...flat(10, 980)]; // range 28 = 2.8x
  assert(findClimaxAgainst(small, 40, true, LB, 3, 50) === null, 'a 2.8x bar is under the multiple');
  const f = flip(C);
  assert(findClimaxAgainst(f, 40, false, LB, 3, 50)?.bar === 30, 'mirror: 3.5x bull bar blocks shorts');
}

// ─── Double-top fixture ───────────────────────────────────────────────────────
// Up 1000 → 1050 (bar 30), down to 1010 (bar 45), back up to 1050 (bar 60): tops 30 bars apart.
const DT: [number, number][] = [[0, 1000], [20, 1000], [30, 1050], [45, 1010], [60, 1050], [200, 1050]];
const dtPath = (n: number, knots = DT) => stamp(path(n, lin(knots)));
function withReversal(revAt: number, after: (i: number) => number, knots = DT): Candle[] {
  const c = dtPath(revAt, knots);
  const o = c[revAt - 1].close;
  c.push(bar(o, o - 18, o + 1, o - 19)); // range 20 ≈ 2.4x the ~8.5 baseline (under rule 1's 3x)
  let p = o - 18;
  for (let i = revAt + 1; i < revAt + 80; i++) { const cl = after(i) ?? p; c.push(bar(p, cl, Math.max(p, cl) + 3, Math.min(p, cl) - 3)); p = cl; }
  return stamp(c);
}

// ─── Rule 2 ───────────────────────────────────────────────────────────────────
console.log('\n2. double top + 2x reversal bar within 9 bars → no long for 50 bars');
{
  const C = withReversal(62, () => 1024);
  const r = findDoubleTopReversal(C, 70, true, LB, 2, 9, 50, 25, TOL);
  assert(r?.reversalBar === 62 && [30, 31].includes(r.top1) && [60, 61].includes(r.top2), `long blocked (${JSON.stringify(r && { r: r.reversalBar, t1: r.top1, t2: r.top2 })})`);
  assert(findDoubleTopReversal(C, 112, true, LB, 2, 9, 50, 25, TOL)?.reversalBar === 62, '…still blocked 50 bars later');
  assert(findDoubleTopReversal(C, 113, true, LB, 2, 9, 50, 25, TOL) === null, '…free after 50 bars');
  assert(findDoubleTopReversal(C, 70, false, LB, 2, 9, 50, 25, TOL) === null, 'shorts are not blocked by a double top');
  const lifted = withReversal(62, i => (i >= 66 && i <= 68 ? 1024 + (i - 65) * 13 : i > 68 ? 1063 : 1024));
  assert(findDoubleTopReversal(lifted, 66, true, LB, 2, 9, 50, 25, TOL)?.reversalBar === 62, 'blocked before the level breaks');
  assert(findDoubleTopReversal(lifted, 72, true, LB, 2, 9, 50, 25, TOL) === null, 'a close above the top + tol lifts it');
  const late = withReversal(75, () => 1024, [[0, 1000], [20, 1000], [30, 1050], [45, 1010], [60, 1050], [66, 1030], [200, 1030]]);
  assert(findDoubleTopReversal(late, 80, true, LB, 2, 9, 50, 25, TOL) === null, 'a reversal 15 bars after the top is outside the 9-bar window');
  assert(findDoubleTopReversal(C, 70, true, LB, 2, 9, 50, 35, TOL) === null, 'tops 30 bars apart fail a 35-bar min gap');
  const f = flip(C);
  assert(findDoubleTopReversal(f, 70, false, LB, 2, 9, 50, 25, TOL)?.reversalBar === 62, 'mirror: double bottom + bull reversal blocks shorts');
}

// ─── Rule 3 ───────────────────────────────────────────────────────────────────
console.log('\n3. at a double top (tops ≥ 25 bars apart) → no long');
{
  const C = dtPath(90);
  assert([30, 31].includes(findAtDoubleTop(C, 60, true, 25, TOL)?.top1 ?? -1), 'long blocked on the second-top bar');
  assert((findAtDoubleTop(C, 65, true, 25, TOL)?.top2 ?? 0) >= 60, '…and while price stays at the level');
  assert(findAtDoubleTop(C, 60, false, 25, TOL) === null, 'shorts are not blocked by a double top');
  assert(findAtDoubleTop(C, 60, true, 35, TOL) === null, 'tops 30 bars apart fail a 35-bar min gap');
  const away = withReversal(62, () => 1020);
  assert(findAtDoubleTop(away, 70, true, 25, TOL) === null, 'free once price has left the level');
  const f = flip(C);
  assert([30, 31].includes(findAtDoubleTop(f, 60, false, 25, TOL)?.top1 ?? -1), 'mirror: shorts blocked at a double bottom');
}

// ─── The hook ─────────────────────────────────────────────────────────────────
console.log('\n4. the hook: rule order, verdict, probe');
{
  const cfg = { ...defaultAutoBacktestConfig } as AutoBacktestConfig;
  const state = {};
  const run = (C: Candle[], i: number, side: 'long' | 'short', atr = 10) => {
    const logs: string[] = [];
    const res = climaxRejectionGuard({
      candles: C.slice(0, i + 1), index: i, absoluteIndex: i, candle: C[i], fullCandles: C,
      trigger: { source: 'signal', label: side === 'long' ? 'H1' : 'L1', side, count: 1, barIndex: i },
      regime: 'trending', ltMarket: '', htMarket: '', pivotSeq: '', ema21: null, ema60: null, atr,
      pivots: [], metrics: {}, legWindow: null, signals: [], config: cfg, state, log: m => logs.push(m),
    } as never);
    const row = hookProbeStore.rows[hookProbeStore.rows.length - 1];
    if (process.env.DBG) console.log("   dbg", side, i, res, row.crRule, row.crDetail, logs);
    return { res, rule: row.crRule, logs };
  };
  const C = withReversal(62, () => 1024);
  assert(run(C, 70, 'long').rule === 'dtReversal' && run(C, 70, 'long').res === false, 'double top reversal → long refused (dtReversal)');
  const top = dtPath(90);
  assert(run(top, 61, 'long').rule === 'atDoubleTop', 'at the second top → long refused (atDoubleTop)');
  const big = [...flat(30), bar(1003, 970, 1004, 969), ...flat(10, 975)].map((k, i) => ({ ...k, timestamp: T0 + i * 60 }));
  assert(run(big, 40, 'long').rule === 'climaxAgainst', '3.5x bear bar → long refused (climaxAgainst)');
  const q = stamp(path(60, i => 1000 + i * 2)); // steady climb: no big bars, no double top
  const ok = run(q, 59, 'long');
  assert(ok.res === true && ok.rule === null && ok.logs.length === 1, 'quiet market → allowed, reason logged');
  assert(run(C, 70, 'long', 0).rule === null, 'no ATR → double top rules skipped');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
