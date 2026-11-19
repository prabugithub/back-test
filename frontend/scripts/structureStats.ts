// Headless market-structure statistics (src/utils/marketStructure/stats.ts) over cached
// candles in backend/data/backtesting.db — cross-check for the Structure Stats page.
//
// Usage:
//   npx tsx scripts/structureStats.ts                        # largest cached series
//   npx tsx scripts/structureStats.ts --security 13 --segment IDX_I --interval 5
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import type { Candle } from '../src/types';
import {
  computeStructureStats, getStructureSegments, getStructureTimeline, summarize, transitionMatrix,
  type EpisodeStat,
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
const ist = (ts: number) => new Date((ts > 1e12 ? ts : ts * 1000) + 5.5 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
const states = getStructureTimeline(candles, config);
const t0 = Date.now();
const st = computeStructureStats(candles, states);
console.log(`stats built in ${Date.now() - t0} ms`);

// Invariants.
const barSum = st.barsByBroad.up + st.barsByBroad.down + st.barsByBroad.range;
const labelled = st.episodes.reduce((t, e) => t + e.labelledBars, 0);
const segIds = new Set(getStructureSegments(candles, config).map(s => s.segmentId)).size;
console.log(`bars: up=${st.barsByBroad.up} down=${st.barsByBroad.down} range=${st.barsByBroad.range} sum=${barSum} (candles ${candles.length}) ${barSum === candles.length ? 'OK' : 'MISMATCH'}`);
console.log(`episode labelled bars sum=${labelled} ${labelled === candles.length ? 'OK' : 'MISMATCH'}; episodes=${st.episodes.length} segmentIds=${segIds} ${st.episodes.length === segIds ? 'OK' : 'MISMATCH'}`);

const f = (n: number) => n.toFixed(1);
const line = (label: string, v: number[]) => {
  const d = summarize(v);
  console.log(`  ${label.padEnd(18)} n=${d.n} mean=${f(d.mean)} median=${f(d.median)} p25=${f(d.p25)} p75=${f(d.p75)} max=${f(d.max)} sum=${f(d.sum)}`);
};
for (const b of ['up', 'down', 'range'] as const) {
  const eps = st.episodes.filter(e => e.broad === b);
  console.log(`\n── ${b.toUpperCase()} (${eps.length}) ──`);
  line('span bars', eps.map(e => e.spanBars));
  line('labelled bars', eps.map(e => e.labelledBars));
  line('confirm lag', eps.map(e => e.confirmLag));
  line(b === 'range' ? 'height' : 'move', eps.map(e => e.move));
  if (b !== 'range') {
    line('capturable', eps.map(e => e.capturable));
    line('giveback', eps.flatMap(e => e.giveback ?? []));
    line('opp. max', eps.map(e => e.oppositeMax));
    line('opp. sum', eps.map(e => e.oppositeSum));
  } else {
    line('failed BO', eps.map(e => e.failedBreakouts));
  }
}
console.log('\n── transitions ──');
console.log(transitionMatrix(st.episodes));

const top = (title: string, eps: EpisodeStat[], val: (e: EpisodeStat) => number) => {
  console.log(`\n── ${title} ──`);
  for (const e of [...eps].sort((a, b) => val(b) - val(a)).slice(0, 10)) {
    console.log(`  #${String(e.segmentId).padEnd(5)} ${ist(candles[e.anchorBar].timestamp)}  ${f(val(e)).padStart(9)}  span=${e.spanBars} sub=${e.dominantSub}`);
  }
};
top('top up moves', st.episodes.filter(e => e.broad === 'up'), e => e.move);
top('top down moves', st.episodes.filter(e => e.broad === 'down'), e => e.move);
top('worst pullback in up trends', st.episodes.filter(e => e.broad === 'up'), e => e.oppositeMax);
top('worst pullback in down trends', st.episodes.filter(e => e.broad === 'down'), e => e.oppositeMax);
