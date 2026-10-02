// Acceptance tests for the custom exit hook (utils/exitHook/* + src/strategies/exits).
// Synthetic candles — no DB needed. Mirrors entryHookSmoke.ts, which covers the entry half.
//
//   npm run backtest:exithook   (tsx scripts/exitHookSmoke.ts)
import {
  defaultAutoBacktestConfig,
  evaluateAutoExitSignal,
  resolveExitHook,
  type AutoBacktestConfig,
  type RegimeRules,
} from '../src/utils/autoBacktestEngine';
import { runBatchSimulation } from '../src/utils/batchBacktestSimulator';
import { registerExitHook, getExitHook, EXIT_HOOKS } from '../src/strategies/exits';
import {
  DEFAULT_EXIT_HOOK_LOOKBACK,
  EXIT_HOOK_LOOKBACK_MAX,
  EXIT_HOOK_LOOKBACK_MIN,
  createExitHookRunState,
  resolveExitHookLookback,
  type ExitHookContext,
} from '../src/utils/exitHook';
import type { Candle, Trade } from '../src/types';

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.error(`  ✗ FAIL: ${msg}`); }
}

// ─── Fixture ──────────────────────────────────────────────────────────────────

// A drifting sine wave: enough alternation to produce H/L signals, completed legs and
// pivots, over enough bars that the default 400-candle window is exercised both while it is
// still clipped by the session start and once it is fully populated.
function wave(n: number, start: number, drift: number, amp = 6, period = 12): Candle[] {
  const base = Date.UTC(2026, 0, 5, 3, 45, 0) / 1000; // 09:15 IST
  const path = (i: number) => start + drift * i + amp * Math.sin((2 * Math.PI * i) / period);
  const c: Candle[] = [];
  for (let i = 0; i < n; i++) {
    const open = i === 0 ? path(0) : c[i - 1].close;
    const close = path(i);
    c.push({
      timestamp: base + i * 60, open, close,
      high: Math.max(open, close) + 0.5, low: Math.min(open, close) - 0.5, volume: 1000,
    });
  }
  return c;
}

const CANDLES = wave(900, 20000, 0.35);

function baseRules(over: Partial<RegimeRules> = {}): RegimeRules {
  return {
    ...defaultAutoBacktestConfig.uptrend,
    enabled: true,
    direction: 'BOTH',
    entryMode: 'H_SIGNAL',
    allowH1: true, allowH2: true, allowL1: true, allowL2: true,
    // Strip every entry-quality filter: this suite is about what happens AFTER a trade
    // opens, so the entry side only has to reliably produce trades to manage.
    maFilter: 'none',
    ltPivotSequence: 'any',
    htStructureFilter: 'any',
    ltStructureFilter: 'any',
    atrDepthFilter: 'none',
    efficiencyRatioFilter: 'none',
    barOverlapFilter: 'none',
    barRangeFilter: 'none',
    barBreakFilter: 'none',
    consecutiveBreakFilter: 'none',
    ema21SlopeFilter: 'none',
    ema50SlopeFilter: 'none',
    ema20GapBarFilter: 'none',
    ema20BiasFilter: 'none',
    highSeqFilter: 'none',
    lowSeqFilter: 'none',
    pivotGapFilter: 'none',
    slMethod: 'fixed',
    slFixedPoints: 40,
    targetRR: 3,
    ...over,
  };
}

function cfg(over: Partial<RegimeRules> = {}, global: Partial<AutoBacktestConfig> = {}): AutoBacktestConfig {
  const rules = baseRules(over);
  return {
    ...defaultAutoBacktestConfig,
    enabled: true,
    useAutoQty: false,
    tradeStartTime: '00:00',
    tradeEndTime: '23:59',
    autoSquareOff: false,
    uptrend: rules,
    downtrend: { ...rules, enabled: false },
    range: { ...rules, enabled: false },
    reversal: { ...rules, enabled: false },
    ...global,
  };
}

const run = (c: AutoBacktestConfig) => runBatchSimulation(CANDLES, c, 60, 'TEST', 10, '5');
const exitsOf = (trades: Trade[]) => trades.filter(t => t.pnl !== undefined);
const fingerprint = (trades: Trade[]) =>
  trades.map(t => `${t.timestamp}|${t.type}|${t.price}|${t.exitReason ?? ''}`).join('\n');

/** A single-position snapshot for the direct evaluateAutoExitSignal calls below. */
const longAt = (entryBarIndex: number) => ({
  quantity: 1,
  averagePrice: CANDLES[entryBarIndex].close,
  stopLoss: CANDLES[entryBarIndex].close - 40,
  target: CANDLES[entryBarIndex].close + 120,
  entryBarIndex,
  entryRegime: 'uptrend' as const,
});

// ─── 1. Identity: mode 'off' changes nothing ──────────────────────────────────

console.log('\n[1] mode off is the identity state');
const BASELINE = run(cfg());
assert(exitsOf(BASELINE.trades).length > 0, `baseline produced exits (${exitsOf(BASELINE.trades).length})`);

registerExitHook('xsmoke-true', { label: 'always exit', hook: () => true });
const offRun = run(cfg({ exitHookMode: 'off', exitHookId: 'xsmoke-true' }));
assert(fingerprint(offRun.trades) === fingerprint(BASELINE.trades),
  'mode off with a hook selected is byte-identical to baseline');

const noIdRun = run(cfg({ exitHookMode: 'replace' }));
assert(fingerprint(noIdRun.trades) === fingerprint(BASELINE.trades),
  'a mode with no hook id chosen is also the identity state');

assert(BASELINE.exitHookDiagnostics === undefined, 'no exit-hook diagnostics reported when no hook ran');
assert(resolveExitHook(baseRules({ exitHookMode: 'off', exitHookId: 'xsmoke-true' })) === null,
  'resolveExitHook: off is null');
assert(resolveExitHook(baseRules({ exitHookMode: 'replace' })) === null,
  'resolveExitHook: a mode with no id is null');
assert(resolveExitHook(baseRules({ exitHookMode: 'gate', exitHookId: 'nope' }))?.hook === null,
  'resolveExitHook: an unknown id resolves with hook null, not undefined');

// ─── 2. A hook that always exits closes every trade on its entry bar's next check ──

console.log('\n[2] replace mode drives the exits');
const alwaysRun = run(cfg({ exitHookMode: 'replace', exitHookId: 'xsmoke-true' }));
const alwaysExits = exitsOf(alwaysRun.trades);
assert(alwaysExits.length > 0, `hook-driven exits produced (${alwaysExits.length})`);
assert(alwaysExits.every(t => t.exitReason === 'EXIT_HOOK'),
  'every exit carries reason EXIT_HOOK');
assert(alwaysRun.exitHookDiagnostics !== undefined && alwaysRun.exitHookDiagnostics.callCount > 0,
  `diagnostics reported (${alwaysRun.exitHookDiagnostics?.callCount} calls)`);
assert((alwaysRun.exitHookDiagnostics?.errorCount ?? -1) === 0
  && (alwaysRun.exitHookDiagnostics?.rejectedCount ?? -1) === 0,
  'a clean hook reports no errors and no rejections');

// ─── 3. The context contract ──────────────────────────────────────────────────

console.log('\n[3] context contract');
{
  const seen: ExitHookContext[] = [];
  registerExitHook('xsmoke-capture', {
    label: 'capture',
    hook: ctx => { seen.push(ctx); return false; },
  });
  run(cfg({ exitHookMode: 'replace', exitHookId: 'xsmoke-capture' }));
  assert(seen.length > 0, `hook was called (${seen.length}×)`);

  const ctx = seen[seen.length - 1];
  assert(ctx.candles.length === Math.min(DEFAULT_EXIT_HOOK_LOOKBACK, ctx.absoluteIndex + 1),
    `window length is min(lookback, absoluteIndex+1) (${ctx.candles.length})`);
  assert(ctx.index === ctx.candles.length - 1, 'index points at the last window bar');
  assert(ctx.candles[ctx.index].timestamp === ctx.candle.timestamp, 'the last window bar IS the current bar');
  assert(ctx.candles[ctx.index].timestamp === CANDLES[ctx.absoluteIndex].timestamp,
    'the window ends at absoluteIndex in the full array');
  assert(ctx.candles[0].timestamp <= ctx.candles[ctx.index].timestamp, 'the window is oldest-first');
  assert(ctx.signals.length === ctx.candles.length, 'signals are index-aligned with the window');
  assert(ctx.fullCandles.length === CANDLES.length, 'fullCandles is the unsliced array');

  // Causality — nothing reachable describes a bar after absoluteIndex.
  assert(ctx.pivots.every(p => p.barIndex <= ctx.absoluteIndex), 'no pivot past the current bar');
  assert(ctx.legs().every(l => l.endIndex <= ctx.absoluteIndex), 'no leg segment past the current bar');
  assert(ctx.legWindow === null || ctx.legWindow.endIndex <= ctx.absoluteIndex,
    'legWindow does not reach past the current bar');

  // The position view.
  assert(ctx.position.quantity > 0 && Math.sign(ctx.position.signedQuantity) === (ctx.position.side === 'long' ? 1 : -1),
    'quantity is absolute and signedQuantity carries the direction');
  assert(ctx.position.barsInTrade !== null && ctx.position.entryBarIndex !== null
    && ctx.position.barsInTrade === ctx.absoluteIndex - ctx.position.entryBarIndex,
    'barsInTrade is currentIndex − entryBarIndex');
  const expectedOpen = ctx.position.side === 'long'
    ? ctx.candle.close - ctx.position.entryPrice
    : ctx.position.entryPrice - ctx.candle.close;
  assert(Math.abs(ctx.position.openPoints - expectedOpen) < 1e-9,
    'openPoints is signed by side, not by raw price difference');
  assert(ctx.position.mfePoints !== null && ctx.position.maePoints !== null
    && ctx.position.mfePoints >= -1e-9 === true,
    'MFE/MAE are populated when entryBarIndex is known');
}

// ─── 4. Lookback is a Session Setting, and clamped ────────────────────────────

console.log('\n[4] exitHookLookback');
{
  assert(resolveExitHookLookback({}) === DEFAULT_EXIT_HOOK_LOOKBACK, 'defaults when unset');
  assert(resolveExitHookLookback({ exitHookLookback: 1 }) === EXIT_HOOK_LOOKBACK_MIN, 'clamps below the min');
  assert(resolveExitHookLookback({ exitHookLookback: 999999 }) === EXIT_HOOK_LOOKBACK_MAX, 'clamps above the max');
  assert(resolveExitHookLookback({ exitHookLookback: Number.NaN }) === DEFAULT_EXIT_HOOK_LOOKBACK, 'NaN falls back to the default');

  let width = -1;
  registerExitHook('xsmoke-width', {
    label: 'width',
    hook: ctx => { width = ctx.candles.length; return false; },
  });
  run(cfg({ exitHookMode: 'replace', exitHookId: 'xsmoke-width' }, { exitHookLookback: 120 }));
  assert(width === 120, `a non-default exitHookLookback is honoured (${width})`);
}

// ─── 5. ctx.state persists within a run and resets between runs ───────────────

console.log('\n[5] ctx.state');
{
  let maxSeen = 0;
  registerExitHook('xsmoke-state', {
    label: 'state',
    hook: ctx => {
      const st = ctx.state as { n?: number };
      st.n = (st.n ?? 0) + 1;
      maxSeen = Math.max(maxSeen, st.n);
      return false;
    },
  });
  const c = cfg({ exitHookMode: 'replace', exitHookId: 'xsmoke-state' });
  run(c);
  const firstMax = maxSeen;
  assert(firstMax > 1, `state accumulated across bars within one run (${firstMax})`);
  maxSeen = 0;
  run(c);
  assert(maxSeen === firstMax, 'a second run starts from a fresh state and reaches the same count');
}

// ─── 6. Stop/target adjustments ───────────────────────────────────────────────

console.log('\n[6] adjustments');
{
  const i = 300;
  const close = CANDLES[i].close;

  registerExitHook('xsmoke-sl-ok', { label: 'sl ok', hook: () => ({ exit: false, sl: close - 10 }) });
  const ok = evaluateAutoExitSignal(CANDLES, i, longAt(200), cfg({ exitHookMode: 'replace', exitHookId: 'xsmoke-sl-ok' }));
  assert(ok.exit === null && ok.adjust?.stopLoss === close - 10, 'a valid long stop below the close is applied');

  // Fail-closed: a stop already through price would fire next bar for a loss that never
  // happened, so it is dropped rather than clamped — and the trade is NOT exited.
  registerExitHook('xsmoke-sl-bad', { label: 'sl bad', hook: () => ({ exit: false, sl: close + 10 }) });
  const badState = createExitHookRunState();
  const bad = evaluateAutoExitSignal(CANDLES, i, longAt(200), cfg({ exitHookMode: 'replace', exitHookId: 'xsmoke-sl-bad' }), badState);
  assert(bad.adjust === null, 'a long stop above the close is refused');
  assert(bad.exit === null, '…and refusing it does not exit the trade');
  assert(badState.rejectedCount === 1 && (badState.rejectReason ?? '').includes('wrong side'),
    '…and the rejection says why');

  registerExitHook('xsmoke-tp-bad', { label: 'tp bad', hook: () => ({ exit: false, target: close - 10 }) });
  const badTp = evaluateAutoExitSignal(CANDLES, i, longAt(200), cfg({ exitHookMode: 'replace', exitHookId: 'xsmoke-tp-bad' }));
  assert(badTp.adjust === null, 'a long target below the close is refused');

  // A good adjustment survives an exit that does not validate.
  registerExitHook('xsmoke-mixed', {
    label: 'mixed',
    hook: ctx => ({ price: ctx.candle.high + 500, sl: close - 10 }),
  });
  const mixed = evaluateAutoExitSignal(CANDLES, i, longAt(200), cfg({ exitHookMode: 'replace', exitHookId: 'xsmoke-mixed' }));
  assert(mixed.exit === null && mixed.adjust?.stopLoss === close - 10,
    'an invalid fill price is refused while a valid stop move still applies');

  // A hook-named price inside the bar is honoured and reaches the booked trade.
  registerExitHook('xsmoke-price', { label: 'price', hook: ctx => ({ price: ctx.candle.low }) });
  const priced = run(cfg({ exitHookMode: 'replace', exitHookId: 'xsmoke-price' }));
  const first = exitsOf(priced.trades)[0];
  assert(first !== undefined && first.exitReason === 'EXIT_HOOK', 'a priced exit books as EXIT_HOOK');
}

// ─── 7. Trail through the batch loop ──────────────────────────────────────────

console.log('\n[7] a trailing hook reaches the booked trades');
{
  // Ratcheting stop just under the close: with no built-in trail on, any trade marked
  // slTrailed can only have been moved by the hook. 5 points is deliberately inside the
  // fixture's ±6 oscillation, so the trail is actually reached rather than riding to TP.
  registerExitHook('xsmoke-trail', {
    label: 'trail',
    hook: ctx => {
      const want = ctx.candle.close - 5;
      if (ctx.position.side !== 'long') return false;
      if (ctx.position.stopLoss !== null && want <= ctx.position.stopLoss) return false;
      return { exit: false, sl: want };
    },
  });
  const trailed = run(cfg({ exitHookMode: 'replace', exitHookId: 'xsmoke-trail', exitTrailPivot: false }));
  const moved = trailed.trades.filter(t => t.slTrailed);
  assert(moved.length > 0, `the hook's stop moves reached booked trades (${moved.length} trailed)`);
  assert(moved.some(t => t.exitReason === 'SL'),
    'a hook-moved stop exits through the normal SL machinery, not as EXIT_HOOK');
}

// ─── 8. The shipped registry ──────────────────────────────────────────────────

console.log('\n[8] shipped hooks');
{
  for (const id of ['leg-decay', 'breakeven-trail', 'time-stop', 'hold-winners']) {
    assert(getExitHook(id) !== undefined, `'${id}' is registered`);
  }
  assert(Object.keys(EXIT_HOOKS).length >= 4, 'the registry ships at least the four documented hooks');

  // The ported leg-decay, checked directly rather than through a batch run.
  //
  // It can only fire when a NEW with-trend leg completes after entry and grades badly, and a
  // synthetic sine wave never produces one: every completed leg is a monotone run, so its
  // Kaufman ER is exactly 1.0 forever. (The old built-in mechanism had the same property —
  // exitEngineSmoke used to set an unsatisfiable ER threshold of 1.5 to exercise it at all.)
  // A SHORT in this uptrend is the case that does decay honestly: the direction-aligned
  // EMA21 slope reads negative against it, which is exactly what the check is for.
  {
    // Its own fixture: CANDLES is a steady 0.35/bar climb whose pullbacks never complete a
    // bear leg at all, so there is nothing on the short side to grade there. A steeper climb
    // that then goes flat does produce one.
    const climb = wave(200, 20000, 0.6);
    const tail = climb[climb.length - 1];
    const flat = wave(200, tail.close, 0).map((c, j) => ({ ...c, timestamp: tail.timestamp + (j + 1) * 60 }));
    const decayCandles = [...climb, ...flat];

    const entryBarIndex = 195;
    const short = {
      quantity: -1,
      averagePrice: decayCandles[entryBarIndex].close,
      entryBarIndex,
      entryRegime: 'uptrend' as const,
    };
    const legCfg = cfg({ exitHookMode: 'replace', exitHookId: 'leg-decay' });
    let decayAt = -1;
    let detail = '';
    for (let i = entryBarIndex + 1; i < decayCandles.length && decayAt < 0; i++) {
      const r = evaluateAutoExitSignal(decayCandles, i, short, legCfg);
      if (r.exit) { decayAt = i; detail = r.exit.detail; }
    }
    assert(decayAt > 0, `'leg-decay' exits a short whose leg turns against it (bar ${decayAt}: ${detail})`);
    assert(decayAt - entryBarIndex >= 3, '…never before its 3-bar minimum time in trade');
    assert(detail.startsWith('leg decay:'), '…and its own reason text reaches the detail');

    // The entry leg itself is never re-graded — that guard is what stops a trade exiting on
    // the bar it opened.
    const immediate = evaluateAutoExitSignal(decayCandles, entryBarIndex + 1, short, legCfg);
    assert(immediate.exit === null, '…and it never exits on the bar after entry');
  }

  // Every shipped hook must at least be reachable and run clean over a full backtest —
  // whether the fixture happens to satisfy its thresholds is a separate question.
  for (const id of ['leg-decay', 'breakeven-trail', 'time-stop', 'hold-winners']) {
    const r = run(cfg({ exitHookMode: 'replace', exitHookId: id }));
    const d = r.exitHookDiagnostics;
    assert(d !== undefined && d.callCount > 0 && d.errorCount === 0 && d.rejectedCount === 0,
      `'${id}' ran clean over a full backtest (${d?.callCount} calls)`);
    assert(exitsOf(r.trades).every(t => t.exitReason !== 'EXIT_HOOK' || t.pnl !== undefined),
      `'${id}' booked well-formed exits`);
  }

  // breakeven-trail arms at +1R, so it only moves a stop when 1R is actually reachable —
  // with a 40-point stop on this fixture's 0.35/bar drift it never is. A 10-point stop makes
  // the same hook's breakeven arm, which is the behaviour worth asserting.
  const beRun = run(cfg({ exitHookMode: 'replace', exitHookId: 'breakeven-trail', slFixedPoints: 10 }));
  assert(beRun.exitHookDiagnostics?.errorCount === 0, "'breakeven-trail' ran without throwing");
  assert(beRun.trades.some(t => t.slTrailed), "'breakeven-trail' armed breakeven and moved stops");

  const timeRun = run(cfg({ exitHookMode: 'replace', exitHookId: 'time-stop' }));
  assert(exitsOf(timeRun.trades).some(t => t.exitReason === 'EXIT_HOOK'), "'time-stop' produced exits");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
