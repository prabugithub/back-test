// Acceptance tests for the custom entry hook (utils/entryHook/* + src/strategies).
// Synthetic candles — no DB needed. Follows the legPatternSmoke.ts pattern.
//
//   npm run backtest:entryhook   (tsx scripts/entryHookSmoke.ts)
import {
  defaultAutoBacktestConfig,
  type AutoBacktestConfig,
  type RegimeRules,
} from '../src/utils/autoBacktestEngine';
import { runBatchSimulation } from '../src/utils/batchBacktestSimulator';
import { registerEntryHook } from '../src/strategies';
import {
  DEFAULT_ENTRY_HOOK_LOOKBACK,
  resolveHookLookback,
  type EntryHook,
  type EntryHookContext,
} from '../src/utils/entryHook';
import { getAlBrooksRunUpTo } from '../src/utils/indicators';
import type { Candle, Trade } from '../src/types';

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.error(`  ✗ FAIL: ${msg}`); }
}

// ─── Fixture ──────────────────────────────────────────────────────────────────

// A drifting sine wave: enough alternation to produce plenty of H/L signals at a range of
// counts, over enough bars that the 1200-candle default window is exercised both while it
// is still clipped by the session start and once it is fully populated.
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

const CANDLES = wave(1600, 20000, 0.35);

// Every H/L label the state machine produced over the fixture, for sanity.
const ALL_SIGNALS = getAlBrooksRunUpTo(CANDLES, CANDLES.length - 1).signalsByBar;

function baseRules(over: Partial<RegimeRules> = {}): RegimeRules {
  return {
    ...defaultAutoBacktestConfig.uptrend,
    enabled: true,
    direction: 'BOTH',
    entryMode: 'H_SIGNAL',
    allowH1: true, allowH2: true, allowL1: true, allowL2: true,
    // Strip every quality filter so the baseline is the raw trigger set — the hook's effect
    // is then the only thing that can move the trade count.
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
    slFixedPoints: 25,
    targetRR: 2,
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

/** Entry fills only — exits are derived, so comparing them adds nothing. */
const entries = (trades: Trade[]) => trades.filter(t => t.pnl === undefined);
const fingerprint = (trades: Trade[]) =>
  entries(trades).map(t => `${t.timestamp}|${t.type}|${t.price}|${t.quantity}|${t.stopLoss}|${t.target}`).join('\n');

// ─── 1. Identity: mode 'off' changes nothing ──────────────────────────────────

console.log('\n[1] mode off is the identity state');
const BASELINE = run(cfg());
assert(entries(BASELINE.trades).length > 0, `baseline produced entries (${entries(BASELINE.trades).length})`);

registerEntryHook('smoke-true', { label: 'always true', hook: () => true });
const offRun = run(cfg({ entryHookMode: 'off', entryHookId: 'smoke-true' }));
assert(fingerprint(offRun.trades) === fingerprint(BASELINE.trades),
  'mode off with a hook selected is byte-identical to baseline');

const noIdRun = run(cfg({ entryHookMode: 'replace' }));
assert(fingerprint(noIdRun.trades) === fingerprint(BASELINE.trades),
  'a mode with no hook id chosen is also the identity state');

assert(BASELINE.hookDiagnostics === undefined, 'no hook diagnostics reported when no hook ran');

// ─── 2. Gate mode ─────────────────────────────────────────────────────────────

console.log('\n[2] gate mode');
registerEntryHook('smoke-false', { label: 'always false', hook: () => false });
const gateFalse = run(cfg({ entryHookMode: 'gate', entryHookId: 'smoke-false' }));
assert(entries(gateFalse.trades).length === 0, 'gate + always-false takes no trades');

// Re-narrowing the trigger set to H1/H2 must reproduce the built-in chain exactly: the ONLY
// behavioural difference a gating hook introduces (given it approves everything) is that it
// widens the allowed counts.
registerEntryHook('smoke-narrow', {
  label: 'count <= 2',
  hook: ctx => ctx.trigger.count <= 2,
});
const gateNarrow = run(cfg({ entryHookMode: 'gate', entryHookId: 'smoke-narrow' }));
assert(fingerprint(gateNarrow.trades) === fingerprint(BASELINE.trades),
  'gate re-narrowed to count <= 2 reproduces baseline exactly');

const gateTrue = run(cfg({ entryHookMode: 'gate', entryHookId: 'smoke-true' }));
assert(entries(gateTrue.trades).length >= entries(BASELINE.trades).length,
  `gate + always-true never loses triggers (${entries(gateTrue.trades).length} >= ${entries(BASELINE.trades).length})`);

// ─── 3. Replace mode reaches H3+/L3+ ──────────────────────────────────────────

console.log('\n[3] replace mode reaches counts the built-in chain cannot');
const seenLabels: string[] = [];
registerEntryHook('smoke-record', {
  label: 'record labels',
  hook: ctx => { seenLabels.push(ctx.trigger.label); return true; },
});
const replaceRun = run(cfg({ entryHookMode: 'replace', entryHookId: 'smoke-record' }));
const maxCount = Math.max(...seenLabels.map(l => Number(l.slice(1))));
assert(seenLabels.length > 0, `hook was called (${seenLabels.length} trigger bars)`);
assert(maxCount > 2, `H/L counts above 2 reached the hook (max seen: ${maxCount})`);
assert(seenLabels.every(l => l[0] === 'H' || l[0] === 'L'), 'every label is an H or L signal');
assert(seenLabels.every(l => ALL_SIGNALS.includes(l)),
  'every label the hook saw was really produced by the state machine');
assert(entries(replaceRun.trades).length > 0, `replace mode produced entries (${entries(replaceRun.trades).length})`);

// ─── 4. Window contract ───────────────────────────────────────────────────────

console.log('\n[4] the rolling candle window');
interface Probe { abs: number; len: number; lastTs: number; firstTs: number; idx: number; sigLen: number }
let probes: Probe[] = [];
const probeHook: EntryHook = ctx => {
  probes.push({
    abs: ctx.absoluteIndex,
    len: ctx.candles.length,
    lastTs: ctx.candles[ctx.candles.length - 1].timestamp,
    firstTs: ctx.candles[0].timestamp,
    idx: ctx.index,
    sigLen: ctx.signals.length,
  });
  return false;
};
registerEntryHook('smoke-probe', { label: 'probe', hook: probeHook });

probes = [];
run(cfg({ entryHookMode: 'replace', entryHookId: 'smoke-probe' }));
const lookback = DEFAULT_ENTRY_HOOK_LOOKBACK;
assert(probes.length > 0, `probe ran (${probes.length} bars)`);
assert(probes.every(p => p.len === Math.min(lookback, p.abs + 1)),
  'window length is min(entryHookLookback, absoluteIndex + 1)');
assert(probes.every(p => p.idx === p.len - 1), 'ctx.index is always the last element');
assert(probes.every(p => p.lastTs === CANDLES[p.abs].timestamp),
  'the window ends exactly at the trigger bar');
assert(probes.every(p => p.firstTs === CANDLES[Math.max(0, p.abs - lookback + 1)].timestamp),
  'the window is oldest-first and starts lookback bars back');
assert(probes.every(p => p.sigLen === p.len), 'ctx.signals is index-aligned with ctx.candles');
assert(probes.some(p => p.len < lookback), 'early bars get a correctly clipped (shorter) window');

// A non-default lookback must actually change the window.
probes = [];
const SMALL = 120;
run(cfg({ entryHookMode: 'replace', entryHookId: 'smoke-probe' }, { entryHookLookback: SMALL }));
assert(probes.every(p => p.len === Math.min(SMALL, p.abs + 1)),
  `entryHookLookback=${SMALL} is honoured (Session Settings drives the window, not a literal)`);

assert(resolveHookLookback({ entryHookLookback: 5 }) === 50, 'lookback clamps up to the floor');
assert(resolveHookLookback({ entryHookLookback: 99999 }) === 5000, 'lookback clamps down to the cap');
assert(resolveHookLookback({ entryHookLookback: undefined }) === DEFAULT_ENTRY_HOOK_LOOKBACK,
  'lookback defaults to 1200');

// ─── 5. No lookahead ──────────────────────────────────────────────────────────

console.log('\n[5] causality — nothing on ctx describes a future bar');
const violations: string[] = [];
registerEntryHook('smoke-causal', {
  label: 'causality probe',
  hook: (ctx: EntryHookContext) => {
    const t = ctx.candle.timestamp;
    if (ctx.candles.some(c => c.timestamp > t)) violations.push(`candles @${ctx.absoluteIndex}`);
    if (ctx.pivots.some(p => p.time > t)) violations.push(`pivots @${ctx.absoluteIndex}`);
    if (ctx.legWindow && ctx.legWindow.endIndex > ctx.absoluteIndex) violations.push(`legWindow @${ctx.absoluteIndex}`);
    if (ctx.legs().some(s => s.endIndex > ctx.absoluteIndex)) violations.push(`legs @${ctx.absoluteIndex}`);
    const feats = ctx.legFeatures();
    if (feats.currentIndex !== ctx.absoluteIndex) violations.push(`legFeatures @${ctx.absoluteIndex}`);
    return false;
  },
});
run(cfg({ entryHookMode: 'replace', entryHookId: 'smoke-causal' }));
assert(violations.length === 0, `no lookahead through ctx (${violations.length} violations)`);

// ─── 6. Overrides land on the Trade ───────────────────────────────────────────

console.log('\n[6] side / quantity / SL / target overrides');
registerEntryHook('smoke-fade', {
  label: 'fade every trigger short, fixed size and levels',
  hook: ctx => ({
    side: 'short',
    quantity: 37,
    sl: ctx.candle.close + 40,
    target: ctx.candle.close - 80,
  }),
});
const fade = run(cfg({ entryHookMode: 'replace', entryHookId: 'smoke-fade' }));
const fadeEntries = entries(fade.trades);
assert(fadeEntries.length > 0, `fade hook produced entries (${fadeEntries.length})`);
assert(fadeEntries.every(t => t.type === 'SELL'),
  'side override wins over the trigger direction — an H trigger booked a SELL');
assert(fadeEntries.every(t => t.quantity === 37),
  'quantity override bypasses useAutoQty / tradeQuantity');
assert(fadeEntries.every(t => t.stopLoss !== undefined && Math.abs(t.stopLoss - (t.price + 40)) < 1e-6),
  'absolute SL override lands on the trade verbatim');
assert(fadeEntries.every(t => t.target !== undefined && Math.abs(t.target - (t.price - 80)) < 1e-6),
  'absolute target override lands on the trade verbatim');

// slPoints + targetRR, the relative forms.
registerEntryHook('smoke-relative', {
  label: 'relative levels',
  hook: () => ({ slPoints: 30, targetRR: 3 }),
});
const rel = entries(run(cfg({ entryHookMode: 'replace', entryHookId: 'smoke-relative' })).trades);
assert(rel.length > 0 && rel.every(t => {
  const dir = t.type === 'BUY' ? 1 : -1;
  return Math.abs(t.stopLoss! - (t.price - dir * 30)) < 1e-6
    && Math.abs(t.target! - (t.price + dir * 90)) < 1e-6;
}), 'slPoints + targetRR resolve against the final risk (30 pts → 90 pt target at RR 3)');

// A regime's direction setting still wins over a hook that tries to escape it.
const longOnly = entries(run(cfg({
  entryHookMode: 'replace', entryHookId: 'smoke-fade', direction: 'LONG_ONLY',
})).trades);
assert(longOnly.length === 0, 'a LONG_ONLY regime refuses a hook that returns side: short');

// ─── 7. Fail-closed validation ────────────────────────────────────────────────

console.log('\n[7] invalid decisions produce no trade, never a malformed one');
registerEntryHook('smoke-bad-sl', {
  label: 'long with a stop above entry',
  hook: ctx => ({ side: 'long', sl: ctx.candle.close + 50 }),
});
const badSl = run(cfg({ entryHookMode: 'replace', entryHookId: 'smoke-bad-sl' }));
assert(entries(badSl.trades).length === 0, 'a long stop above entry takes no trade');
assert((badSl.hookDiagnostics?.rejectedCount ?? 0) > 0, 'the rejection is counted, not silent');
assert(!!badSl.hookDiagnostics?.rejectReason, `a reason is recorded: ${badSl.hookDiagnostics?.rejectReason}`);

registerEntryHook('smoke-bad-qty', { label: 'zero size', hook: () => ({ quantity: 0.4 }) });
const badQty = run(cfg({ entryHookMode: 'replace', entryHookId: 'smoke-bad-qty' }));
assert(entries(badQty.trades).length === 0, 'a quantity that floors below 1 takes no trade');

registerEntryHook('smoke-bad-entry', {
  label: 'fill outside the bar',
  hook: ctx => ({ entryPrice: ctx.candle.high + 100 }),
});
const badEntry = run(cfg({ entryHookMode: 'replace', entryHookId: 'smoke-bad-entry' }));
assert(entries(badEntry.trades).length === 0, 'a fill price the bar never traded takes no trade');

// A fill INSIDE the bar is honoured.
registerEntryHook('smoke-fill-low', {
  label: 'fill at the bar low',
  hook: ctx => ({ side: 'long', entryPrice: ctx.candle.low, slPoints: 25 }),
});
const fillLow = entries(run(cfg({ entryHookMode: 'replace', entryHookId: 'smoke-fill-low' })).trades);
assert(fillLow.length > 0 && fillLow.every(t => {
  const bar = CANDLES.find(c => c.timestamp === t.timestamp)!;
  return Math.abs(t.price - bar.low) < 1e-6;
}), 'a fill price inside the bar is booked at exactly that price');

// An unknown hook id fails closed rather than reverting to the built-in chain.
const unknown = run(cfg({ entryHookMode: 'gate', entryHookId: 'does-not-exist' }));
assert(entries(unknown.trades).length === 0,
  'an unregistered hook id takes no trades (never a silent fallback to the built-in chain)');

// ─── 8. A throwing hook does not abort the run ────────────────────────────────

console.log('\n[8] a throwing hook is trapped');
let throwCalls = 0;
registerEntryHook('smoke-throw', {
  label: 'always throws',
  hook: () => { throwCalls++; throw new Error('boom'); },
});
const threw = run(cfg({ entryHookMode: 'replace', entryHookId: 'smoke-throw' }));
assert(entries(threw.trades).length === 0, 'a throwing hook takes no trades');
assert(throwCalls > 1, `the run continued past the first throw (${throwCalls} calls)`);
assert(threw.hookDiagnostics?.errorCount === throwCalls, 'every throw is counted');
assert(threw.hookDiagnostics?.error?.includes('boom') === true,
  `the first message is kept: ${threw.hookDiagnostics?.error}`);

// ─── 9. ctx.state persists within a run, resets between runs ──────────────────

console.log('\n[9] ctx.state lifetime');
const observed: number[] = [];
registerEntryHook('smoke-state', {
  label: 'counter',
  hook: ctx => {
    const s = ctx.state as { n?: number };
    s.n = (s.n ?? 0) + 1;
    observed.push(s.n);
    return false;
  },
});
observed.length = 0;
run(cfg({ entryHookMode: 'replace', entryHookId: 'smoke-state' }));
const firstRun = observed.slice();
observed.length = 0;
run(cfg({ entryHookMode: 'replace', entryHookId: 'smoke-state' }));
const secondRun = observed.slice();
assert(firstRun.length > 1 && firstRun.every((n, i) => n === i + 1),
  `state accumulated across bars within one run (1..${firstRun.length})`);
assert(secondRun[0] === 1, 'state is empty at the start of the next run');

// A cooldown written against ctx.state actually thins the trade set. It has to be coarser
// than the natural spacing single-position mode already imposes (a position being open
// blocks the next signal), or it would thin nothing and the assertion would prove nothing.
const COOLDOWN = 300;
registerEntryHook('smoke-cooldown', {
  label: 'cooldown',
  hook: ctx => {
    const s = ctx.state as { last?: number };
    if (s.last !== undefined && ctx.absoluteIndex - s.last < COOLDOWN) return false;
    s.last = ctx.absoluteIndex;
    return true;
  },
});
const cooled = entries(run(cfg({ entryHookMode: 'replace', entryHookId: 'smoke-cooldown' })).trades);
const allReplace = entries(replaceRun.trades);
assert(cooled.length > 0 && cooled.length < allReplace.length,
  `a stateful cooldown thinned the set (${cooled.length} < ${allReplace.length})`);

// ─── 10. ctx exposes the instrumentation the engine computed ──────────────────

console.log('\n[10] context payload');
let sample: EntryHookContext | null = null;
registerEntryHook('smoke-payload', {
  label: 'payload probe',
  hook: ctx => { if (!sample && ctx.legWindow) sample = ctx; return false; },
});
run(cfg({ entryHookMode: 'replace', entryHookId: 'smoke-payload' }));
assert(sample !== null, 'a bar with a completed breakout leg was sampled');
if (sample) {
  const s: EntryHookContext = sample;
  assert(s.metrics !== undefined && typeof s.metrics === 'object', 'ctx.metrics is the instrumentation snapshot');
  assert(s.atr > 0, 'ctx.atr is populated');
  assert(typeof s.ltMarket === 'string' && s.ltMarket.length > 0, `ctx.ltMarket is set (${s.ltMarket})`);
  assert(s.legs().length > 0, 'ctx.legs() returns a leg sequence');
  assert(s.legs()[0].endIndex >= s.legs()[1]?.endIndex, 'ctx.legs() is newest-first');
  assert(s.legFeatures().features.length > 0, 'ctx.legFeatures() returns a feature window');
  assert(s.legs() === s.legs(), 'ctx.legs() memoizes — the same array comes back');
  assert(s.signals.filter(Boolean).length > 0, 'ctx.signals carries the recent H/L history');
  assert(s.config.entryHookLookback === undefined || typeof s.config.entryHookLookback === 'number',
    'ctx.config is the live config');
}

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(60)}`);
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
