// Integration smoke for the pivot market-structure classifier against cached candles
// (backend/data/backtesting.db): Market-step gate, regime source = pivot, leg-pattern
// structure clause, hook ctx.structure(), and the correction-stays-one-range behaviour on a
// synthetic NIFTY-like fixture (plus the real NIFTY 26 Jul – 1 Aug 2024 window when cached).
//
//   npx tsx scripts/structureSmoke.ts
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import type { Candle, Trade } from '../src/types';
import {
  AUTO_BT_PRESETS,
  defaultAutoBacktestConfig,
  getRegimeKey,
  type AutoBacktestConfig,
} from '../src/utils/autoBacktestEngine';
import { runBatchSimulation } from '../src/utils/batchBacktestSimulator';
import { registerEntryHook } from '../src/strategies';
import { getStructureAt, getStructureTimeline, structureToLtMarket, BROAD_CODE } from '../src/utils/marketStructure';
import { niftyLikeCandles } from './structureFixture';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(path.resolve(__dirname, '../../backend/data/backtesting.db'), { readonly: true });
const spec = db.prepare(`SELECT security_id s, exchange_segment e, interval i, COUNT(*) n FROM candles
  GROUP BY 1,2,3 ORDER BY n DESC LIMIT 1`).get() as { s: string; e: string; i: string };
const candles = db.prepare(`SELECT timestamp, open, high, low, close, volume FROM candles
  WHERE security_id=? AND exchange_segment=? AND interval=? ORDER BY timestamp ASC`)
  .all(spec.s, spec.e, spec.i) as Candle[];
// Real NIFTY 50 5m around the user's reference chart — only present once loaded in the app.
const toTs = (iso: string) => Date.parse(iso) / 1000;
const nifty = db.prepare(`SELECT timestamp, open, high, low, close, volume FROM candles
  WHERE security_id='13' AND exchange_segment='IDX_I' AND interval='5'
    AND timestamp BETWEEN ? AND ? ORDER BY timestamp ASC`)
  .all(toTs('2024-07-15T00:00:00Z'), toTs('2024-08-02T00:00:00Z')) as Candle[];
db.close();

let passed = 0, failed = 0;
const assert = (c: boolean, m: string) => {
  if (c) { passed++; console.log(`  ✓ ${m}`); } else { failed++; console.error(`  ✗ FAIL: ${m}`); }
};
const byTs = new Map(candles.map((c, i) => [c.timestamp, i]));
const entryIdx = (t: Trade) => byTs.get(t.timestamp) ?? -1;
const all = (): AutoBacktestConfig => ({ ...defaultAutoBacktestConfig, ...AUTO_BT_PRESETS['All Regimes'], enabled: true } as AutoBacktestConfig);
// Batch output holds entry AND exit fills; entries are the ones carrying a journal.
const run = (cfg: AutoBacktestConfig) => runBatchSimulation(candles, cfg, 60, 'X', 1, spec.i).trades.filter(t => t.journal);

console.log(`${spec.s}/${spec.e}/${spec.i}m — ${candles.length} candles`);

// 1. Market-step gate
{
  const base = all();
  const baseTrades = run(base);
  const cfg = all();
  for (const k of ['uptrend', 'downtrend', 'range', 'reversal'] as const) cfg[k] = { ...cfg[k], pivotStructureFilter: 'up' };
  const gated = run(cfg);
  console.log(`\nGate Pivot=Up: ${baseTrades.length} → ${gated.length} trades`);
  assert(gated.length > 0 && gated.length < baseTrades.length, 'gate narrows trades');
  assert(gated.every(t => getStructureAt(candles, entryIdx(t), cfg)?.broad === 'up'), 'every gated entry bar is in an Up structure');

  const sub = all();
  for (const k of ['uptrend', 'downtrend', 'range', 'reversal'] as const) sub[k] = { ...sub[k], pivotSubFilter: ['sideways', 'tight-range'] };
  const subTrades = run(sub);
  assert(subTrades.every(t => {
    const st = getStructureAt(candles, entryIdx(t), sub);
    return st?.sub === 'sideways' || st?.sub === 'tight-range';
  }), `sub filter respected (${subTrades.length} trades)`);
}

// 2. Regime source = pivot
{
  const cfg = { ...all(), regimeSource: 'pivot' as const };
  const trades = run(cfg);
  console.log(`\nRegime source pivot: ${trades.length} trades`);
  assert(trades.length > 0, 'trades still fire');
  assert(trades.every(t => t.journal!.ltMarket === structureToLtMarket(getStructureAt(candles, entryIdx(t), cfg))),
    'journal ltMarket is the pivot structure read');
  const kinds = new Set(trades.map(t => getRegimeKey(t.journal!.ltMarket ?? '')));
  assert(!kinds.has('reversal'), `pivot source never maps to reversal (${[...kinds].join(', ')})`);
}

// 3. Leg-pattern structure clause
{
  const cfg = all();
  for (const k of ['uptrend', 'downtrend', 'range', 'reversal'] as const) {
    cfg[k] = { ...cfg[k], legPattern: { version: 2, enabled: true, legs: [], window: [{ field: 'structureBroad', op: 'in', value: [BROAD_CODE.range] }] } };
  }
  const trades = run(cfg);
  console.log(`\nLeg-pattern structureBroad in [range]: ${trades.length} trades`);
  assert(trades.length > 0 && trades.every(t => getStructureAt(candles, entryIdx(t), cfg)?.broad === 'range'), 'window clause restricts to range bars');
}

// 4. Hook ctx.structure()
{
  let calls = 0, nonNull = 0, legsOk = 0;
  registerEntryHook('__structure_probe', {
    label: 'probe',
    hook: ctx => {
      calls++;
      const st = ctx.structure();
      if (st && st.barIndex <= ctx.absoluteIndex) nonNull++;
      if (Array.isArray(ctx.structureLegs())) legsOk++;
      return st?.broad === 'up';
    },
  });
  const cfg = all();
  for (const k of ['uptrend', 'downtrend', 'range', 'reversal'] as const) cfg[k] = { ...cfg[k], entryHookId: '__structure_probe', entryHookMode: 'replace' };
  const trades = run(cfg);
  console.log(`\nHook: ${calls} calls, ${trades.length} trades`);
  assert(calls > 0 && nonNull === calls && legsOk === calls, 'ctx.structure()/structureLegs() available and causal');
  assert(trades.every(t => getStructureAt(candles, entryIdx(t), cfg)?.broad === 'up'), 'hook decisions follow ctx.structure()');
}

// 5. Correction after a strong trend stays ONE range (synthetic NIFTY-like fixture)
{
  const fx = niftyLikeCandles();
  const states = getStructureTimeline(fx, defaultAutoBacktestConfig);
  const bos = states.findIndex((s, i) => i > 0 && s.broad === 'range' && states[i - 1].broad === 'up');
  console.log(`\nFixture: up-trend → BOS at bar ${bos}`);
  assert(states.slice(20, 60).every(s => s.broad === 'up'), 'strong up-trend read as Up');
  assert(bos > 60 && bos < 80, 'break of structure right after the HH');
  const after = states.slice(bos);
  assert(after.every(s => s.broad === 'range'), 'correction pushes + gap never become Down/Up trends');
  assert(new Set(after.map(s => s.segmentId)).size === 1, 'one range segment from the BOS to the end');
  assert(after.some(s => s.breakoutAttempt === 'down') && after.some(s => s.breakoutAttempt === 'up'),
    'correction pushes and the gap register as breakout attempts');
  const last = after[after.length - 1];
  assert(last.rangeLow! < 24810 && last.rangeLow! > 24790, `range low = lowest correction low (${last.rangeLow})`);
  assert(last.breakoutAttempt === null && last.failedBreakouts >= 3, `attempts all failed (${last.failedBreakouts})`);
}

// 6. Real NIFTY 26 Jul – 1 Aug 2024, when cached: after the 29 Jul HH, no trend until August.
if (nifty.length < 300) {
  console.log('\nNIFTY Jul–Aug 2024 not cached — load NIFTY 50 5m 15 Jul – 1 Aug 2024 once in the app to enable');
} else {
  const states = getStructureTimeline(nifty, defaultAutoBacktestConfig);
  const day = (iso: string) => nifty.findIndex(c => c.timestamp >= toTs(iso));
  const from = day('2024-07-29T03:45:00Z');
  const to = day('2024-08-01T03:45:00Z');
  let hh = from;
  for (let i = from; i < to; i++) if (nifty[i].high > nifty[hh].high) hh = i;
  const bos = states.findIndex((s, i) => i > hh && s.broad === 'range');
  console.log(`\nNIFTY: 29 Jul HH at bar ${hh}, first range bar ${bos}`);
  assert(bos > hh && states.slice(bos, to).every(s => s.broad === 'range'), 'NIFTY: range from the BOS to 1 Aug — no Down/Up flips');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
