// Scenario smoke tests for the auto-BT price-action exit engine
// (autoBacktestEngine.ts evaluateTrailStop / evaluateAutoExitSignal + the batch
// simulator wiring). Synthetic candle waves, no DB needed.
//
//   npm run backtest:exit-smoke   (tsx scripts/exitEngineSmoke.ts)
import {
  defaultAutoBacktestConfig,
  evaluateTrailStop,
  evaluateAutoExitSignal,
  countActiveExitMechanisms,
  type AutoBacktestConfig,
  type RegimeRules,
} from '../src/utils/autoBacktestEngine';
import { createExitHookRunState } from '../src/utils/exitHook';
import { registerExitHook } from '../src/strategies/exits';
import { runBatchSimulation } from '../src/utils/batchBacktestSimulator';
import { calculatePivotPoints, calculateAlBrooks } from '../src/utils/indicators';
import { analyzeMarketStructure } from '../src/utils/pivotAnalysis';
import type { Candle } from '../src/types';

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.error(`  ✗ FAIL: ${msg}`); }
}

// Sine-wave-with-drift price path → trending candles with periodic pullbacks
// (pullbacks are what create pivots, Brooks H/L signals, and completed legs).
// Timestamps start 09:15 IST at 1-minute steps so batch entries stay inside the
// default trading window.
function wave(n: number, start: number, drift: number, amp = 6, period = 12): Candle[] {
  const base = Date.UTC(2026, 0, 5, 3, 45, 0) / 1000; // 09:15 IST
  const path = (i: number) => start + drift * i + amp * Math.sin((2 * Math.PI * i) / period);
  const candles: Candle[] = [];
  for (let i = 0; i < n; i++) {
    const open = i === 0 ? path(0) : candles[i - 1].close;
    const close = path(i);
    candles.push({
      timestamp: base + i * 60,
      open,
      close,
      high: Math.max(open, close) + 0.5,
      low: Math.min(open, close) - 0.5,
      volume: 1000,
    });
  }
  return candles;
}

const clean = (over: Partial<RegimeRules>): RegimeRules => ({
  ...defaultAutoBacktestConfig.uptrend,
  enabled: true,
  entryMode: 'PIVOT',
  maFilter: 'none',
  htStructureFilter: 'any',
  barOverlapFilter: 'none',
  barRangeFilter: 'none',
  ema21SlopeFilter: 'none',
  ema50SlopeFilter: 'none',
  slMethod: 'fixed',
  slFixedPoints: 999,
  targetRR: 50,
  ...over,
});

const cfg = (uptrend: Partial<RegimeRules>): AutoBacktestConfig => ({
  ...defaultAutoBacktestConfig,
  enabled: true,
  autoSquareOff: false,
  useAutoQty: false,
  uptrend: clean(uptrend),
  downtrend: { ...defaultAutoBacktestConfig.downtrend, enabled: false },
  range: { ...defaultAutoBacktestConfig.range, enabled: false },
  reversal: { ...defaultAutoBacktestConfig.reversal, enabled: false },
});

// ─── 1. Pivot trailing stop ───────────────────────────────────────────────────
{
  console.log('\n[1] evaluateTrailStop — ratchet behind latest confirmed bullish pivot');
  const candles = wave(120, 100, 0.5);
  const config = cfg({ exitTrailPivot: true, exitTrailPivotBufferPoints: 2 });
  const i = 100;

  // Expected candidate, replicated independently: latest bullish pivot among
  // pivots confirmed through bar i-1, 3-bar cluster min low, minus buffer.
  const pivots = calculatePivotPoints(candles.slice(0, i)).filter(p => p.type === 'bullish');
  assert(pivots.length > 0, 'synthetic uptrend produced bullish pivots');
  const b = pivots[pivots.length - 1].barIndex;
  const expected = Math.min(candles[b].low, candles[b - 1].low, candles[b - 2].low) - 2;

  const trail = evaluateTrailStop(candles, i, { quantity: 1, stopLoss: expected - 50, entryRegime: 'uptrend' }, config);
  assert(trail !== null && Math.abs(trail.newStopLoss - expected) < 1e-9,
    `trails to pivot swing low − buffer (${expected.toFixed(2)})`);
  assert(b < i, 'pivot used was confirmed before the current bar (no lookahead)');
  assert(evaluateTrailStop(candles, i, { quantity: 1, stopLoss: expected, entryRegime: 'uptrend' }, config) === null,
    'never re-issues the same level (ratchet only)');
  assert(evaluateTrailStop(candles, i, { quantity: 1, stopLoss: expected + 5, entryRegime: 'uptrend' }, config) === null,
    'never loosens an already-tighter stop');
  const offCfg = cfg({});
  assert(evaluateTrailStop(candles, i, { quantity: 1, stopLoss: expected - 50, entryRegime: 'uptrend' }, offCfg) === null,
    'inert when exitTrailPivot is off');
}

// ─── 2. Reversal exit ─────────────────────────────────────────────────────────
{
  console.log('\n[2] evaluateAutoExitSignal — REVERSAL on structure against the position');
  const candles = wave(120, 200, -0.8);
  const i = 100;
  const visible = candles.slice(0, i + 1);
  const { ltMarket } = analyzeMarketStructure(visible, calculatePivotPoints(visible));
  assert(ltMarket.startsWith('Bear'), `synthetic downtrend reads Bear-* (got ${ltMarket})`);

  const config = cfg({ exitOnReversal: true, exitReversalConfirmBars: 1, exitReversalRequireWithTrend: false });
  const long = { quantity: 1, entryBarIndex: 60, entryRegime: 'uptrend' as const };
  const r1 = evaluateAutoExitSignal(candles, i, long, config);
  assert(r1.exit?.reason === 'REVERSAL', 'long exits REVERSAL when LT reads against it');

  // confirm-bars: 2 → first check only counts, second (state fed back) fires
  const config2 = cfg({ exitOnReversal: true, exitReversalConfirmBars: 2, exitReversalRequireWithTrend: false });
  const s1 = evaluateAutoExitSignal(candles, i, long, config2);
  assert(s1.exit === null && s1.state.exitAgainstBars === 1, 'confirmBars=2: first against-bar only arms the counter');
  const s2 = evaluateAutoExitSignal(candles, i + 1, { ...long, ...s1.state }, config2);
  assert(s2.exit?.reason === 'REVERSAL', 'confirmBars=2: second consecutive against-bar exits');

  // requireWithTrend=true blocks a trade whose structure never read with it
  const config3 = cfg({ exitOnReversal: true, exitReversalConfirmBars: 1, exitReversalRequireWithTrend: true });
  const r3 = evaluateAutoExitSignal(candles, i, long, config3);
  assert(r3.exit === null, 'requireWithTrend blocks exit when structure was never with the trade');
  const r4 = evaluateAutoExitSignal(candles, i, { ...long, exitWithTrendSeen: true }, config3);
  assert(r4.exit?.reason === 'REVERSAL', '…and fires once exitWithTrendSeen is set');

  // A short in the same downtrend must NOT reversal-exit
  const short = { quantity: -1, entryBarIndex: 60, entryRegime: 'uptrend' as const };
  assert(evaluateAutoExitSignal(candles, i, short, config).exit === null, 'short in a downtrend does not exit');
}

// ─── 3. Opposite-signal exit ──────────────────────────────────────────────────
{
  console.log('\n[3] evaluateAutoExitSignal — OPP_SIGNAL on opposite Brooks marker');
  const candles = wave(160, 200, -0.6);
  const config = cfg({ exitOnOppSignal: true, exitOppAllow1: true, exitOppAllow2: true });
  let hit: string | null = null;
  let hitIndex = -1;
  for (let i = 55; i < 160 && !hit; i++) {
    const marker = calculateAlBrooks(candles.slice(0, i + 1)).find(m => m.time === candles[i].timestamp);
    if (marker && (marker.signal === 'L1' || marker.signal === 'L2')) { hit = marker.signal; hitIndex = i; }
  }
  assert(hit !== null, `synthetic downtrend produced an L1/L2 marker (${hit} @ ${hitIndex})`);
  if (hit) {
    const long = { quantity: 1, entryBarIndex: 50, entryRegime: 'uptrend' as const };
    const r = evaluateAutoExitSignal(candles, hitIndex, long, config);
    assert(r.exit?.reason === 'OPP_SIGNAL', `long exits OPP_SIGNAL on ${hit}`);
    const only2 = cfg({ exitOnOppSignal: true, exitOppAllow1: false, exitOppAllow2: true });
    const r2 = evaluateAutoExitSignal(candles, hitIndex, long, only2);
    assert(hit === 'L2' ? r2.exit?.reason === 'OPP_SIGNAL' : r2.exit === null,
      `1st-signal toggle respected (marker was ${hit})`);
    const short = { quantity: -1, entryBarIndex: 50, entryRegime: 'uptrend' as const };
    assert(evaluateAutoExitSignal(candles, hitIndex, short, config).exit === null,
      'short is not exited by an L signal (aligned, not opposite)');
  }
}

// ─── 4. Custom exit hook ──────────────────────────────────────────────────────
// Replaces the old built-in leg-decay scenario: that mechanism is gone, and its logic now
// ships as the 'leg-decay' hook, which this section exercises through the same registry the
// UI and the worker use. Dedicated coverage of the hook API itself lives in exitHookSmoke.ts.
{
  console.log('\n[4] evaluateAutoExitSignal — custom exit hook');
  const candles = wave(160, 100, 0.5);
  const entryBarIndex = 60;
  const pos = () => ({ quantity: 1, averagePrice: candles[entryBarIndex].close, entryBarIndex, entryRegime: 'uptrend' as const });

  // 'replace' mode with a hook that always holds → no exit ever, even with the built-in
  // mechanisms switched on, because replace skips them entirely.
  registerExitHook('smoke-hold', { label: 'hold', hook: () => false });
  const holdCfg = cfg({
    exitOnReversal: true, exitReversalRequireWithTrend: false,
    exitHookMode: 'replace', exitHookId: 'smoke-hold',
  });
  let anyExit = false;
  for (let i = 63; i < 160; i++) {
    if (evaluateAutoExitSignal(candles, i, pos(), holdCfg).exit) anyExit = true;
  }
  assert(!anyExit, "'replace' hook that holds suppresses the built-in exits too");

  // 'replace' mode with a hook that exits after N bars in the trade.
  registerExitHook('smoke-time', {
    label: 'time',
    hook: ctx => (ctx.position.barsInTrade ?? 0) >= 10 ? { reason: 'smoke time stop' } : false,
  });
  const timeCfg = cfg({ exitHookMode: 'replace', exitHookId: 'smoke-time' });
  let exitIndex = -1;
  for (let i = 63; i < 160 && exitIndex < 0; i++) {
    const r = evaluateAutoExitSignal(candles, i, pos(), timeCfg);
    if (r.exit) {
      assert(r.exit.reason === 'EXIT_HOOK', `exit reason is EXIT_HOOK (${r.exit.detail})`);
      assert(r.exit.detail.includes('smoke time stop'), 'the hook\'s own reason reaches the detail');
      exitIndex = i;
    }
  }
  assert(exitIndex === entryBarIndex + 10, `exited exactly at barsInTrade 10 (bar ${exitIndex})`);

  // An unregistered id runs NO signal exits rather than falling back to the built-ins.
  const brokenCfg = cfg({
    exitOnReversal: true, exitReversalRequireWithTrend: false,
    exitHookMode: 'replace', exitHookId: 'smoke-not-registered',
  });
  let brokenExit = false;
  for (let i = 63; i < 160; i++) {
    if (evaluateAutoExitSignal(candles, i, pos(), brokenCfg).exit) brokenExit = true;
  }
  assert(!brokenExit, 'an unregistered hook id takes no exits instead of falling back');

  // A stop move comes back on `adjust` without closing the trade.
  registerExitHook('smoke-trail', {
    label: 'trail',
    hook: ctx => ({ exit: false, sl: ctx.candle.close - 25 }),
  });
  const trailCfg = cfg({ exitHookMode: 'replace', exitHookId: 'smoke-trail' });
  const adj = evaluateAutoExitSignal(candles, 80, pos(), trailCfg);
  assert(adj.exit === null, 'exit:false holds the trade');
  assert(adj.adjust?.stopLoss === candles[80].close - 25, 'the stop move is returned on adjust');

  // 'gate' mode: a silent false lets a pending built-in exit stand; { exit: false } vetoes it.
  registerExitHook('smoke-silent', { label: 'silent', hook: () => false });
  registerExitHook('smoke-veto', { label: 'veto', hook: () => ({ exit: false }) });
  const gateBase = {
    exitOnReversal: true, exitReversalConfirmBars: 1, exitReversalRequireWithTrend: false,
  } as Partial<RegimeRules>;
  const shortPos = () => ({ quantity: -1, averagePrice: candles[entryBarIndex].close, entryBarIndex, entryRegime: 'uptrend' as const });
  let standIndex = -1;
  for (let i = 63; i < 160 && standIndex < 0; i++) {
    const r = evaluateAutoExitSignal(candles, i, shortPos(), cfg({ ...gateBase, exitHookMode: 'gate', exitHookId: 'smoke-silent' }));
    if (r.exit) {
      assert(r.exit.reason === 'REVERSAL', 'a silent false lets the pending REVERSAL stand');
      standIndex = i;
    }
  }
  assert(standIndex > 0, `the gate scenario produced a pending exit (bar ${standIndex})`);
  const vetoed = evaluateAutoExitSignal(candles, standIndex, shortPos(), cfg({ ...gateBase, exitHookMode: 'gate', exitHookId: 'smoke-veto' }));
  assert(vetoed.exit === null, '{ exit: false } vetoes the same pending exit');

  // A throwing hook is trapped: no exit, and the run continues.
  registerExitHook('smoke-throw', { label: 'throw', hook: () => { throw new Error('boom'); } });
  const throwState = createExitHookRunState();
  const threw = evaluateAutoExitSignal(candles, 80, pos(), cfg({ exitHookMode: 'replace', exitHookId: 'smoke-throw' }), throwState);
  assert(threw.exit === null, 'a throwing hook takes no exit');
  assert(throwState.errorCount === 1 && (throwState.error ?? '').includes('boom'), 'the exception is trapped and recorded');

  // Fail-closed: a fill price outside the bar is refused outright.
  registerExitHook('smoke-badprice', { label: 'bad price', hook: ctx => ({ price: ctx.candle.high + 100 }) });
  const badState = createExitHookRunState();
  const bad = evaluateAutoExitSignal(candles, 80, pos(), cfg({ exitHookMode: 'replace', exitHookId: 'smoke-badprice' }), badState);
  assert(bad.exit === null, 'a fill price outside the bar is refused');
  assert(badState.rejectedCount === 1, 'the rejection is counted');
}

// ─── 5. Batch simulator integration ──────────────────────────────────────────
{
  console.log('\n[5] runBatchSimulation — exit engine binds in the batch loop');
  // Uptrend then hard downtrend: longs entered on the way up must be closed by
  // the exit engine (trailed SL or REVERSAL) on the way down. Base price high
  // enough that a fixed 50-point SL stays positive (the engine rejects sl <= 0).
  const up = wave(150, 1000, 0.6);
  const downStart = up[up.length - 1].close;
  const down = wave(100, downStart, -0.9).map((c, j) => ({ ...c, timestamp: up[up.length - 1].timestamp + (j + 1) * 60 }));
  const candles = [...up, ...down];

  const offResult = runBatchSimulation(candles, cfg({ slFixedPoints: 50 }), 60, 'SMOKE', 1, '1');
  const newReasons = new Set(['REVERSAL', 'OPP_SIGNAL', 'EXIT_HOOK']);
  assert(offResult.trades.every(t => !newReasons.has(t.exitReason ?? '') && !t.slTrailed),
    `exits off → no engine exit reasons, no trailed SLs (${offResult.trades.length} trades)`);

  const onResult = runBatchSimulation(candles, cfg({
    slFixedPoints: 50,
    exitTrailPivot: true,
    exitOnReversal: true, exitReversalConfirmBars: 1, exitReversalRequireWithTrend: false,
  }), 60, 'SMOKE', 1, '1');
  const engineExits = onResult.trades.filter(t => newReasons.has(t.exitReason ?? '') || t.slTrailed);
  assert(onResult.trades.length > 0, `exits on → simulation still trades (${onResult.trades.length} trades)`);
  assert(engineExits.length > 0,
    `exit engine closed trades (${engineExits.map(t => `${t.exitReason}${t.slTrailed ? '+trailed' : ''}`).join(', ') || 'none'})`);
}

// ─── 6. Helpers ───────────────────────────────────────────────────────────────
{
  console.log('\n[6] helpers');
  assert(countActiveExitMechanisms(clean({})) === 0, 'countActiveExitMechanisms: 0 when all off');
  assert(countActiveExitMechanisms(clean({ exitOnReversal: true, exitTrailPivot: true })) === 2, '…counts toggled mechanisms');
  assert(countActiveExitMechanisms(clean({ exitHookMode: 'replace', exitHookId: 'leg-decay' })) === 1,
    '…counts a configured exit hook as a mechanism');
  assert(countActiveExitMechanisms(clean({ exitHookMode: 'replace' })) === 0,
    '…a mode with no hook id is identity, not a mechanism');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
