// Smoke tests for pivot trendlines (utils/marketStructure/trendlines) and their engine
// wiring: detection, look-ahead safety, trend strength, the three setups, the trendline
// stop / trail / break exit, the leg-pattern tl* fields, and a full preset backtest on the
// bundled Nifty 5m data resampled to 15m (no DB needed).
//
//   npm run backtest:trendline   (tsx scripts/trendlineSmoke.ts)
import { createRequire } from 'node:module';
import type { Candle } from '../src/types';
import {
  getTrendlinesAt, getTrendStrengthAt, getTrendlineSetupAt, trendlinePriceAt,
} from '../src/utils/marketStructure';
import {
  AUTO_BT_PRESETS, defaultAutoBacktestConfig, evaluateAutoExitSignal, evaluateTrailStop,
  type AutoBacktestConfig,
} from '../src/utils/autoBacktestEngine';
import { runBatchSimulation } from '../src/utils/batchBacktestSimulator';
import { buildLegWindow, computeAggregates } from '../src/utils/legPattern';
import { resampleCandles } from '../src/utils/resampler';

let passed = 0, failed = 0;
const assert = (c: boolean, m: string) => {
  if (c) { passed++; console.log(`  ✓ ${m}`); } else { failed++; console.error(`  ✗ FAIL: ${m}`); }
};

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** Drifting sine; `shock(i)` adds an arbitrary displacement (crash, false break…). */
function wave(n: number, drift: number, shock: (i: number) => number = () => 0, amp = 6, period = 12): Candle[] {
  const base = Date.UTC(2026, 0, 5, 3, 45, 0) / 1000;
  const path = (i: number) => 20000 + drift * i + amp * Math.sin((2 * Math.PI * i) / period) + shock(i);
  const c: Candle[] = [];
  for (let i = 0; i < n; i++) {
    const open = i === 0 ? path(0) : c[i - 1].close;
    const close = path(i);
    c.push({ timestamp: base + i * 60, open, close, high: Math.max(open, close) + 0.5, low: Math.min(open, close) - 0.5, volume: 1000 });
  }
  return c;
}

function nifty15m(): Candle[] {
  const d = createRequire(import.meta.url)('../src/assets/market-data/nifty5min_data.json');
  const from = d.t.findIndex((t: number) => t >= Date.UTC(2023, 6, 1) / 1000);
  const to = d.t.findIndex((t: number) => t >= Date.UTC(2024, 6, 1) / 1000);
  const b: Candle[] = [];
  for (let i = from; i < to; i++) b.push({ timestamp: d.t[i], open: d.o[i], high: d.h[i], low: d.l[i], close: d.c[i], volume: d.v[i] });
  return resampleCandles(b, 15);
}

const cfg = (over: Partial<AutoBacktestConfig> = {}): AutoBacktestConfig =>
  ({ ...defaultAutoBacktestConfig, trendlineDegree: 1, ...over } as AutoBacktestConfig);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// ─── 1. Detection ─────────────────────────────────────────────────────────────
console.log('\n1. Detection (rising channel, degree 1)');
{
  const C = wave(300, 0.35);
  const s = getTrendlinesAt(C, 299, cfg())!;
  assert(s.support.length > 0 && s.resistance.length > 0, 'rising channel yields support and resistance');
  assert(s.support[0].touches >= 3, 'best support has ≥3 touches');
  assert(Math.abs(s.support[0].slope - 0.35) < 0.1 && Math.abs(s.resistance[0].slope - 0.35) < 0.1, 'both slopes ≈ drift');
  assert(s.support[0].slopeNorm > 0, 'support slopeNorm positive');
  let ok = true;
  for (const i of [80, 150, 220, 299]) if (!same(getTrendlinesAt(C, i, cfg()), getTrendlinesAt(C.slice(0, i + 1), i, cfg()))) ok = false;
  assert(ok, 'no look-ahead: identical on candles.slice(0, i+1)');
  const tiny = getTrendlinesAt(C.slice(0, 10), 9, cfg())!;
  assert(tiny.support.length === 0 && tiny.resistance.length === 0, 'tiny series gives empty sides');
  const crash = wave(300, 0.35, i => (i >= 290 ? -(i - 289) * 4 : 0));
  const before = getTrendlinesAt(crash, 288, cfg())!.support[0];
  const after = getTrendlinesAt(crash, 299, cfg())!;
  assert(!after.support.some(l => l.firstBar === before.firstBar && Math.abs(l.slope - before.slope) < 1e-9), 'crash drops the broken support');
}

// ─── 2. Trend strength ────────────────────────────────────────────────────────
console.log('\n2. Trend strength');
{
  const up = getTrendStrengthAt(wave(300, 0.35), 299, cfg())!;
  const down = getTrendStrengthAt(wave(300, -0.35), 299, cfg())!;
  const flat = getTrendStrengthAt(wave(300, 0), 299, cfg())!;
  console.log(`   up ${up.dir} ${up.strength.toFixed(2)} ch=${up.channel} | down ${down.dir} ${down.strength.toFixed(2)} | flat ${flat.dir}`);
  assert(up.dir === 'up' && up.dirStrength > 0, 'rising channel reads up, positive strength');
  assert(down.dir === 'down' && down.dirStrength < 0, 'falling channel reads down, negative strength');
  assert(flat.dir === 'flat' && flat.strength === 0, 'flat range reads flat, zero strength');
  assert(up.channel === 'parallel', 'parallel channel recognised');
  const steep = getTrendStrengthAt(wave(300, 0.8), 299, cfg())!;
  assert(steep.strength >= up.strength, 'steeper trend is at least as strong');
}

// ─── 3. Setups ────────────────────────────────────────────────────────────────
console.log('\n3. Setups');
{
  // Bounce: in a rising channel some recent bar touched support, and none of them can be a
  // short bounce (resistance is rising — counter-trend for a short).
  const C = wave(300, 0.35);
  let longs = 0, shorts = 0;
  for (let i = 150; i < 300; i++) {
    const s = getTrendlineSetupAt(C, i, cfg(), 'bounce', 3, 1)!;
    if (s.long) longs++;
    if (s.short) shorts++;
  }
  assert(longs > 0, `bounce long fires in a rising channel (${longs} bars)`);
  assert(shorts === 0, 'no bounce short off rising resistance');

  // Failed breakout: flat range, one bar dumps through support, the next closes back in.
  const F = wave(300, 0, i => (i === 280 ? -25 : 0));
  let fb: ReturnType<typeof getTrendlineSetupAt> = null;
  let fbBar = -1;
  for (let i = 281; i < 290 && !fb?.long; i++) { fb = getTrendlineSetupAt(F, i, cfg(), 'failed_break', 8, 1); fbBar = i; }
  assert(!!fb?.long, `failed break below flat support gives a long (bar ${fbBar})`);
  if (fb?.long) {
    assert(fb.long.anchor <= F[280].low + 1e-9, 'failed-break anchor = the excursion low');
    assert(F[fbBar].close > trendlinePriceAt(fb.long.line, fbBar), 'price is back above the line');
  }

  // Look-ahead on setups.
  let ok = true;
  for (const i of [200, 260, 299]) {
    for (const k of ['bounce', 'break_retest', 'failed_break'] as const) {
      if (!same(getTrendlineSetupAt(C, i, cfg(), k, 6, 1), getTrendlineSetupAt(C.slice(0, i + 1), i, cfg(), k, 6, 1))) ok = false;
    }
  }
  assert(ok, 'setups identical on candles.slice(0, i+1)');
}

// ─── 4. Exits ─────────────────────────────────────────────────────────────────
console.log('\n4. Trendline exit + trail');
{
  const crash = wave(320, 0.35, i => (i >= 300 ? -(i - 299) * 4 : 0));
  const c = cfg({ uptrend: { ...defaultAutoBacktestConfig.uptrend, exitOnTrendlineBreak: true, exitTrailTrendline: true } });
  const pos = { quantity: 1, averagePrice: crash[200].close, entryBarIndex: 200, entryRegime: 'uptrend' as const, stopLoss: crash[200].close - 40 };

  let exitBar = -1;
  for (let i = 201; i < 320 && exitBar < 0; i++) {
    const d = evaluateAutoExitSignal(crash, i, pos, c);
    if (d.exit?.reason === 'TRENDLINE_BREAK') exitBar = i;
  }
  assert(exitBar >= 300, `TRENDLINE_BREAK fires on the crash, not before (bar ${exitBar})`);

  let sl = pos.stopLoss, raised = 0, ok = true;
  for (let i = 201; i < 300; i++) {
    const t = evaluateTrailStop(crash, i, { ...pos, stopLoss: sl }, c);
    if (t) {
      if (t.newStopLoss <= sl) ok = false;
      sl = t.newStopLoss; raised++;
      if (sl >= crash[i].low) ok = false;
    }
  }
  assert(raised > 0, `trendline trail ratchets the stop (${raised} raises)`);
  assert(ok, 'trail only tightens and stays below each bar low before the crash');

  const off = evaluateAutoExitSignal(crash, 310, pos, cfg());
  assert(off.exit === null, 'no trendline exit when the setting is off');
}

// ─── 5. Leg-pattern fields ────────────────────────────────────────────────────
console.log('\n5. Leg-pattern window fields');
{
  const C = wave(300, 0.35);
  const w = buildLegWindow(C, 299, { windowLegs: 8, needsPerCandle: false, structureConfig: cfg() });
  const agg = computeAggregates(w, null, 0);
  console.log(`   tlStrength=${agg.tlStrength?.toFixed(2)} supDist=${agg.tlSupDist?.toFixed(2)} resDist=${agg.tlResDist?.toFixed(2)} channel=${agg.tlChannel}`);
  assert(agg.tlStrength !== undefined && agg.tlStrength > 0, 'tlStrength measured and positive');
  assert(agg.tlSupDist !== undefined && agg.tlResDist !== undefined, 'support / resistance distances measured');
  assert(agg.tlChannel === 1, 'tlChannel = parallel code');
  const bare = computeAggregates(buildLegWindow(C, 299, { windowLegs: 8, needsPerCandle: false }), null, 0);
  assert(bare.tlStrength === undefined, 'without a config the tl fields are unmeasurable');
}

// ─── 6. Preset backtest on real data ──────────────────────────────────────────
console.log('\n6. "Trendline (structure-aware)" preset on Nifty 15m (Jul 2023 – Jun 2024)');
{
  const C = nifty15m();
  const preset = { ...defaultAutoBacktestConfig, ...AUTO_BT_PRESETS['Trendline (structure-aware)'], enabled: true } as AutoBacktestConfig;
  const t0 = performance.now();
  const res = runBatchSimulation(C, preset, 60, 'NIFTY', 1, '15');
  const ms = performance.now() - t0;
  const entries = res.trades.filter(t => t.journal);
  const exits = res.trades.filter(t => !t.journal && t.exitReason);
  const byReason: Record<string, number> = {};
  for (const t of exits) byReason[t.exitReason!] = (byReason[t.exitReason!] ?? 0) + 1;
  const bySetup: Record<string, number> = {};
  for (const t of entries) bySetup[t.tlSetupAtEntry ?? '—'] = (bySetup[t.tlSetupAtEntry ?? '—'] ?? 0) + 1;
  console.log(`   ${C.length} bars, ${entries.length} entries in ${(ms / 1000).toFixed(1)}s | setups ${JSON.stringify(bySetup)} | exits ${JSON.stringify(byReason)}`);
  assert(entries.length > 0, 'preset produces trades');
  assert(entries.every(t => t.tlSetupAtEntry !== undefined), 'every entry was let in by a trendline setup');
  assert(entries.every(t => t.tlStrengthAtEntry !== undefined), 'every entry carries the trend-strength stamp');
  assert(entries.every(t => /TL-/.test(t.journal?.entrySign ?? '')), 'entry reasons are tagged TL-…');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
