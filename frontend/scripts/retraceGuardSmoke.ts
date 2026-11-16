// Smoke tests for the Retrace Guard entry hook (src/strategies/retraceGuard.ts): the pure verdict
// on synthetic bounces off a major low, the long mirror, no lookahead, the registry, and the
// NIFTY 50 15m short of 2020-12-15 12:30 (SELL 13497.5) that motivated it.
//
//   npm run backtest:retraceguard   (tsx scripts/retraceGuardSmoke.ts)
import { createRequire } from 'node:module';
import type { Candle } from '../src/types';
import type { SwingPoint } from '../src/utils/marketStructure';
import { defaultAutoBacktestConfig } from '../src/utils/autoBacktestEngine';
import { getSwingPointsAt } from '../src/utils/marketStructure';
import { retraceGuard, retraceGuardRead, retraceGuardSettings, DEFAULT_RETRACE_GUARD } from '../src/strategies/retraceGuard';
import { getEntryHook } from '../src/strategies';

let passed = 0, failed = 0;
const assert = (c: boolean, m: string) => {
  if (c) { passed++; console.log(`  ✓ ${m}`); } else { failed++; console.error(`  ✗ FAIL: ${m}`); }
};

const S = retraceGuardSettings({});
const LB = 20;
const bar = (open: number, close: number, i: number): Candle => ({
  timestamp: 1767600000 + i * 900, open, close,
  high: Math.max(open, close) + 0.5, low: Math.min(open, close) - 0.5, volume: 0,
});

/** 50 quiet bars (body 0.5), a low at bar 50 = 990, then `bounce` as [open, close] pairs. */
function fixture(bounce: Array<[number, number]>): Candle[] {
  const c: Candle[] = [];
  for (let i = 0; i < 50; i++) c.push(bar(1000, i % 2 ? 1000.5 : 999.5, i));
  c.push({ ...bar(991, 990.5, 50), low: 990 });
  bounce.forEach(([o, cl], k) => c.push(bar(o, cl, 51 + k)));
  return c;
}
// Leg: high 1020 at bar 40 → low 990 at bar 50 (2.9% of 1020). 50% level = 1005.
const P: SwingPoint[] = [
  { type: 'low', price: 999, barIndex: 20, time: 0 },
  { type: 'high', price: 1020, barIndex: 40, time: 0 },
  { type: 'low', price: 990, barIndex: 50, time: 0 },
];
const strong: Array<[number, number]> = [[990.5, 993.5], [993.5, 997], [997, 1001], [1001, 1006], [1006, 1004.5]];

console.log('\n1. retraceGuardRead — short triggers off a major low');
{
  const A = fixture(strong);
  const now = A.length - 1;
  const v = retraceGuardRead(A, P, now, false, S, LB);
  assert(v.blocked && v.major === 990 && v.level === 1005, `≥50% with 3 bull bars in a row → blocked (${v.reason})`);
  assert(!retraceGuardRead(A, P, now, true, S, LB).blocked, 'long on the same bar is not judged against the low');

  const B = fixture([[990.5, 993.5], [993.5, 997], [997, 1001], [1001, 1000]]);
  assert(!retraceGuardRead(B, P, B.length - 1, false, S, LB).blocked, 'bounce under 50% → allowed');

  // Bull bars alternate with small bears: reaches 1006, never 3 in a row.
  const C = fixture([[990.5, 994.5], [994.5, 994], [994, 998], [998, 997.5], [997.5, 1001.5], [1001.5, 1001], [1001, 1006], [1006, 1005]]);
  assert(!retraceGuardRead(C, P, C.length - 1, false, S, LB).blocked, '≥50% but bull bars not consecutive → allowed');

  const E = fixture([...strong, [1004.5, 1000], [1000, 996], [996, 993]]);
  assert(retraceGuardRead(E, P, E.length - 1, false, S, LB).blocked, 'fades back under 50% without breaking the low → still blocked');

  const D = fixture([...strong, [1004.5, 1000], [1000, 993], [993, 989]]);
  const dv = retraceGuardRead(D, P, D.length - 1, false, S, LB);
  assert(!dv.blocked && /broken/.test(dv.reason), 'close below the major low → allowed (breaking bar itself enters)');
  const D2 = fixture([...strong, [1004.5, 1000], [1000, 993], [993, 989], [989, 992]]);
  assert(!retraceGuardRead(D2, P, D2.length - 1, false, S, LB).blocked, 'and stays allowed after the break');

  const small: SwingPoint[] = [P[0], { type: 'high', price: 1002, barIndex: 40, time: 0 }, P[2]];
  const sv = retraceGuardRead(A, small, now, false, S, LB);
  assert(!sv.blocked && sv.major === null, `leg 1.2% < 1.3% → not a major low (${sv.reason})`);
  assert(retraceGuardRead(A, small, now, false, retraceGuardSettings({ retraceGuardMinLegPct: 1 }), LB).blocked,
    'Major Leg % 1 → the same low counts');

  // A newer small HL (leg < 1.3%) during the bounce does not replace the major low.
  const withHl: SwingPoint[] = [...P, { type: 'high', price: 1001.5, barIndex: 53, time: 0 }, { type: 'low', price: 996.5, barIndex: 54, time: 0 }];
  const F = fixture([[990.5, 993.5], [993.5, 997], [997, 1001], [1001, 997], [997, 1006], [1006, 1004.5]]);
  assert(retraceGuardRead(F, withHl, F.length - 1, false, S, LB).major === 990, 'small HL during the bounce does not replace the major low');

  // Leg start walks back through lower highs: 1030 → 1020 → low 990 = leg from 1030.
  const stair: SwingPoint[] = [
    { type: 'low', price: 1010, barIndex: 10, time: 0 }, { type: 'high', price: 1030, barIndex: 20, time: 0 },
    { type: 'low', price: 1005, barIndex: 30, time: 0 }, { type: 'high', price: 1020, barIndex: 40, time: 0 }, P[2],
  ];
  assert(retraceGuardRead(A, stair, now, false, S, LB).level === 1010, 'leg start = top of the run of lower highs (50% of 1030→990 = 1010)');

  const bodyStrict = retraceGuardSettings({ retraceGuardBodyMult: 10 });
  assert(!retraceGuardRead(A, P, now, false, bodyStrict, LB).blocked, 'Retrace Body × 10 → no bar is decent → allowed');
  assert(!retraceGuardRead(A, P, now, false, retraceGuardSettings({ retraceGuardFrac: 0.6 }), LB).blocked, 'Retrace Frac 0.6 (1008) not reached → allowed');
}

console.log('\n2. long mirror, no lookahead, settings');
{
  const flip = (c: Candle): Candle => ({ ...c, open: 2000 - c.open, close: 2000 - c.close, high: 2000 - c.low, low: 2000 - c.high });
  const A = fixture(strong).map(flip);
  const PM = P.map(p => ({ ...p, type: p.type === 'low' ? 'high' : 'low', price: 2000 - p.price }) as SwingPoint);
  const v = retraceGuardRead(A, PM, A.length - 1, true, S, LB);
  assert(v.blocked && v.major === 1010, `long off a major high after a ≥50% bear retrace → blocked (${v.reason})`);
  assert(!retraceGuardRead(A, PM, A.length - 1, false, S, LB).blocked, 'short on the same bar is not judged against the high');

  const full = fixture([...strong, [1004.5, 1000], [1000, 993], [993, 989]]);
  const at = 55;
  assert(JSON.stringify(retraceGuardRead(full, P, at, false, S, LB)) === JSON.stringify(retraceGuardRead(full.slice(0, at + 1), P, at, false, S, LB)),
    'verdict at a bar ignores every later bar');
  assert(retraceGuardSettings({ retraceGuardBullBars: 2.7 }).retraceGuardBullBars === 2, 'bar count floored');
  assert(retraceGuardSettings({ retraceGuardFrac: NaN }).retraceGuardFrac === DEFAULT_RETRACE_GUARD.retraceGuardFrac, 'non-finite falls back to default');
  assert(getEntryHook('retrace-guard') === retraceGuard, 'registered as retrace-guard');
}

console.log('\n3. NIFTY 50 15m — SELL 13497.5 at 2020-12-15 12:30');
{
  const raw = createRequire(import.meta.url)('../src/assets/market-data/NIFTY_50_15minute.json') as Array<{ date: string; open: number; high: number; low: number; close: number }>;
  const C: Candle[] = raw.map(d => ({
    timestamp: Date.parse(d.date.replace(' ', 'T') + '+05:30') / 1000, open: d.open, high: d.high, low: d.low, close: d.close, volume: 0,
  }));
  const idx = C.findIndex(c => c.timestamp === 1608015600);
  if (idx < 0) {
    console.log('   (2020-12-15 12:30 not in bundled data — skipped)');
  } else {
    const cfg = defaultAutoBacktestConfig;
    const from = Math.max(0, idx - (cfg.entryHookLookback ?? 1200) + 1);
    const sw = getSwingPointsAt(C, idx, from, cfg, 1);
    const v = retraceGuardRead(C, sw, idx, false, retraceGuardSettings(cfg), cfg.barRangeLookback ?? 20);
    console.log(`   default 1.3%: ${v.reason}`);
    assert(v.blocked, 'the 12:30 short is blocked at the default Major Leg %');
    // The chart's circled low 13403.25 (2020-12-11 14:15) has a 13578.5 → 13403.25 leg = 1.29%,
    // just under the default; the 13447.4 LL of 2020-12-15 is a 0.86% leg — a pullback, not major.
    const w = retraceGuardRead(C, sw, idx, false, retraceGuardSettings({ retraceGuardMinLegPct: 1.25 }), cfg.barRangeLookback ?? 20);
    console.log(`   1.25%:        ${w.reason}`);
    assert(w.blocked && w.major === 13403.25, 'at 1.25% the major low is the circled 13403.25 and the short is blocked');
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
