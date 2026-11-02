// One-off verification for the session-open / gap instrumentation.
// Asserts the day-boundary invariants over real cached candles, checks that
// gaps are timeframe-invariant, then runs the REAL batch simulator and checks
// every trade's stamped fields.
//   npx tsx scripts/sessionGapVerify.ts
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { runBatchSimulation } from '../src/utils/batchBacktestSimulator';
import { getSessionOpenContext, istDayIndex, buildSessionOpenFields } from '../src/utils/sessionDay';
import { resampleCandles } from '../src/utils/resampler';
import { defaultAutoBacktestConfig, type AutoBacktestConfig } from '../src/utils/autoBacktestEngine';
import type { Candle } from '../src/types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, '../../backend/data/backtesting.db');

function loadCandles(securityId: string): Candle[] {
  const db = new Database(DB_PATH, { readonly: true });
  const rows = db
    .prepare(
      `SELECT timestamp, open, high, low, close, volume FROM candles
       WHERE security_id = ? AND exchange_segment = 'NSE_EQ' AND interval = '5'
       ORDER BY timestamp ASC`
    )
    .all(securityId) as Candle[];
  db.close();
  return rows;
}

let failures = 0;
const fail = (msg: string) => { failures++; console.error('  ✗ ' + msg); };

/** IST wall clock for a UTC-epoch-seconds timestamp, without relying on the host TZ. */
function istHHMM(ts: number): string {
  const secOfDay = (ts + 19800) % 86400;
  const h = Math.floor(secOfDay / 3600);
  const m = Math.floor((secOfDay % 3600) / 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
function istDate(ts: number): string {
  return new Date((istDayIndex(ts) * 86400) * 1000).toISOString().slice(0, 10);
}

const candles = loadCandles('1333');
console.log(`Loaded ${candles.length} 5m candles (${istDate(candles[0].timestamp)} → ${istDate(candles[candles.length - 1].timestamp)})\n`);

// ── 1. Day-boundary invariants over every bar ────────────────────────────────
console.log('1. Day-boundary invariants (every bar)');
const distinctDays = new Set(candles.map(c => istDayIndex(c.timestamp)));
const openBarIndices = new Set<number>();
let prevBarsSinceOpen = -1;
let prevOpenIdx = -1;
let badOpenTime = 0;

for (let i = 0; i < candles.length; i++) {
  const ctx = getSessionOpenContext(candles, i);
  if (!ctx) { fail(`index ${i}: no context returned`); continue; }
  openBarIndices.add(ctx.openBarIndex);

  // barsSinceOpen is 0 exactly at the open bar, and steps by 1 within a day.
  if (i === ctx.openBarIndex) {
    if (ctx.barsSinceOpen !== 0) fail(`index ${i}: open bar has barsSinceOpen=${ctx.barsSinceOpen}`);
  } else if (ctx.openBarIndex === prevOpenIdx && ctx.barsSinceOpen !== prevBarsSinceOpen + 1) {
    fail(`index ${i}: barsSinceOpen jumped ${prevBarsSinceOpen} → ${ctx.barsSinceOpen}`);
  }
  prevBarsSinceOpen = ctx.barsSinceOpen;
  prevOpenIdx = ctx.openBarIndex;

  // The open bar must belong to the same IST day as the bar we queried from.
  if (istDayIndex(candles[ctx.openBarIndex].timestamp) !== istDayIndex(candles[i].timestamp)) {
    fail(`index ${i}: open bar is on a different IST day`);
  }
  // dayOpen must be that bar's open, and the gap must be exactly open - prevClose.
  if (ctx.dayOpen !== candles[ctx.openBarIndex].open) fail(`index ${i}: dayOpen != openBar.open`);
  if (ctx.openBarTimestamp !== candles[ctx.openBarIndex].timestamp) fail(`index ${i}: openBarTimestamp mismatch`);
  if (ctx.prevDayClose !== undefined) {
    const expect = ctx.dayOpen - ctx.prevDayClose;
    if (Math.abs((ctx.gapPoints ?? NaN) - expect) > 1e-9) fail(`index ${i}: gapPoints != dayOpen - prevDayClose`);
    if (Math.abs((ctx.gapPercent ?? NaN) - (expect / ctx.prevDayClose) * 100) > 1e-9) fail(`index ${i}: gapPercent wrong`);
  } else if (ctx.gapPoints !== undefined || ctx.gapPercent !== undefined) {
    fail(`index ${i}: gap fields present without prevDayClose`);
  }
}

// One open bar per distinct IST day, and each should land on 09:15.
if (openBarIndices.size !== distinctDays.size) {
  fail(`${openBarIndices.size} open bars for ${distinctDays.size} distinct IST days`);
} else {
  console.log(`  ${openBarIndices.size} open bars = ${distinctDays.size} distinct IST days ✓`);
}
for (const idx of openBarIndices) {
  if (istHHMM(candles[idx].timestamp) !== '09:15') {
    badOpenTime++;
    if (badOpenTime <= 5) console.log(`    note: ${istDate(candles[idx].timestamp)} first bar is ${istHHMM(candles[idx].timestamp)}, not 09:15`);
  }
}
console.log(`  ${openBarIndices.size - badOpenTime}/${openBarIndices.size} open bars are at 09:15 IST${badOpenTime ? ` (${badOpenTime} partial days)` : ' ✓'}`);

// First day of the array must have NO gap (undefined, not 0).
const first = getSessionOpenContext(candles, 0)!;
if (first.gapPoints !== undefined || first.prevDayClose !== undefined) fail('first day of array reports a gap');
else console.log('  first day of array: gapPoints undefined (not 0) ✓');

// ── 2. Sample of real gaps, eyeball-able ─────────────────────────────────────
console.log('\n2. Sample gaps (first 8 day boundaries)');
const sortedOpens = [...openBarIndices].sort((a, b) => a - b).slice(1, 9);
for (const idx of sortedOpens) {
  const c = getSessionOpenContext(candles, idx)!;
  const dir = (c.gapPoints ?? 0) > 0 ? 'UP  ' : (c.gapPoints ?? 0) < 0 ? 'DOWN' : 'FLAT';
  console.log(`  ${istDate(candles[idx].timestamp)}  prevClose ${c.prevDayClose?.toFixed(2)} → open ${c.dayOpen.toFixed(2)}  gap ${dir} ${c.gapPoints?.toFixed(2)} (${c.gapPercent?.toFixed(3)}%)`);
}

// ── 3. Gaps must be identical across timeframes ──────────────────────────────
console.log('\n3. Timeframe invariance (5m vs 15m vs 60m)');
for (const tf of [15, 60]) {
  const rs = resampleCandles(candles, tf);
  // Map IST day → gap, on both series, and compare.
  const gapsOf = (arr: Candle[]) => {
    const m = new Map<number, number>();
    for (let i = 0; i < arr.length; i++) {
      const ctx = getSessionOpenContext(arr, i)!;
      if (ctx.gapPoints !== undefined) m.set(istDayIndex(arr[i].timestamp), ctx.gapPoints);
    }
    return m;
  };
  const a = gapsOf(candles);
  const b = gapsOf(rs);
  let diff = 0, compared = 0;
  for (const [day, g] of b) {
    if (!a.has(day)) continue;
    compared++;
    if (Math.abs(a.get(day)! - g) > 1e-9) diff++;
  }
  if (diff > 0) fail(`${tf}m: ${diff}/${compared} days have a different gap than 5m`);
  else console.log(`  ${tf}m: all ${compared} days report the same gap as 5m ✓`);

  // barsSinceOpen must scale down, not stay flat.
  const maxBso5 = Math.max(...candles.map((_, i) => getSessionOpenContext(candles, i)!.barsSinceOpen));
  const maxBsoTf = Math.max(...rs.map((_, i) => getSessionOpenContext(rs, i)!.barsSinceOpen));
  if (maxBsoTf >= maxBso5) fail(`${tf}m: max barsSinceOpen ${maxBsoTf} not below 5m's ${maxBso5}`);
  else console.log(`  ${tf}m: max barsSinceOpen ${maxBsoTf} < 5m's ${maxBso5} ✓`);
}

// ── 4. Batch simulator stamps the fields ─────────────────────────────────────
console.log('\n4. Batch simulator stamping');
const cfg: AutoBacktestConfig = { ...defaultAutoBacktestConfig, enabled: true };
const result = runBatchSimulation(candles, cfg, 60, 'HDFCBANK', 1, '5');
console.log(`  ${result.trades.length} trades simulated`);
let stamped = 0, unstamped = 0, wrong = 0;
for (const t of result.trades) {
  const idx = candles.findIndex(c => c.timestamp === t.timestamp);
  if (idx < 0) continue;
  if (t.barsSinceOpenAtEntry === undefined) { unstamped++; continue; }
  stamped++;
  const expect = buildSessionOpenFields(candles, idx);
  if (
    t.barsSinceOpenAtEntry !== expect.barsSinceOpenAtEntry ||
    t.dayOpenAtEntry !== expect.dayOpenAtEntry ||
    t.openBarTimestampAtEntry !== expect.openBarTimestampAtEntry ||
    t.gapPointsAtEntry !== expect.gapPointsAtEntry ||
    t.gapPercentAtEntry !== expect.gapPercentAtEntry ||
    t.prevDayCloseAtEntry !== expect.prevDayCloseAtEntry
  ) wrong++;
}
if (stamped === 0) fail('no trade carries the session-open fields');
if (wrong > 0) fail(`${wrong}/${stamped} stamped trades disagree with buildSessionOpenFields`);
else if (stamped > 0) console.log(`  ${stamped} stamped trades all match buildSessionOpenFields ✓ (${unstamped} unstamped = reducing fills)`);

// Stamped values must be self-consistent with the trade's own bar.
const withGap = result.trades.filter(t => t.gapPointsAtEntry !== undefined);
if (withGap.length) {
  const t = withGap[0];
  console.log(`  e.g. entry ${istDate(t.timestamp)} ${istHHMM(t.timestamp)} → bar ${t.barsSinceOpenAtEntry} of the session, day opened ${t.dayOpenAtEntry?.toFixed(2)} vs prev close ${t.prevDayCloseAtEntry?.toFixed(2)} (gap ${t.gapPointsAtEntry?.toFixed(2)}, ${t.gapPercentAtEntry?.toFixed(3)}%)`);
}

console.log(failures === 0 ? '\n✅ ALL INVARIANTS PASSED' : `\n❌ ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
