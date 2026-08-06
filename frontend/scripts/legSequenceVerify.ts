// One-off verification for the legSequenceAtEntry feature (Phase 1).
// Runs the REAL batch simulator over cached candles and asserts the invariants
// of every trade's legSequenceAtEntry, then repeats for detail='avg'.
//   npx tsx scripts/legSequenceVerify.ts
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { runBatchSimulation } from '../src/utils/batchBacktestSimulator';
import { buildLegSequence } from '../src/utils/legSequence';
import { defaultAutoBacktestConfig, type AutoBacktestConfig } from '../src/utils/autoBacktestEngine';
import type { Candle, LegSegment } from '../src/types';

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

// Assert the invariants that matter for "pullbacks covered, nothing missed".
function checkSequence(seq: LegSegment[], entryIndex: number, detail: 'full' | 'avg', tag: string) {
  if (seq.length === 0) return; // early-session entries can legitimately have none
  // The array is returned newest→oldest; verify order-agnostically by sorting a copy
  // chronologically first.
  const chrono = [...seq].sort((a, b) => a.startIndex - b.startIndex);
  // 0. First array element must be the newest (closest to entry).
  if (seq[0] !== chrono[chrono.length - 1]) {
    fail(`${tag}: index 0 is not the newest segment (expected newest→oldest order)`);
  }
  // 1. Contiguity: each segment starts exactly where the previous ended + 1.
  for (let i = 1; i < chrono.length; i++) {
    if (chrono[i].startIndex !== chrono[i - 1].endIndex + 1) {
      fail(`${tag}: gap/overlap between chrono seg ${i - 1} (…${chrono[i - 1].endIndex}) and ${i} (${chrono[i].startIndex}…)`);
    }
  }
  // 2. Newest segment reaches the entry bar (context is current, not stale).
  if (chrono[chrono.length - 1].endIndex !== entryIndex) {
    fail(`${tag}: newest segment ends at ${chrono[chrono.length - 1].endIndex}, expected entry bar ${entryIndex}`);
  }
  for (const s of seq) {
    // 3. No degenerate ranges.
    if (s.barCount <= 0 || s.endIndex < s.startIndex) fail(`${tag}: bad range ${s.startIndex}…${s.endIndex}`);
    if (s.barCount !== s.endIndex - s.startIndex + 1) fail(`${tag}: barCount mismatch on ${s.kind}`);
    // 4. Detail mode contract.
    if (detail === 'full') {
      if (!s.brr || s.brr.length !== s.barCount) fail(`${tag}: full mode brr length ${s.brr?.length} != barCount ${s.barCount}`);
      if (!s.bullBear || s.bullBear.length !== s.barCount) fail(`${tag}: full mode bullBear length ${s.bullBear?.length} != barCount ${s.barCount}`);
      if (s.bullBear && s.bullBear.reduce((n, v) => n + v, 0) !== s.bullCount) {
        fail(`${tag}: bullCount ${s.bullCount} != sum(bullBear) ${s.bullBear.reduce((n, v) => n + v, 0)}`);
      }
    } else if (s.brr !== undefined || s.bullBear !== undefined) {
      fail(`${tag}: avg mode should not carry per-candle arrays`);
    }
    // 4b. bullCount is always present and within the segment's bar range.
    if (!Number.isInteger(s.bullCount) || s.bullCount < 0 || s.bullCount > s.barCount) {
      fail(`${tag}: bullCount ${s.bullCount} out of [0, ${s.barCount}]`);
    }
    // 5. Averages finite & in range.
    for (const v of [s.brrAvg, s.clvAvg, s.uwrAvg, s.lwrAvg]) {
      if (!Number.isFinite(v) || v < -1e-9 || v > 1 + 1e-9) fail(`${tag}: avg out of [0,1]: ${v}`);
    }
  }
  // 6. Consecutive LEG segments must alternate direction (pullbacks sit between them).
  const legs = seq.filter(s => s.kind === 'leg');
  for (let i = 1; i < legs.length; i++) {
    if (legs[i].direction === legs[i - 1].direction) {
      // Not strictly guaranteed (overlap-clamping can drop a leg), so warn only.
      console.warn(`  ! ${tag}: two consecutive legs same direction (${legs[i].direction}) — check overlap handling`);
    }
  }
}

const config: AutoBacktestConfig = { ...defaultAutoBacktestConfig, enabled: true };

for (const detail of ['full', 'avg'] as const) {
  const candles = loadCandles('1333');
  const cfg = { ...config, legSequenceDetail: detail, legSequenceCount: 10 };
  const result = runBatchSimulation(candles, cfg, 60, 'HDFCBANK', 1, '5');
  const entries = result.trades.filter(t => t.legSequenceAtEntry && t.legSequenceAtEntry.length);
  const withSeq = result.trades.filter(t => t.legSequenceAtEntry !== undefined).length;
  console.log(`\n=== detail='${detail}': ${result.trades.length} trades, ${withSeq} carry a sequence field ===`);

  let maxLegs = 0;
  for (const t of result.trades) {
    if (!t.legSequenceAtEntry) continue;
    // Recover the entry bar index from the trade's own frozen leg fields if present,
    // else find it by timestamp; simplest is to rebuild the expected sequence and
    // compare against the stamped one using the trade timestamp → candle index.
    const entryIndex = candles.findIndex(c => c.timestamp === t.timestamp);
    if (entryIndex < 0) { fail(`trade ts ${t.timestamp} not found in candles`); continue; }
    checkSequence(t.legSequenceAtEntry, entryIndex, detail, `trade@${entryIndex}`);
    const legCount = t.legSequenceAtEntry.filter(s => s.kind === 'leg').length;
    maxLegs = Math.max(maxLegs, legCount);
    if (legCount > (cfg.legSequenceCount ?? 10)) fail(`trade@${entryIndex}: ${legCount} legs > cap ${cfg.legSequenceCount}`);
  }
  console.log(`  entries with a sequence: ${entries.length}, max legs seen: ${maxLegs} (cap ${cfg.legSequenceCount})`);

  // Print one representative full example.
  if (detail === 'full' && entries.length) {
    const ex = entries[Math.floor(entries.length / 2)];
    const eIdx = candles.findIndex(c => c.timestamp === ex.timestamp);
    console.log(`\n  Example ${ex.type} @ bar ${eIdx} — ${ex.legSequenceAtEntry!.length} segments:`);
    for (const s of ex.legSequenceAtEntry!) {
      console.log(
        `    ${s.kind.padEnd(8)} ${s.direction.padEnd(4)} bars ${String(s.startIndex).padStart(4)}-${String(s.endIndex).padStart(4)} ` +
        `(${String(s.barCount).padStart(2)})  move ${s.movePct.toFixed(2).padStart(6)}%  ` +
        `brr ${s.brrAvg.toFixed(2)} clv ${s.clvAvg.toFixed(2)}  H/L ${s.highBreakCount}/${s.lowBreakCount}  ` +
        `bull ${s.bullCount}/${s.barCount}` +
        (s.bullBear ? `  [${s.bullBear.join('')}]` : '')
      );
    }
  }
}

// Direct builder spot-check independent of the engine: contiguity + pullback coverage.
{
  const candles = loadCandles('1333');
  const idx = 800;
  const seq = buildLegSequence(candles, idx, 10, 'full');
  console.log(`\n=== direct buildLegSequence(idx=${idx}): ${seq.length} segments ===`);
  checkSequence(seq, idx, 'full', `direct@${idx}`);
  const chrono = [...seq].sort((a, b) => a.startIndex - b.startIndex);
  const covered = chrono.length ? chrono[chrono.length - 1].endIndex - chrono[0].startIndex + 1 : 0;
  const spanSum = seq.reduce((n, s) => n + s.barCount, 0);
  console.log(`  covered span ${chrono[0]?.startIndex}..${chrono[chrono.length - 1]?.endIndex} = ${covered} bars, Σ barCount = ${spanSum} (must be equal → no gaps/overlaps)`);
  if (covered !== spanSum) fail('direct: span sum != covered span (gap or overlap!)');
}

console.log(failures === 0 ? '\n✅ ALL INVARIANTS PASSED' : `\n❌ ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
