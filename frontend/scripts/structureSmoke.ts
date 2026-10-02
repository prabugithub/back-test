// Integration smoke for the pivot market-structure classifier against cached candles
// (backend/data/backtesting.db): Market-step gate, regime source = pivot, leg-pattern
// structure clause, and hook ctx.structure().
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
import { getStructureAt, structureToLtMarket, BROAD_CODE } from '../src/utils/marketStructure';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(path.resolve(__dirname, '../../backend/data/backtesting.db'), { readonly: true });
const spec = db.prepare(`SELECT security_id s, exchange_segment e, interval i, COUNT(*) n FROM candles
  GROUP BY 1,2,3 ORDER BY n DESC LIMIT 1`).get() as { s: string; e: string; i: string };
const candles = db.prepare(`SELECT timestamp, open, high, low, close, volume FROM candles
  WHERE security_id=? AND exchange_segment=? AND interval=? ORDER BY timestamp ASC`)
  .all(spec.s, spec.e, spec.i) as Candle[];
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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
