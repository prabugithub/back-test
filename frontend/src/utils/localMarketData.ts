import type { Candle } from '../types';
import { parseColumnarData, resampleCandles, type ColumnarData } from './resampler';

/**
 * Registry of bundled market-data files in `assets/market-data/`.
 *
 * Every `*.json` dropped into that folder is discovered at build time and lazy-loaded
 * on demand (one chunk per file), so adding an instrument needs no code change.
 *
 * Naming convention: `<NAME>_<N>minute.json` → label "NAME" (underscores → spaces),
 * base timeframe N minutes. Files that don't follow it get their base timeframe
 * detected from the data on load.
 *
 * Two on-disk formats are accepted:
 *  - columnar `{ t, o, h, l, c, v }` — epoch seconds already shifted +5:30 (legacy Nifty file)
 *  - rows `[{ date: "YYYY-MM-DD HH:mm:ss", open, high, low, close, volume }]` — IST wall-clock
 * Both are normalized to true UTC epoch seconds, matching API candles and `resampler.ts`.
 */

const IST_OFFSET = 19800;
const PATH_PREFIX = '../assets/market-data/';

// nifty50.json (1-minute, ~100 MB) is excluded: never used, and would bloat the build.
const loaders = import.meta.glob(
  ['../assets/market-data/*.json', '!../assets/market-data/nifty50.json'],
  { import: 'default' },
) as Record<string, () => Promise<unknown>>;

/** The original Nifty 50 5-minute file — default, and the fallback for sessions saved before dataset selection existed. */
export const LEGACY_DATASET_ID = 'nifty5min_data';

export interface LocalDataset {
  id: string;
  label: string;
  /** Native bar size in minutes; null when the filename doesn't say (detected on load). */
  baseMinutes: number | null;
}

function describe(id: string): LocalDataset {
  if (id === LEGACY_DATASET_ID) return { id, label: 'NIFTY 50', baseMinutes: 5 };
  const m = id.match(/^(.+)_(\d+)minute$/i);
  if (m) return { id, label: m[1].replace(/_/g, ' '), baseMinutes: Number(m[2]) };
  return { id, label: id.replace(/_/g, ' '), baseMinutes: null };
}

const loaderById = new Map<string, () => Promise<unknown>>(
  Object.entries(loaders).map(([path, load]) => [path.slice(PATH_PREFIX.length, -'.json'.length), load]),
);

export const LOCAL_DATASETS: LocalDataset[] = [...loaderById.keys()]
  .map(describe)
  .sort((a, b) =>
    a.id === LEGACY_DATASET_ID ? -1 : b.id === LEGACY_DATASET_ID ? 1 : a.label.localeCompare(b.label),
  );

export function getLocalDataset(id: string | undefined): LocalDataset {
  return LOCAL_DATASETS.find(d => d.id === (id || LEGACY_DATASET_ID)) ?? describe(id || LEGACY_DATASET_ID);
}

/** Interval string used across the app ('5', '15', '60', '1D', …) → minutes. */
export function intervalToMinutes(interval: string): number {
  if (interval === '1D' || interval === '1440') return 1440;
  const n = Number(interval);
  return Number.isFinite(n) && n > 0 ? n : 5;
}

/** Instrument label stored on the session and stamped on trades. */
export function localInstrumentLabel(datasetId: string | undefined, interval: string): string {
  return `${getLocalDataset(datasetId).label} (Local ${interval})`;
}

const ROW_DATE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/;

function parseRows(rows: any[]): Candle[] {
  const out: Candle[] = [];
  for (const r of rows) {
    const m = typeof r?.date === 'string' ? r.date.match(ROW_DATE) : null;
    if (!m) continue;
    // IST wall-clock → UTC epoch seconds, independent of the browser's timezone.
    const istSeconds = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0)) / 1000;
    out.push({
      timestamp: istSeconds - IST_OFFSET,
      open: +r.open,
      high: +r.high,
      low: +r.low,
      close: +r.close,
      volume: +(r.volume ?? 0),
    });
  }
  return out;
}

function parseRaw(raw: any): Candle[] {
  if (Array.isArray(raw)) return parseRows(raw);
  if (raw && raw.t && raw.o && raw.h && raw.l && raw.c && raw.v) {
    // Legacy columnar file is already offset by +5:30 — shift back to true UTC.
    return parseColumnarData(raw as ColumnarData, -IST_OFFSET);
  }
  throw new Error('Unrecognized data format (expected columnar {t,o,h,l,c,v} or rows with a "date" field)');
}

/** Smallest positive gap between the first bars, in minutes. */
function detectBaseMinutes(candles: Candle[]): number {
  let min = Infinity;
  for (let i = 1; i < Math.min(candles.length, 200); i++) {
    const d = candles[i].timestamp - candles[i - 1].timestamp;
    if (d > 0 && d < min) min = d;
  }
  return Number.isFinite(min) ? Math.max(1, Math.round(min / 60)) : 1;
}

export interface LocalLoadResult {
  candles: Candle[];
  /** Interval actually produced — raised to the dataset's base when a lower one was requested. */
  interval: string;
  /** True when the requested interval was below the dataset's native bar size. */
  clamped: boolean;
  dataset: LocalDataset;
}

/**
 * Load a bundled dataset, filter to [fromDate, toDate] (inclusive, YYYY-MM-DD), and
 * resample to `interval`. A finer interval than the data's native bars cannot be
 * produced, so it is raised to the base and reported via `clamped`.
 */
export async function loadLocalCandles(
  datasetId: string | undefined,
  interval: string,
  fromDate?: string,
  toDate?: string,
): Promise<LocalLoadResult> {
  const id = datasetId || LEGACY_DATASET_ID;
  const load = loaderById.get(id);
  if (!load) throw new Error(`Local dataset "${id}" not found in assets/market-data`);

  let candles = parseRaw(await load());
  candles.sort((a, b) => a.timestamp - b.timestamp);

  const known = getLocalDataset(id);
  const baseMinutes = known.baseMinutes ?? detectBaseMinutes(candles);
  const dataset = { ...known, baseMinutes };

  if (fromDate) {
    const fromTs = new Date(fromDate).getTime() / 1000;
    candles = candles.filter(c => c.timestamp >= fromTs);
  }
  if (toDate) {
    const toTs = new Date(toDate).getTime() / 1000 + 86400; // include the end date fully
    candles = candles.filter(c => c.timestamp < toTs);
  }

  const requested = intervalToMinutes(interval);
  const clamped = requested < baseMinutes;
  const target = clamped ? baseMinutes : requested;
  const effectiveInterval = clamped ? (baseMinutes === 1440 ? '1D' : String(baseMinutes)) : interval;

  return {
    candles: target === baseMinutes ? candles : resampleCandles(candles, target),
    interval: effectiveInterval,
    clamped,
    dataset,
  };
}
