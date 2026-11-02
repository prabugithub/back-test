// Smoke tests for the S/R Guard entry hook (src/strategies/srGuard.ts): counter trendline,
// horizontal swing levels, the "never the first break" rule, trend entries staying open,
// look-ahead safety, and a Gate-mode run on the bundled Nifty 5m data resampled to 15m.
//
//   npm run backtest:srguard   (tsx scripts/srGuardSmoke.ts)
import { createRequire } from 'node:module';
import type { Candle } from '../src/types';
import { getPivotPointsUpTo } from '../src/utils/indicators';
import { defaultAutoBacktestConfig, resolveMinPivotGapBars, type AutoBacktestConfig } from '../src/utils/autoBacktestEngine';
import { runBatchSimulation } from '../src/utils/batchBacktestSimulator';
import { resampleCandles } from '../src/utils/resampler';
import { findSwingLevels, srGuardRead, type SrGuardVerdict } from '../src/strategies/srGuard';

let passed = 0, failed = 0;
const assert = (c: boolean, m: string) => {
  if (c) { passed++; console.log(`  ✓ ${m}`); } else { failed++; console.error(`  ✗ FAIL: ${m}`); }
};

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function series(n: number, path: (i: number) => number): Candle[] {
  const base = Date.UTC(2026, 0, 5, 3, 45, 0) / 1000;
  const c: Candle[] = [];
  for (let i = 0; i < n; i++) {
    const open = i ? c[i - 1].close : path(0), close = path(i);
    c.push({ timestamp: base + i * 60, open, close, high: Math.max(open, close) + 3, low: Math.min(open, close) - 3, volume: 1000 });
  }
  return c;
}
const sine = (i: number, amp: number, per: number) => amp * Math.sin((2 * Math.PI * i) / per);
/** Piecewise-linear path through (bar, price) knots plus a small wiggle for pivots. */
const knots = (pts: [number, number][]) => (i: number) => {
  let k = 0;
  while (k < pts.length - 2 && i > pts[k + 1][0]) k++;
  const [x0, y0] = pts[k], [x1, y1] = pts[k + 1];
  return y0 + ((y1 - y0) * (i - x0)) / (x1 - x0) + sine(i, 15, 10);
};

const cfg = { ...defaultAutoBacktestConfig, trendlineDegree: 1 } as AutoBacktestConfig;
const gap = resolveMinPivotGapBars(cfg);
const readsOf = (C: Candle[], long = true) =>
  C.map((_, i) => (i < 60 ? null : srGuardRead(C, i, getPivotPointsUpTo(C, i, gap), cfg, long)));
const pivotLows = (C: Candle[]) =>
  getPivotPointsUpTo(C, C.length - 1, gap).filter(p => p.type === 'bullish' && p.barIndex >= 60).map(p => p.barIndex);
const firstWhere = (r: (SrGuardVerdict | null)[], from: number, f: (v: SrGuardVerdict) => boolean) =>
  r.findIndex((v, i) => i >= from && !!v && f(v));

// ─── 1. Flat swing top ────────────────────────────────────────────────────────
console.log('\n1. Horizontal swing top (rally, 0.75% rejection, back near it, break, pullback)');
{
  const C = series(320, knots([[0, 19800], [100, 20200], [130, 20050], [170, 20170], [185, 20280], [200, 20230], [320, 20600]]));
  const R = readsOf(C);
  const lv = findSwingLevels(C, 160, true);
  assert(lv.length === 1 && Math.abs(lv[0].priceAt(160) - 20200) < 15, `one level at the 20200 top (${lv.map(l => l.priceAt(160).toFixed(0))})`);
  assert(R[130]!.allowed && R[130]!.levelState === 'intact', 'entry with room under the level is allowed');
  const near = firstWhere(R, 131, v => v.reason.includes('near res'));
  assert(near > 150 && near < 180 && !R[near]!.allowed, `rally back near the top is blocked (bar ${near})`);
  const fb = firstWhere(R, near, v => v.levelState === 'first_break');
  assert(fb > near && !R[fb]!.allowed, `breakout leg (first break) is blocked (bar ${fb})`);
  const second = pivotLows(C).find(b => b > fb)!;
  assert(R[second]!.allowed && R[second]!.levelState === 'held', `first pullback low holding above the level is allowed (bar ${second})`);

  const small = series(200, knots([[0, 19900], [100, 20000], [130, 19960], [200, 20100]])); // 0.2% dip
  assert(findSwingLevels(small, 199, true).every(l => Math.abs(l.priceAt(199) - 20000) > 20), 'a top with < 0.5% rejection is not a level');
}

// ─── 2. Counter trendline ─────────────────────────────────────────────────────
console.log('\n2. Counter trendline (falling channel, then a rally through it)');
{
  const C = series(420, i => 20000 - 3.5 * i + sine(i, 60, 24) + (i >= 300 ? (i - 300) * 9 : 0));
  const R = readsOf(C);
  const under = pivotLows(C).filter(b => b >= 200 && b < 300);
  assert(under.length > 0 && under.every(b => !R[b]!.allowed && R[b]!.tlState === 'intact'),
    `every pivot-low long under the falling line is blocked (${under.length})`);
  const fb = firstWhere(R, 300, v => v.tlState === 'first_break');
  assert(fb > 300 && !R[fb]!.allowed, `first close through the line is blocked (bar ${fb})`);
  const reopened = firstWhere(R, fb, v => v.tlState === 'held' || v.tlState === 'retest' || v.tlState === 'rebreak');
  assert(reopened > fb, `the line reopens on the second entry (bar ${reopened}, ${R[reopened]?.tlState})`);
  assert(R.slice(400).every(v => v!.allowed), 'once the reversal clears the old highs, longs are allowed');
  const shorts = readsOf(C, false);
  assert(shorts.slice(200, 300).every(v => v!.tlState === 'none'), 'no rising support → shorts see no counter trendline');
}

// ─── 3. Trend entries ─────────────────────────────────────────────────────────
console.log('\n3. Rising staircase — trend pullback entries stay open');
{
  const C = series(420, i => 20000 + 3.5 * i + sine(i, 60, 24));
  const R = readsOf(C);
  const lows = pivotLows(C).filter(b => b >= 100);
  const ok = lows.filter(b => R[b]!.allowed).length;
  assert(lows.length >= 10 && ok / lows.length >= 0.9, `${ok}/${lows.length} pivot-low entries allowed`);
}

// ─── 4. Look-ahead ────────────────────────────────────────────────────────────
console.log('\n4. Look-ahead safety');
{
  const C = series(420, i => 20000 - 3.5 * i + sine(i, 60, 24) + (i >= 300 ? (i - 300) * 9 : 0));
  let ok = true;
  for (const i of [150, 250, 305, 331, 360, 400]) {
    const a = srGuardRead(C, i, getPivotPointsUpTo(C, i, gap), cfg, true);
    const S = C.slice(0, i + 1);
    const b = srGuardRead(S, i, getPivotPointsUpTo(S, i, gap), cfg, true);
    if (JSON.stringify(a) !== JSON.stringify(b)) ok = false;
  }
  assert(ok, 'verdicts identical on candles.slice(0, i+1)');
}

// ─── 5. Gate mode on real data ────────────────────────────────────────────────
console.log('\n5. Gate mode on Nifty 15m (Jul 2023 – Jun 2024), pivot-carry-over style config');
{
  const d = createRequire(import.meta.url)('../src/assets/market-data/nifty5min_data.json');
  const from = d.t.findIndex((t: number) => t >= Date.UTC(2023, 6, 1) / 1000);
  const to = d.t.findIndex((t: number) => t >= Date.UTC(2024, 6, 1) / 1000);
  const b: Candle[] = [];
  for (let i = from; i < to; i++) b.push({ timestamp: d.t[i], open: d.o[i], high: d.h[i], low: d.l[i], close: d.c[i], volume: d.v[i] });
  const C = resampleCandles(b, 15);

  const regime = {
    entryMode: 'PIVOT', slMethod: 'atr', slAtrMultiplier: 2, targetRR: 20,
    exitOnReversal: true, exitReversalConfirmBars: 2, maFilter: 'on_or_above_ema21',
  } as const;
  const base = {
    ...defaultAutoBacktestConfig, enabled: true, autoSquareOff: false, slTpFillMode: 'exact',
    uptrend: { ...defaultAutoBacktestConfig.uptrend, ...regime, enabled: true, direction: 'LONG_ONLY' },
    downtrend: { ...defaultAutoBacktestConfig.downtrend, ...regime, enabled: true, direction: 'SHORT_ONLY' },
    range: { ...defaultAutoBacktestConfig.range, enabled: false },
    reversal: { ...defaultAutoBacktestConfig.reversal, enabled: false },
  } as AutoBacktestConfig;
  const hook = { entryHookId: 'sr-guard', entryHookMode: 'gate' } as const;
  const on = { ...base, uptrend: { ...base.uptrend, ...hook }, downtrend: { ...base.downtrend, ...hook } } as AutoBacktestConfig;
  const run = (k: AutoBacktestConfig) => runBatchSimulation(C, k, 60, 'NIFTY', 1, '15').trades.filter(t => t.journal);
  const t0 = performance.now();
  const off = run(base), gated = run(on);
  const byTag: Record<string, number> = {};
  for (const t of gated) {
    const m = (t.journal?.entrySign ?? '').match(/SR ok: tl=(\w+) lvl=(\w+)/);
    const k = m ? `tl=${m[1]} lvl=${m[2]}` : '—';
    byTag[k] = (byTag[k] ?? 0) + 1;
  }
  console.log(`   ${C.length} bars | entries off ${off.length} → gate ${gated.length} in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`   at entry: ${JSON.stringify(byTag)}`);
  assert(gated.length > 0 && gated.length <= off.length, 'gate keeps some entries and adds none');
  assert(gated.every(t => /SR ok:/.test(t.journal?.entrySign ?? '')), 'every gated entry carries the "SR ok" verdict');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
