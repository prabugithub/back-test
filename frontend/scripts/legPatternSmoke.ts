// Acceptance tests for the leg-pattern rule engine (utils/legPattern/*).
// Hand-built LegSegment fixtures — no DB needed. Follows the exitEngineSmoke.ts pattern.
//
//   npm run backtest:legpattern   (tsx scripts/legPatternSmoke.ts)
import {
  buildLegWindowFromSegments,
  compileLegPattern,
  clampLegPatternConfig,
  defaultLegPatternConfig,
  deriveDirArray,
  legPatternActive,
  MAX_LEG_SLOTS,
  type LegPatternConfig,
  type LegSlot,
} from '../src/utils/legPattern';
import { calculateBarQuality } from '../src/utils/pivotAnalysis';
import { defaultAutoBacktestConfig, type AutoBacktestConfig, type RegimeRules } from '../src/utils/autoBacktestEngine';
import { runBatchSimulation } from '../src/utils/batchBacktestSimulator';
import type { Candle, LegSegment } from '../src/types';

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string) {
  if (cond) { passed++; console.log(`  ✓ ${msg}`); }
  else { failed++; console.error(`  ✗ FAIL: ${msg}`); }
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function wave(n: number, start: number, drift: number, amp = 6, period = 12): Candle[] {
  const base = Date.UTC(2026, 0, 5, 3, 45, 0) / 1000;
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

interface SegSpec {
  kind: 'leg' | 'pullback';
  dir: 'bull' | 'bear';
  bars: number;
  movePct: number;
  /** Per-candle [brr, dir] pairs, oldest-first. Omit for an 'avg'-detail segment. */
  bars2?: Array<[number, 1 | 0 | -1]>;
  brrAvg?: number;
  high?: number;
  low?: number;
  /** Override the derived break count (default: every candle breaks, in the leg's direction). */
  hbc?: number;
}

const CANDLES = wave(400, 20000, 0.8);

/** Specs are given NEWEST-FIRST (the engine's convention). Indices are laid out
 *  contiguously backwards from `currentIndex`, exactly as buildLegSequence does. */
function mkWindow(specs: SegSpec[], currentIndex = 300): LegSegment[] {
  const out: LegSegment[] = [];
  let end = currentIndex;
  for (const s of specs) {
    const start = end - s.bars + 1;
    const startPrice = 20000;
    const endPrice = startPrice * (1 + s.movePct / 100);
    const seg: LegSegment = {
      kind: s.kind,
      direction: s.dir,
      startIndex: start,
      endIndex: end,
      startTime: CANDLES[start]?.timestamp ?? 0,
      endTime: CANDLES[end]?.timestamp ?? 0,
      barCount: s.bars,
      startPrice,
      endPrice,
      high: s.high ?? Math.max(startPrice, endPrice) + 10,
      low: s.low ?? Math.min(startPrice, endPrice) - 10,
      movePct: s.movePct,
      brrAvg: s.brrAvg ?? 0.5,
      clvAvg: 0.5,
      uwrAvg: 0.25,
      lwrAvg: 0.25,
      highBreakCount: s.hbc ?? (s.dir === 'bull' ? s.bars : 0),
      lowBreakCount: s.dir === 'bear' ? s.bars : 0,
      bullCount: s.dir === 'bull' ? s.bars : 0,
      hlSeq: '',
    };
    if (s.bars2) {
      seg.brr = s.bars2.map(b => b[0]);
      // Give o/c so the adapter derives tri-state direction from prices, the way a real
      // 'full'-detail segment does.
      seg.o = s.bars2.map(() => 100);
      seg.c = s.bars2.map(b => (b[1] === 1 ? 101 : b[1] === -1 ? 99 : 100));
      seg.clv = s.bars2.map(() => 0.5);
      seg.uwr = s.bars2.map(() => 0.25);
      seg.lwr = s.bars2.map(() => 0.25);
      seg.bullBear = s.bars2.map(b => (b[1] === 1 ? 1 : 0));
      seg.hl = s.bars2.map(() => null);
      seg.h = s.bars2.map(() => 101);
      seg.l = s.bars2.map(() => 99);
    }
    out.push(seg);
    end = start - 1;
  }
  return out;
}

const win = (specs: SegSpec[], currentIndex = 300) =>
  buildLegWindowFromSegments(mkWindow(specs, currentIndex), CANDLES, currentIndex);

function cfg(legs: LegSlot[], over: Partial<LegPatternConfig> = {}): LegPatternConfig {
  return { ...defaultLegPatternConfig(), enabled: true, legs, ...over };
}

// A canonical alternating bull-trend window, newest-first:
//   seg0 pullback | seg1 LEG bull | seg2 pullback | seg3 LEG bull | seg4 pullback | seg5 LEG bull
// so leg[0] = seg1, leg[1] = seg3, leg[2] = seg5.
const TREND: SegSpec[] = [
  { kind: 'pullback', dir: 'bear', bars: 3, movePct: -0.10 },
  { kind: 'leg', dir: 'bull', bars: 6, movePct: 0.40 },
  { kind: 'pullback', dir: 'bear', bars: 2, movePct: -0.12 },
  { kind: 'leg', dir: 'bull', bars: 5, movePct: 0.60 },
  { kind: 'pullback', dir: 'bear', bars: 4, movePct: -0.20 },
  { kind: 'leg', dir: 'bull', bars: 7, movePct: 0.50 },
];

// ─── 1. Empty-spec identity ───────────────────────────────────────────────────
{
  console.log('\n[1] empty-spec identity');
  assert(compileLegPattern(defaultLegPatternConfig()) === null, 'a fresh config compiles to no predicate');
  assert(compileLegPattern(cfg([])) === null, 'enabled but no positions still compiles to null');
  assert(!legPatternActive(cfg([])), 'legPatternActive is false for an empty spec');
  assert(compileLegPattern(undefined) === null, 'undefined config compiles to null');
}

// ─── 2. Bar-quality identity ──────────────────────────────────────────────────
{
  console.log('\n[2] bar-quality identity');
  const samples = calculateBarQuality(CANDLES, 100, 40);
  const bad = samples.filter(s => Math.abs(s.brr + s.uwr + s.lwr - 1) > 1e-9);
  assert(bad.length === 0, `brr + uwr + lwr === 1 on all ${samples.length} candles`);

  const flat: Candle[] = [{ timestamp: 1, open: 100, high: 100, low: 100, close: 100, volume: 1 },
                          { timestamp: 2, open: 100, high: 100, low: 100, close: 100, volume: 1 }];
  const z = calculateBarQuality(flat, 1, 1)[0];
  assert(z.brr === 0 && z.clv === 0 && z.uwr === 0 && z.lwr === 0, 'zero-range candle gives all zeros');
}

// ─── 3. Direction mapping: doji is 0, never a side ────────────────────────────
{
  console.log('\n[3] direction mapping');
  const segs = mkWindow([{ kind: 'leg', dir: 'bull', bars: 3, movePct: 0.3, bars2: [[0.8, 1], [0, 0], [0.9, -1]] }]);
  const dir = deriveDirArray(segs[0]);
  assert(!!dir && dir[0] === 1 && dir[1] === 0 && dir[2] === -1, 'o/c derive tri-state 1 / 0 / -1');

  const s2 = { ...segs[0] };
  delete s2.o; delete s2.c;
  const dir2 = deriveDirArray(s2);
  assert(!!dir2 && dir2[1] === 0, 'brr/bullBear fallback maps a zero-body candle to 0, not -1');

  const s3 = { ...segs[0] };
  delete s3.o; delete s3.c; delete s3.brr; delete s3.bullBear;
  assert(deriveDirArray(s3) === null, 'no per-candle data → null (unknown), not a fabricated array');
}

// ─── 4. THE ADDRESSING: index counts IMPULSE LEGS, skipping pullbacks ─────────
{
  console.log('\n[4] positional addressing');
  const w = win(TREND);
  assert(
    w.impulseIndices.length === 3 &&
    w.impulseIndices[0] === 1 && w.impulseIndices[1] === 3 && w.impulseIndices[2] === 5,
    `leg[0..2] resolve to segments ${w.impulseIndices.join(', ')} — pullbacks are skipped`
  );

  // leg[0] is the 6-bar leg (seg1), NOT the 3-bar trailing pullback (seg0).
  const m = compileLegPattern(cfg([{ side: 'bull', candles: { min: 6, max: 6 } }]))!;
  assert(m.test(w, true), 'leg[0] binds the most recent LEG (6 bars), not the trailing pullback (3 bars)');
  const wrong = compileLegPattern(cfg([{ side: 'bull', candles: { min: 3, max: 3 } }]))!;
  assert(!wrong.test(w, true), 'and does not bind the 3-bar pullback sitting at segment 0');

  // leg[1] is the NEXT leg back (5 bars), not the pullback between them (2 bars).
  const m2 = compileLegPattern(cfg([{}, { candles: { min: 5, max: 5 } }]))!;
  assert(m2.test(w, true), 'leg[1] binds the next LEG back (5 bars), skipping the 2-bar pullback');
}

// ─── 5. "is leg[0] bull?" — the direction test per position ───────────────────
{
  console.log('\n[5] per-position direction');
  // seg1 = bull leg, seg3 = bear leg, seg5 = bull leg → leg[0] bull, leg[1] bear, leg[2] bull
  const mixed: SegSpec[] = [
    { kind: 'pullback', dir: 'bear', bars: 2, movePct: -0.10 },
    { kind: 'leg', dir: 'bull', bars: 6, movePct: 0.40 },
    { kind: 'pullback', dir: 'bull', bars: 2, movePct: 0.10 },
    { kind: 'leg', dir: 'bear', bars: 5, movePct: -0.50 },
    { kind: 'pullback', dir: 'bear', bars: 2, movePct: -0.10 },
    { kind: 'leg', dir: 'bull', bars: 7, movePct: 0.50 },
  ];
  const exact = compileLegPattern(cfg([{ side: 'bull' }, { side: 'bear' }, { side: 'bull' }]))!;
  assert(exact.test(win(mixed), true), 'leg[0] bull, leg[1] bear, leg[2] bull matches that window');

  const allBull = compileLegPattern(cfg([{ side: 'bull' }, { side: 'bull' }, { side: 'bull' }]))!;
  assert(!allBull.test(win(mixed), true), 'requiring leg[1] to be bull rejects it');
  assert(allBull.test(win(TREND), true), '…and matches the all-bull trend window');

  const wildcard = compileLegPattern(cfg([{ side: 'bull' }, {}, { side: 'bull' }]))!;
  assert(wildcard.test(win(mixed), true), 'leg[1] left as "either" is a wildcard — it just has to exist');
}

// ─── 6. A window with too few legs REJECTS ───────────────────────────────────
{
  console.log('\n[6] short window');
  const twoLegs: SegSpec[] = [
    { kind: 'pullback', dir: 'bear', bars: 2, movePct: -0.10 },
    { kind: 'leg', dir: 'bull', bars: 6, movePct: 0.40 },
    { kind: 'pullback', dir: 'bear', bars: 2, movePct: -0.10 },
    { kind: 'leg', dir: 'bull', bars: 5, movePct: 0.50 },
  ];
  const needsThree = compileLegPattern(cfg([{ side: 'bull' }, { side: 'bull' }, { side: 'bull' }]))!;
  assert(needsThree.requiredLegs === 3, 'matcher reports it needs 3 legs');
  assert(!needsThree.test(win(twoLegs), true), 'a 2-leg window fails a 3-position pattern');
  const v = needsThree.explain(win(twoLegs), true);
  assert(v.some(x => x.unknown > 0), 'and explain() counts it as unevaluable rather than a silent reject');
  assert(v.some(x => x.detail.includes('holds 2 impulse leg')), `explain says why: "${v.find(x => x.section === 'legs')?.detail}"`);
}

// ─── 7. Nested pullback still binds to the segment AFTER the leg (j-1) ───────
{
  console.log('\n[7] nested pullback binds j-1');
  // leg[0] = seg1 (6 bars). Its FOLLOWING retrace is seg0 (3 bars).
  //                          The pullback BEFORE it is seg2 (2 bars).
  const followed = compileLegPattern(cfg([
    { side: 'bull', candles: { min: 6, max: 6 }, pullback: { presence: 'required', candles: { min: 3, max: 3 } } },
  ]))!;
  assert(followed.test(win(TREND), true), 'binds the 3-bar retrace at segment 0 (the one that FOLLOWED leg[0])');

  const preceded = compileLegPattern(cfg([
    { side: 'bull', candles: { min: 6, max: 6 }, pullback: { presence: 'required', candles: { min: 2, max: 2 } } },
  ]))!;
  assert(!preceded.test(win(TREND), true), 'does NOT bind the 2-bar pullback at segment 2 (the one before it)');
}

// ─── 8. presence: required / optional / forbidden ────────────────────────────
{
  console.log('\n[8] pullback presence');
  const mk = (presence: 'required' | 'optional' | 'forbidden') =>
    compileLegPattern(cfg([{ side: 'bull', candles: { min: 6, max: 6 }, pullback: { presence } }]))!;

  // leg[0] is the newest SEGMENT here, so no retrace followed it.
  const noRetrace: SegSpec[] = [
    { kind: 'leg', dir: 'bull', bars: 6, movePct: 0.4 },
    { kind: 'pullback', dir: 'bear', bars: 2, movePct: -0.1 },
    { kind: 'leg', dir: 'bull', bars: 5, movePct: 0.5 },
  ];
  assert(!mk('required').test(win(noRetrace), true), 'required: fails when no retrace has formed yet');
  assert(mk('forbidden').test(win(noRetrace), true), "forbidden: matches exactly that 'ran straight on' case");
  assert(mk('optional').test(win(noRetrace), true), 'optional: tolerates the absence');

  assert(mk('required').test(win(TREND), true), 'required: matches when a retrace did follow');
  assert(!mk('forbidden').test(win(TREND), true), 'forbidden: fails when a retrace did follow');

  const adjacent: SegSpec[] = [
    { kind: 'leg', dir: 'bear', bars: 3, movePct: -0.2 },
    { kind: 'leg', dir: 'bull', bars: 6, movePct: 0.4 },
  ];
  // leg[0] here is the BEAR leg at seg0; leg[1] is the bull leg at seg1, whose next
  // newer segment is a leg, not a pullback.
  const onSecond = (presence: 'required' | 'forbidden') =>
    compileLegPattern(cfg([{}, { side: 'bull', candles: { min: 6, max: 6 }, pullback: { presence } }]))!;
  assert(onSecond('forbidden').test(win(adjacent), true), 'forbidden: also matches when the next segment is another leg');
  assert(!onSecond('required').test(win(adjacent), true), 'required: fails when the next segment is another leg');
}

// ─── 9. Nested depthRatio is measured against THAT position's leg ────────────
{
  console.log('\n[9] nested depthRatio');
  // leg[0] (seg1) moves 0.40%; its retrace (seg0) moves -0.10% → depth 0.25.
  const exact = compileLegPattern(cfg([
    { side: 'bull', candles: { min: 6, max: 6 }, pullback: { presence: 'required', depthRatio: { min: 0.20, max: 0.30 } } },
  ]))!;
  assert(exact.test(win(TREND), true), 'depth 0.10/0.40 = 0.25 matches a 0.20–0.30 band');

  const tooTight = compileLegPattern(cfg([
    { side: 'bull', candles: { min: 6, max: 6 }, pullback: { presence: 'required', depthRatio: { max: 0.20 } } },
  ]))!;
  assert(!tooTight.test(win(TREND), true), 'and fails a ≤0.20 ceiling');

  const w = win(TREND);
  assert(Math.abs(w.features[0].depthRatio - 0.25) < 1e-9,
    `the generic second pass independently computes ${w.features[0].depthRatio.toFixed(4)}`);
}

// ─── 10. Consecutive-break run (new field) ───────────────────────────────────
{
  console.log('\n[10] consecutive breaks');
  // Built off the RAW candles, so it needs no per-candle arrays and is never unknown.
  const w = win(TREND);
  const leg0 = w.features[w.impulseIndices[0]];
  assert(Number.isFinite(leg0.maxHighBreakRun) && Number.isFinite(leg0.maxLowBreakRun),
    `maxHighBreakRun=${leg0.maxHighBreakRun} maxLowBreakRun=${leg0.maxLowBreakRun} — always measurable`);
  const m = compileLegPattern(cfg([{ side: 'bull', maxBreakRun: { min: 0 } }]))!;
  assert(!m.needsPerCandle, 'a consecutive-break condition does NOT force per-candle detail');
  // It gates for real, resolved by the leg's own direction: leg[0] is BULL here, so the
  // field reads maxHighBreakRun (0 over these fixture candles), not maxLowBreakRun (5).
  const demandsRun = compileLegPattern(cfg([{ side: 'bull', maxBreakRun: { min: 1 } }]))!;
  const allowsNone = compileLegPattern(cfg([{ side: 'bull', maxBreakRun: { max: 0 } }]))!;
  assert(!demandsRun.test(win(TREND), true) && allowsNone.test(win(TREND), true),
    'a maxBreakRun bound gates, reading the UP run for a bull leg (not the DOWN run)');
}

// ─── 11. Unknown runs fail AND are counted ───────────────────────────────────
{
  console.log('\n[11] unknown runs');
  const m = compileLegPattern(cfg([{ side: 'bull', runs: [{ minBrr: 0.5, minRun: 2, side: 'same' }] }]))!;
  assert(m.needsPerCandle, 'matcher declares it needs per-candle data');
  assert(!m.test(win(TREND), true), 'rejects a window with no per-candle arrays');
  assert(m.explain(win(TREND), true).some(x => x.unknown > 0), 'explain() reports unknown > 0');

  const withBars: SegSpec[] = [
    { kind: 'pullback', dir: 'bear', bars: 2, movePct: -0.1, bars2: [[0.2, -1], [0.2, -1]] },
    { kind: 'leg', dir: 'bull', bars: 4, movePct: 0.4, bars2: [[0.9, 1], [0.9, 1], [0.3, 1], [0.2, -1]] },
  ];
  assert(m.test(win(withBars), true), 'the same spec matches once the per-candle arrays are present');

  const dojiBroken: SegSpec[] = [
    { kind: 'pullback', dir: 'bear', bars: 2, movePct: -0.1, bars2: [[0.2, -1], [0.2, -1]] },
    { kind: 'leg', dir: 'bull', bars: 3, movePct: 0.4, bars2: [[0.9, 1], [0.0, 0], [0.9, 1]] },
  ];
  assert(!m.test(win(dojiBroken), true), 'a doji breaks a conviction run');
}

// ─── 12. Unmeasurable retrace fails ──────────────────────────────────────────
{
  console.log('\n[12] unmeasurable retrace');
  const m = compileLegPattern(cfg([], { retrace: { enabled: true, windowLegs: 10, maxPct: 40 } }))!;
  const flatSpecs: SegSpec[] = [
    { kind: 'pullback', dir: 'bear', bars: 2, movePct: 0, high: 100, low: 100 },
    { kind: 'leg', dir: 'bull', bars: 3, movePct: 0, high: 100, low: 100 },
  ];
  assert(!m.test(win(flatSpecs), true), 'a zero-height window FAILS the retrace gate (not passes)');
  assert(m.explain(win(flatSpecs), true).some(v => v.section === 'retrace' && v.unknown > 0),
    'and the unmeasurable retrace is reported');

  const shallow: SegSpec[] = [
    { kind: 'pullback', dir: 'bear', bars: 2, movePct: -0.05, high: 20000, low: 19985 },
    { kind: 'leg', dir: 'bull', bars: 5, movePct: 0.40, high: 20000, low: 19000 },
  ];
  assert(m.test(win(shallow), true), 'a shallow retrace (1%) passes a 40% ceiling');
  assert(!m.test(win(TREND), true), 'a deep retrace (~83%) fails the same ceiling');
}

// ─── 13. Clamping happens on load ────────────────────────────────────────────
{
  console.log('\n[13] clamping');
  const c = clampLegPatternConfig({
    version: 2, enabled: true, legs: [],
    retrace: { enabled: true, windowLegs: 999, maxPct: 400 },
  });
  assert(c.retrace!.windowLegs === 20, `windowLegs 999 → ${c.retrace!.windowLegs}`);
  assert(c.retrace!.maxPct === 50, `maxPct 400 → ${c.retrace!.maxPct}`);

  const rev = clampLegPatternConfig({ version: 2, enabled: true, legs: [{ candles: { min: 10, max: 3 } }] });
  assert(rev.legs[0].candles!.min === 3 && rev.legs[0].candles!.max === 10,
    'a reversed range is swapped rather than made unmatchable');

  const many = clampLegPatternConfig({
    version: 2, enabled: true, legs: Array.from({ length: 20 }, () => ({ side: 'bull' as const })),
  });
  assert(many.legs.length === MAX_LEG_SLOTS, `20 positions → clamped to ${many.legs.length}`);

  let threw = false;
  try { clampLegPatternConfig({ version: 1, enabled: true, legs: [] }); } catch { threw = true; }
  assert(threw, 'a v1 (bull/bear-section) config is refused loudly — no silent half-load');

  const bad = compileLegPattern({ version: 1, enabled: true, legs: [] } as unknown as LegPatternConfig)!;
  assert(!!bad.error && !bad.test(win(TREND), true),
    'but compileLegPattern does not throw — it returns a fail-closed matcher carrying the error');
}

// ─── 14. sideBasis sensitivity ───────────────────────────────────────────────
{
  console.log('\n[14] sideBasis sensitivity');
  const disagree: SegSpec[] = [
    { kind: 'pullback', dir: 'bear', bars: 2, movePct: -0.05 },
    { kind: 'leg', dir: 'bull', bars: 5, movePct: -0.30 }, // labelled bull, travelled down
  ];
  const mk = (basis: 'realized' | 'struct') =>
    compileLegPattern(cfg([{ side: 'bull' }], { sideBasis: basis }))!;
  const r = mk('realized').test(win(disagree), true);
  const s = mk('struct').test(win(disagree), true);
  assert(r !== s, `the two bases disagree (realized=${r}, struct=${s}) — basis plumbing is connected`);
  assert(s === true && r === false, 'struct sees the bull label; realized sees the down move');
}

// ─── 15. YOUR SCENARIO A ─────────────────────────────────────────────────────
{
  console.log('\n[15] scenario A: "leg[0] is bull, 3-5 candles, every candle breaks the high, then a 50% retrace"');
  const A = compileLegPattern(cfg([{
    side: 'bull',
    candles: { min: 3, max: 5 },
    breakPersist: { min: 1 },
    pullback: { presence: 'required', depthRatio: { min: 0.45, max: 0.55 } },
  }]))!;
  console.log(`     ${A.describe()}`);

  const good: SegSpec[] = [
    { kind: 'pullback', dir: 'bear', bars: 2, movePct: -0.50 },
    { kind: 'leg', dir: 'bull', bars: 4, movePct: 1.00, hbc: 4 },
    { kind: 'pullback', dir: 'bear', bars: 2, movePct: -0.20 },
    { kind: 'leg', dir: 'bull', bars: 6, movePct: 0.80, hbc: 6 },
  ];
  assert(A.test(win(good), true), 'matches: 4 candles, 4/4 breaks, 50% retrace');

  const only3 = structuredClone(good); only3[1].hbc = 3;
  assert(!A.test(win(only3), true), 'rejects when only 3 of 4 candles break');
  const long = structuredClone(good); long[1].bars = 7; long[1].hbc = 7;
  assert(!A.test(win(long), true), 'rejects a 7-candle leg');
  const deep = structuredClone(good); deep[0].movePct = -0.80;
  assert(!A.test(win(deep), true), 'rejects an 80% retrace');
  const bearFirst = structuredClone(good); bearFirst[1].dir = 'bear'; bearFirst[1].movePct = -1.0;
  assert(!A.test(win(bearFirst), true), 'rejects when leg[0] is bear');
}

// ─── 16. YOUR SCENARIO B ─────────────────────────────────────────────────────
{
  console.log('\n[16] scenario B: per-position quality on leg[0], leg[1], leg[2]');
  const B = compileLegPattern(cfg([
    { side: 'bull', candles: { min: 8 }, avgBrr: { min: 0.5 }, breakPersist: { min: 0.8 } },
    { side: 'bull', candles: { min: 5, max: 7 }, avgBrr: { min: 0.5 } },
    { side: 'bull', candles: { min: 3, max: 4 }, avgBrr: { min: 0.5 } },
  ]))!;
  const ladder: SegSpec[] = [
    { kind: 'pullback', dir: 'bear', bars: 2, movePct: -0.2 },
    { kind: 'leg', dir: 'bull', bars: 9, movePct: 1.2, brrAvg: 0.7 },
    { kind: 'pullback', dir: 'bear', bars: 2, movePct: -0.2 },
    { kind: 'leg', dir: 'bull', bars: 6, movePct: 0.9, brrAvg: 0.7 },
    { kind: 'pullback', dir: 'bear', bars: 2, movePct: -0.2 },
    { kind: 'leg', dir: 'bull', bars: 4, movePct: 0.6, brrAvg: 0.7 },
  ];
  assert(B.test(win(ladder), true), '9 > 6 > 4 candles with per-position BRR and break persistence matches');

  // STILL A GAP: the bands are absolute, so a differently-scaled increasing ladder fails.
  const bigger: SegSpec[] = ladder.map(s =>
    s.kind === 'leg' ? { ...s, bars: s.bars * 2 } : s);
  assert(!B.test(win(bigger), true),
    'BUT 18 > 12 > 8 — also increasing — still fails: bounds are absolute, not relative');
}

// ─── 17. Batch-simulator integration ─────────────────────────────────────────
{
  console.log('\n[17] batch-simulator integration');
  const candles = wave(900, 20000, 0.9);
  const base = (over: Partial<RegimeRules>): RegimeRules => ({
    ...defaultAutoBacktestConfig.uptrend,
    enabled: true, entryMode: 'PIVOT', maFilter: 'none', htStructureFilter: 'any',
    barOverlapFilter: 'none', barRangeFilter: 'none',
    ema21SlopeFilter: 'none', ema50SlopeFilter: 'none',
    slMethod: 'fixed', slFixedPoints: 50, targetRR: 2,
    ...over,
  });
  const full = (rules: RegimeRules): AutoBacktestConfig => ({
    ...defaultAutoBacktestConfig, enabled: true,
    uptrend: rules, downtrend: rules,
    range: { ...rules, enabled: false }, reversal: { ...rules, enabled: false },
  });

  // Trade `id` is `batch-${Date.now()}-N`, so it differs between runs by design.
  const decisions = (trades: unknown[]) =>
    JSON.stringify(trades.map(t => { const { id, ...rest } = t as { id: string }; return rest; }));

  const before = runBatchSimulation(candles, full(base({})), 60, 'SMOKE', 1, '1');
  assert(before.trades.length > 0, `unconfigured baseline still trades (${before.trades.length} trades)`);

  const disabled = runBatchSimulation(
    candles, full(base({ legPattern: { ...defaultLegPatternConfig(), enabled: false } })), 60, 'SMOKE', 1, '1');
  assert(decisions(disabled.trades) === decisions(before.trades),
    'a disabled pattern produces identical trades (strict no-op)');

  const emptyOn = runBatchSimulation(
    candles, full(base({ legPattern: { ...defaultLegPatternConfig(), enabled: true } })), 60, 'SMOKE', 1, '1');
  assert(decisions(emptyOn.trades) === decisions(before.trades),
    'an enabled but position-less pattern is also identity');

  const withPattern = (legs: LegSlot[]) => runBatchSimulation(
    candles, full(base({ legPattern: cfg(legs) })), 60, 'SMOKE', 1, '1').trades.length;

  const loose = withPattern([{ side: 'any' }]);
  const oneLeg = withPattern([{ side: 'bull' }]);
  const threeLegs = withPattern([{ side: 'bull' }, { side: 'bull' }, { side: 'bull' }]);
  console.log(`     baseline ${before.trades.length} → any ${loose} → leg[0] bull ${oneLeg} → 3 bull legs ${threeLegs}`);
  assert(loose <= before.trades.length, 'a pattern never ADDS trades');
  assert(threeLegs <= oneLeg, 'naming more positions never matches more');

  const impossible = runBatchSimulation(
    candles, full(base({ legPattern: cfg([{ side: 'bull', candles: { min: 999, max: 1000 } }]) })), 60, 'SMOKE', 1, '1');
  assert(impossible.trades.length === 0, 'an unsatisfiable pattern rejects every bar');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
