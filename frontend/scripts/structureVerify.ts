// Headless check of the pivot market-structure classifier (src/utils/marketStructure)
// against cached candles in backend/data/backtesting.db.
//
// Usage:
//   npx tsx scripts/structureVerify.ts                       # largest cached series
//   npx tsx scripts/structureVerify.ts --security 13 --segment IDX_I --interval 5 --last 400
//
// Prints:
//   1. the segment list (bar range, IST time, broad · sub, reason, pivots in window)
//   2. regime / sub-regime distribution
//   3. look-ahead check: the state at sampled bars recomputed on a truncated series must
//      equal the state from the full-series pass.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import type { Candle } from '../src/types';
import {
  getStructureSegments,
  getStructureTimeline,
  describeStructure,
} from '../src/utils/marketStructure';
import { defaultAutoBacktestConfig } from '../src/utils/autoBacktestEngine';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, '../../backend/data/backtesting.db');

const argv = process.argv.slice(2);
const get = (f: string) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };

const db = new Database(DB_PATH, { readonly: true });
let security = get('--security'), segment = get('--segment'), interval = get('--interval');
if (!security) {
  const r = db.prepare(`SELECT security_id, exchange_segment, interval, COUNT(*) cnt FROM candles
    GROUP BY 1,2,3 ORDER BY cnt DESC LIMIT 1`).get() as { security_id: string; exchange_segment: string; interval: string };
  security = r.security_id; segment = r.exchange_segment; interval = r.interval;
}
const candles = db.prepare(`SELECT timestamp, open, high, low, close, volume FROM candles
  WHERE security_id=? AND exchange_segment=? AND interval=? ORDER BY timestamp ASC`)
  .all(security, segment, interval) as Candle[];
db.close();
console.log(`${security}/${segment}/${interval}m — ${candles.length} candles`);

const config = defaultAutoBacktestConfig;
const ist = (ts: number) => {
  const ms = ts > 1e12 ? ts : ts * 1000;
  return new Date(ms + 5.5 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
};

const t0 = Date.now();
const states = getStructureTimeline(candles, config);
console.log(`timeline built in ${Date.now() - t0} ms`);

const last = Number(get('--last') ?? 600);
const from = Math.max(0, candles.length - last);
const segs = getStructureSegments(candles, config).filter(s => s.endIndex >= from);
console.log(`\n── segments in the last ${last} bars ──`);
for (const s of segs) {
  const st = states[s.endIndex];
  console.log(
    `${String(s.startIndex).padStart(6)}–${String(s.endIndex).padEnd(6)} ${ist(candles[s.startIndex].timestamp)}  `
    + `${describeStructure(st).padEnd(32)} ${s.transitionReason.padEnd(15)} `
    + `pivots=${String(st.segmentPivots.length).padStart(3)} swings=${String(st.swings.length).padStart(3)} `
    + `box=${st.rangeLow?.toFixed(1) ?? '-'}..${st.rangeHigh?.toFixed(1) ?? '-'} key=${st.keyLevel?.toFixed(1) ?? '-'}`,
  );
}

const dist: Record<string, number> = {};
let maxPivots = 0;
for (const s of states) {
  const k = `${s.broad}${s.confirmed ? '' : '?'} · ${s.sub ?? 'forming'}`;
  dist[k] = (dist[k] ?? 0) + 1;
  maxPivots = Math.max(maxPivots, s.segmentPivots.length);
}
console.log('\n── distribution (bars) ──');
for (const [k, v] of Object.entries(dist).sort((a, b) => b[1] - a[1])) {
  console.log(`${k.padEnd(36)} ${String(v).padStart(7)}  ${(100 * v / states.length).toFixed(1)}%`);
}
const allSegs = getStructureSegments(candles, config);
const ids = new Set(allSegs.map(s => s.segmentId));
console.log(`segments=${ids.size}  runs=${allSegs.length}  max pivots in one window=${maxPivots}`);

// Look-ahead: truncated recompute must match.
let mismatches = 0;
const samples = 25;
for (let k = 1; k <= samples; k++) {
  const idx = Math.floor((candles.length - 1) * k / samples);
  const truncated = candles.slice(0, idx + 1);
  const a = getStructureTimeline(truncated, config)[idx];
  const b = states[idx];
  const same = a.broad === b.broad && a.sub === b.sub && a.confirmed === b.confirmed
    && a.keyLevel === b.keyLevel && a.rangeHigh === b.rangeHigh && a.rangeLow === b.rangeLow
    && a.segmentPivots.length === b.segmentPivots.length;
  if (!same) { mismatches++; console.log(`LOOK-AHEAD MISMATCH at ${idx}: ${describeStructure(a)} vs ${describeStructure(b)}`); }
}
console.log(`\nlook-ahead check: ${samples - mismatches}/${samples} identical`);
