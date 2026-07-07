// Headless auto-backtest config comparison — runs the pure batch simulator
// (frontend/src/utils/batchBacktestSimulator.ts) directly against cached
// candle data in the backend's SQLite cache, without opening the browser.
//
// Usage:
//   npm run backtest:eval
//   npm run backtest:eval -- --security 1333 --segment NSE_EQ --interval 5 --label HDFCBANK
//
// Run with no args to compare against every symbol/interval combination
// currently cached in backend/data/backtesting.db.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { runBatchSimulation, type BatchSimResult } from '../src/utils/batchBacktestSimulator';
import {
  defaultAutoBacktestConfig,
  AUTO_BT_PRESETS,
  type AutoBacktestConfig,
} from '../src/utils/autoBacktestEngine';
import type { Candle } from '../src/types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, '../../backend/data/backtesting.db');

interface SymbolSpec {
  securityId: string;
  exchangeSegment: string;
  interval: string;
  label: string;
}

function parseArgs(argv: string[]): SymbolSpec | null {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const securityId = get('--security');
  if (!securityId) return null;
  return {
    securityId,
    exchangeSegment: get('--segment') ?? 'NSE_EQ',
    interval: get('--interval') ?? '5',
    label: get('--label') ?? securityId,
  };
}

function discoverCachedSymbols(): SymbolSpec[] {
  const db = new Database(DB_PATH, { readonly: true });
  const rows = db
    .prepare(
      `SELECT security_id, exchange_segment, interval, COUNT(*) as cnt
       FROM candles GROUP BY security_id, exchange_segment, interval
       HAVING cnt >= 200 ORDER BY cnt DESC`
    )
    .all() as { security_id: string; exchange_segment: string; interval: string; cnt: number }[];
  db.close();
  return rows.map(r => ({
    securityId: r.security_id,
    exchangeSegment: r.exchange_segment,
    interval: r.interval,
    label: `${r.security_id}/${r.exchange_segment}/${r.interval}m`,
  }));
}

function loadCandles(spec: SymbolSpec): Candle[] {
  const db = new Database(DB_PATH, { readonly: true });
  const rows = db
    .prepare(
      `SELECT timestamp, open, high, low, close, volume FROM candles
       WHERE security_id = ? AND exchange_segment = ? AND interval = ?
       ORDER BY timestamp ASC`
    )
    .all(spec.securityId, spec.exchangeSegment, spec.interval) as Candle[];
  db.close();
  return rows;
}

function summarize(label: string, result: BatchSimResult) {
  const closed = result.trades.filter(t => t.pnl !== undefined);
  const wins = closed.filter(t => (t.pnl ?? 0) > 0);
  const losses = closed.filter(t => (t.pnl ?? 0) <= 0);
  const winRate = closed.length ? (wins.length / closed.length) * 100 : 0;
  const grossWin = wins.reduce((s, t) => s + (t.pnl ?? 0), 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + (t.pnl ?? 0), 0));
  const pf = grossLoss > 0 ? grossWin / grossLoss : closed.length ? Infinity : 0;

  let cum = 0, peak = 0, maxDD = 0;
  for (const t of closed) {
    cum += t.pnl ?? 0;
    peak = Math.max(peak, cum);
    maxDD = Math.min(maxDD, cum - peak);
  }

  const avgWin = wins.length ? grossWin / wins.length : 0;
  const avgLoss = losses.length ? grossLoss / losses.length : 0;

  console.log(
    `${label.padEnd(46)} trades=${String(closed.length).padStart(4)}  win%=${winRate.toFixed(1).padStart(5)}  ` +
    `pnl=${result.totalPnL.toFixed(0).padStart(8)}  PF=${(pf === Infinity ? 'inf' : pf.toFixed(2)).padStart(5)}  ` +
    `avgWin=${avgWin.toFixed(0).padStart(6)}  avgLoss=${avgLoss.toFixed(0).padStart(6)}  maxDD=${maxDD.toFixed(0).padStart(7)}`
  );
}

// Config variants compared against the shipped default for every symbol.
// Add/edit entries here to try new filter combinations without touching the
// harness itself.
function buildVariants(): { label: string; config: AutoBacktestConfig }[] {
  // defaultAutoBacktestConfig.enabled is the UI's master on/off toggle (false
  // out of the box) — every variant here is meant to run, so force it on.
  const base: AutoBacktestConfig = { ...defaultAutoBacktestConfig, enabled: true };
  return [
    { label: 'Default config (as shipped)', config: base },
    { label: 'All Regimes preset', config: { ...base, ...AUTO_BT_PRESETS['All Regimes'] } as AutoBacktestConfig },
    { label: 'Trend Follow preset', config: { ...base, ...AUTO_BT_PRESETS['Trend Follow'] } as AutoBacktestConfig },
    {
      label: '+ strict high-seq persistence (all-HH/all-LH)',
      config: {
        ...base,
        uptrend: { ...base.uptrend, highSeqFilter: 'custom', highSeqPatterns: ['HH-HH-HH-HH'] },
        downtrend: { ...base.downtrend, highSeqFilter: 'custom', highSeqPatterns: ['LH-LH-LH-LH'] },
      },
    },
    {
      label: '+ fast pivot-gap (<=6 bars)',
      config: {
        ...base,
        uptrend: { ...base.uptrend, pivotGapFilter: 'max', pivotGapThreshold: 6 },
        downtrend: { ...base.downtrend, pivotGapFilter: 'max', pivotGapThreshold: 6 },
      },
    },
    {
      label: '+ slow pivot-gap (>=8 bars)',
      config: {
        ...base,
        uptrend: { ...base.uptrend, pivotGapFilter: 'min', pivotGapThreshold: 8 },
        downtrend: { ...base.downtrend, pivotGapFilter: 'min', pivotGapThreshold: 8 },
      },
    },
    {
      label: 'Loosened (no bar-overlap/range/slope gates)',
      config: {
        ...base,
        uptrend: { ...base.uptrend, barOverlapFilter: 'none', barRangeFilter: 'none', ema21SlopeFilter: 'none', ema50SlopeFilter: 'none' },
        downtrend: { ...base.downtrend, barOverlapFilter: 'none', barRangeFilter: 'none', ema21SlopeFilter: 'none', ema50SlopeFilter: 'none' },
      },
    },
    {
      label: '+ strict seq AND fast gap (combo)',
      config: {
        ...base,
        uptrend: { ...base.uptrend, highSeqFilter: 'custom', highSeqPatterns: ['HH-HH-HH-HH'], pivotGapFilter: 'max', pivotGapThreshold: 6 },
        downtrend: { ...base.downtrend, highSeqFilter: 'custom', highSeqPatterns: ['LH-LH-LH-LH'], pivotGapFilter: 'max', pivotGapThreshold: 6 },
      },
    },
  ];
}

function run(spec: SymbolSpec) {
  const candles = loadCandles(spec);
  if (candles.length < 200) {
    console.log(`\nSkipping ${spec.label} — only ${candles.length} candles cached`);
    return;
  }
  console.log(`\n############ ${spec.label} (${candles.length} candles) ############`);
  for (const variant of buildVariants()) {
    summarize(variant.label, runBatchSimulation(candles, variant.config, 60, spec.label, 1, spec.interval));
  }
}

const argSpec = parseArgs(process.argv.slice(2));
const specs = argSpec ? [argSpec] : discoverCachedSymbols();
if (specs.length === 0) {
  console.log('No cached symbols with >=200 candles found in', DB_PATH);
  process.exit(1);
}
for (const spec of specs) run(spec);
