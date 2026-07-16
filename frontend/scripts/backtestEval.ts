// Headless auto-backtest config comparison — runs the pure batch simulator
// (frontend/src/utils/batchBacktestSimulator.ts) directly against cached
// candle data in the backend's SQLite cache, without opening the browser.
//
// Usage:
//   npm run backtest:eval
//   npm run backtest:eval -- --security 1333 --segment NSE_EQ --interval 5 --label HDFCBANK
//   npm run backtest:eval -- --config ./autobt-config-export.json
//   npm run backtest:eval -- --config cfg.json --sweep-filters
//   npm run backtest:eval -- --config cfg.json --sweep-thresholds efficiencyRatioFilter
//
// --config <path>            use an exported auto-BT config JSON (the UI's Export
//                            button output, or a raw AutoBacktestConfig) as the base
//                            config instead of the shipped defaults. enabled is forced on.
// --sweep-filters            one run per confirmation filter, toggled against the base:
//                            filters that are off get enabled at their UI-default
//                            mode/threshold, active ones get turned off — with
//                            Δtrades/Δpnl/ΔPF vs the baseline so you can see which
//                            filters actually bind on your data.
// --sweep-thresholds <key>   grid-sweep one filter's threshold (see FILTER_DEFS for keys).
//
// Run with no args to compare the hand-written variant list against every
// symbol/interval combination currently cached in backend/data/backtesting.db.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { runBatchSimulation, type BatchSimResult } from '../src/utils/batchBacktestSimulator';
import {
  defaultAutoBacktestConfig,
  AUTO_BT_PRESETS,
  type AutoBacktestConfig,
  type RegimeRules,
  type RegimeKey,
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

interface CliOptions {
  spec: SymbolSpec | null;
  configPath?: string;
  sweepFilters: boolean;
  sweepThresholdsKey?: string;
}

function parseArgs(argv: string[]): CliOptions {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const securityId = get('--security');
  const spec: SymbolSpec | null = securityId
    ? {
        securityId,
        exchangeSegment: get('--segment') ?? 'NSE_EQ',
        interval: get('--interval') ?? '5',
        label: get('--label') ?? securityId,
      }
    : null;
  return {
    spec,
    configPath: get('--config'),
    sweepFilters: argv.includes('--sweep-filters'),
    sweepThresholdsKey: get('--sweep-thresholds'),
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

// Accepts either the UI Export wrapper ({ name, exportedAt, config }) or a raw
// AutoBacktestConfig. enabled is forced on — it's the UI master toggle, and a
// headless eval that silently produced zero trades because it was off would be
// misleading.
function loadBaseConfig(configPath: string): AutoBacktestConfig {
  const raw = JSON.parse(fs.readFileSync(path.resolve(configPath), 'utf8'));
  const config = (raw && typeof raw === 'object' && 'config' in raw ? raw.config : raw) as AutoBacktestConfig;
  if (!config || typeof config !== 'object' || !('uptrend' in config)) {
    console.error(`--config file ${configPath} doesn't look like an auto-BT config (no "uptrend" rules found)`);
    process.exit(1);
  }
  return { ...config, enabled: true };
}

interface RowStats {
  trades: number;
  pnl: number;
  pf: number;
}

function computeStats(result: BatchSimResult): RowStats & { winRate: number; avgWin: number; avgLoss: number; maxDD: number } {
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
  return { trades: closed.length, pnl: result.totalPnL, pf, winRate, avgWin, avgLoss, maxDD };
}

function summarize(label: string, result: BatchSimResult, baseline?: RowStats): RowStats {
  const s = computeStats(result);
  const fmtPf = (pf: number) => (pf === Infinity ? 'inf' : pf.toFixed(2));
  let line =
    `${label.padEnd(46)} trades=${String(s.trades).padStart(4)}  win%=${s.winRate.toFixed(1).padStart(5)}  ` +
    `pnl=${s.pnl.toFixed(0).padStart(8)}  PF=${fmtPf(s.pf).padStart(5)}  ` +
    `avgWin=${s.avgWin.toFixed(0).padStart(6)}  avgLoss=${s.avgLoss.toFixed(0).padStart(6)}  maxDD=${s.maxDD.toFixed(0).padStart(7)}`;
  if (baseline) {
    const dTrades = s.trades - baseline.trades;
    const dPnl = s.pnl - baseline.pnl;
    const dPf = s.pf === Infinity || baseline.pf === Infinity ? NaN : s.pf - baseline.pf;
    const sign = (v: number) => (v > 0 ? `+${v}` : `${v}`);
    line += `  | Δtrades=${sign(dTrades).padStart(4)}  Δpnl=${(dPnl > 0 ? '+' : '') + dPnl.toFixed(0)}  ΔPF=${Number.isNaN(dPf) ? '  n/a' : (dPf > 0 ? '+' : '') + dPf.toFixed(2)}`;
  }
  console.log(line);
  return s;
}

// ─── Confirmation-filter sweep definitions ─────────────────────────────────────
// defaultMode/defaultThreshold mirror the UI defaults in RegimeWorkflowSteps.tsx /
// the passesXxx gate fallbacks — keep in sync when those change.

type FilterModeKey =
  | 'efficiencyRatioFilter' | 'barOverlapFilter' | 'barRangeFilter' | 'barBreakFilter'
  | 'consecutiveBreakFilter' | 'ema21SlopeFilter' | 'ema50SlopeFilter'
  | 'ema20GapBarFilter' | 'ema20BiasFilter' | 'atrDepthFilter' | 'pivotGapFilter';

interface FilterDef {
  modeKey: FilterModeKey;
  thresholdKey: keyof RegimeRules;
  defaultMode: NonNullable<RegimeRules[FilterModeKey]>;
  defaultThreshold: number;
  grid: number[];
}

const gridRange = (from: number, to: number, step: number) => {
  const out: number[] = [];
  for (let v = from; v <= to + 1e-9; v += step) out.push(Number(v.toFixed(4)));
  return out;
};

const FILTER_DEFS: FilterDef[] = [
  { modeKey: 'efficiencyRatioFilter', thresholdKey: 'efficiencyRatioThreshold', defaultMode: 'min', defaultThreshold: 0.3, grid: gridRange(0.1, 0.9, 0.1) },
  { modeKey: 'barOverlapFilter', thresholdKey: 'barOverlapThreshold', defaultMode: 'max', defaultThreshold: 0.4, grid: gridRange(0.2, 0.8, 0.1) },
  { modeKey: 'barRangeFilter', thresholdKey: 'barRangeDominanceThreshold', defaultMode: 'dominance', defaultThreshold: 1.0, grid: gridRange(0.8, 2.0, 0.2) },
  { modeKey: 'barBreakFilter', thresholdKey: 'barBreakThreshold', defaultMode: 'min', defaultThreshold: 5, grid: gridRange(2, 10, 1) },
  { modeKey: 'consecutiveBreakFilter', thresholdKey: 'consecutiveBreakThreshold', defaultMode: 'min', defaultThreshold: 4, grid: gridRange(2, 8, 1) },
  { modeKey: 'ema21SlopeFilter', thresholdKey: 'ema21SlopeThreshold', defaultMode: 'min', defaultThreshold: 0, grid: gridRange(-0.2, 0.4, 0.1) },
  { modeKey: 'ema50SlopeFilter', thresholdKey: 'ema50SlopeThreshold', defaultMode: 'min', defaultThreshold: 0, grid: gridRange(-0.2, 0.4, 0.1) },
  { modeKey: 'ema20GapBarFilter', thresholdKey: 'ema20GapBarThreshold', defaultMode: 'min', defaultThreshold: 0.5, grid: gridRange(0.2, 0.8, 0.1) },
  { modeKey: 'ema20BiasFilter', thresholdKey: 'ema20BiasThreshold', defaultMode: 'min', defaultThreshold: 0.5, grid: gridRange(0.2, 0.8, 0.1) },
  { modeKey: 'atrDepthFilter', thresholdKey: 'atrDepthThreshold', defaultMode: 'max', defaultThreshold: 1.5, grid: gridRange(0.5, 3, 0.5) },
  { modeKey: 'pivotGapFilter', thresholdKey: 'pivotGapThreshold', defaultMode: 'max', defaultThreshold: 5, grid: gridRange(3, 10, 1) },
];

const REGIME_KEYS: RegimeKey[] = ['uptrend', 'downtrend', 'range', 'reversal'];

const enabledRegimes = (config: AutoBacktestConfig): RegimeKey[] =>
  REGIME_KEYS.filter(k => config[k].enabled);

function describeActiveFilters(config: AutoBacktestConfig): string {
  const parts: string[] = [];
  for (const regime of enabledRegimes(config)) {
    const rules = config[regime];
    const active = FILTER_DEFS
      .filter(d => (rules[d.modeKey] ?? 'none') !== 'none')
      .map(d => `${d.modeKey}=${rules[d.modeKey]}@${rules[d.thresholdKey] ?? d.defaultThreshold}`);
    parts.push(`${regime}: ${active.length ? active.join(', ') : '(no confirmation filters active)'}`);
  }
  return parts.join('\n  ');
}

// One variant per filter: enable it (at the regime's saved threshold, else the UI
// default) where it's off, disable it where it's active — per enabled regime.
function buildFilterSweepVariants(base: AutoBacktestConfig): { label: string; config: AutoBacktestConfig }[] {
  const variants: { label: string; config: AutoBacktestConfig }[] = [
    { label: 'Baseline (your config)', config: base },
  ];
  for (const def of FILTER_DEFS) {
    const config: AutoBacktestConfig = { ...base };
    const actions = new Set<string>();
    for (const regime of enabledRegimes(base)) {
      const rules = base[regime];
      const currentMode = rules[def.modeKey] ?? 'none';
      if (currentMode === 'none') {
        const threshold = (rules[def.thresholdKey] as number | undefined) ?? def.defaultThreshold;
        config[regime] = { ...rules, [def.modeKey]: def.defaultMode, [def.thresholdKey]: threshold } as RegimeRules;
        actions.add(`ON ${def.defaultMode}@${threshold}`);
      } else {
        config[regime] = { ...rules, [def.modeKey]: 'none' } as RegimeRules;
        actions.add('OFF');
      }
    }
    variants.push({ label: `${[...actions].join('/')} → ${def.modeKey}`, config });
  }
  return variants;
}

function buildThresholdSweepVariants(base: AutoBacktestConfig, key: string): { label: string; config: AutoBacktestConfig }[] {
  const def = FILTER_DEFS.find(d => d.modeKey === key);
  if (!def) {
    console.error(`Unknown filter key "${key}". Valid keys:\n  ${FILTER_DEFS.map(d => d.modeKey).join('\n  ')}`);
    process.exit(1);
  }
  const variants: { label: string; config: AutoBacktestConfig }[] = [
    { label: `Baseline (${def.modeKey} as configured)`, config: base },
  ];
  for (const t of def.grid) {
    const config: AutoBacktestConfig = { ...base };
    for (const regime of enabledRegimes(base)) {
      config[regime] = { ...base[regime], [def.modeKey]: def.defaultMode, [def.thresholdKey]: t } as RegimeRules;
    }
    variants.push({ label: `${def.modeKey} ${def.defaultMode} @ ${t}`, config });
  }
  return variants;
}

// Hand-written variant list compared when no --config/--sweep flags are given.
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

function run(spec: SymbolSpec, variants: { label: string; config: AutoBacktestConfig }[], withDeltas: boolean) {
  const candles = loadCandles(spec);
  if (candles.length < 200) {
    console.log(`\nSkipping ${spec.label} — only ${candles.length} candles cached`);
    return;
  }
  console.log(`\n############ ${spec.label} (${candles.length} candles) ############`);
  let baseline: RowStats | undefined;
  for (const variant of variants) {
    const result = runBatchSimulation(candles, variant.config, 60, spec.label, 1, spec.interval);
    const stats = summarize(variant.label, result, withDeltas ? baseline : undefined);
    if (withDeltas && !baseline) baseline = stats; // first row is the baseline
  }
}

const cli = parseArgs(process.argv.slice(2));
const specs = cli.spec ? [cli.spec] : discoverCachedSymbols();
if (specs.length === 0) {
  console.log('No cached symbols with >=200 candles found in', DB_PATH);
  process.exit(1);
}

let variants: { label: string; config: AutoBacktestConfig }[];
let withDeltas = false;
if (cli.configPath) {
  const base = loadBaseConfig(cli.configPath);
  console.log(`Base config: ${cli.configPath}`);
  console.log(`  ${describeActiveFilters(base)}`);
  if (cli.sweepThresholdsKey) {
    variants = buildThresholdSweepVariants(base, cli.sweepThresholdsKey);
    withDeltas = true;
  } else if (cli.sweepFilters) {
    variants = buildFilterSweepVariants(base);
    withDeltas = true;
  } else {
    variants = [{ label: 'User config (as exported)', config: base }];
  }
} else if (cli.sweepFilters || cli.sweepThresholdsKey) {
  const base: AutoBacktestConfig = { ...defaultAutoBacktestConfig, enabled: true };
  console.log('No --config given — sweeping against the shipped default config.');
  console.log(`  ${describeActiveFilters(base)}`);
  variants = cli.sweepThresholdsKey
    ? buildThresholdSweepVariants(base, cli.sweepThresholdsKey)
    : buildFilterSweepVariants(base);
  withDeltas = true;
} else {
  variants = buildVariants();
}

for (const spec of specs) run(spec, variants, withDeltas);
