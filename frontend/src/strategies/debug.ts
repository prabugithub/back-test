/**
 * Debugging aids for writing an entry hook.
 *
 * Load the app with `?debugHook` first — that makes the batch run happen on the MAIN
 * thread. Without it the simulation runs in a Web Worker and `debugger` never pauses your
 * devtools (the classic "trades appear but my breakpoint never hits").
 *
 * Two workflows, and the second is usually the one you want:
 *
 *   1. PAUSE on an interesting bar
 *
 *        import { pauseWhen } from './debug';
 *        export const myHook: EntryHook = ctx => {
 *          pauseWhen(ctx.trigger.count === 3 && ctx.ltMarket.startsWith('Bull'), ctx);
 *          ...
 *        };
 *
 *      A bare `debugger` stops on the very first trigger bar, of which there are
 *      thousands. A condition is what makes stepping usable.
 *
 *   2. COLLECT the whole run, then look at it as a table
 *
 *        import { probe } from './debug';
 *        export const myHook: EntryHook = ctx => {
 *          probe(ctx, { myScore: someNumber });   // call unconditionally
 *          return false;                          // take no trades while exploring
 *        };
 *
 *      Run the backtest, then in the console:
 *
 *        __hook.table()                  // every trigger bar, one row
 *        __hook.rows.length              // how many bars reached your hook
 *        __hook.where(r => r.count >= 3) // filter, then .table() the result
 *        __hook.stats('brrAvg')          // min/p25/median/p75/max of one column
 *        __hook.ctx                      // the LAST full context object, live
 *        __hook.csv()                    // copy out to a spreadsheet
 *
 *      This answers "what do these values actually look like on my data" far faster than
 *      stepping. Rows reset automatically at the start of each run.
 */
import type { EntryHookContext } from '../utils/entryHook';

export interface ProbeRow {
  bar: number;
  time: string;
  label: string;
  count: number;
  side: 'long' | 'short';
  regime: string;
  ltMarket: string;
  htMarket: string;
  pivotSeq: string;
  close: number;
  atr: number;
  emaGap: number | null;
  legBars: number | null;
  brrAvg: number | null;
  effRatio: number | null;
  overlap: number | null;
  ema21Slope: number | null;
  [extra: string]: unknown;
}

const round = (v: number | undefined | null, dp = 3): number | null =>
  v === undefined || v === null || !Number.isFinite(v) ? null : Number(v.toFixed(dp));

class HookProbeStore {
  rows: ProbeRow[] = [];
  /** The most recent full context — inspect anything the flat row does not carry. */
  ctx: EntryHookContext | null = null;
  /** Identity of the run's scratch object; a new one means a new run, so rows reset. */
  private runToken: object | null = null;

  begin(ctx: EntryHookContext) {
    if (this.runToken !== ctx.state) {
      this.runToken = ctx.state;
      this.rows = [];
    }
    this.ctx = ctx;
  }

  table(rows: ProbeRow[] = this.rows) {
    console.table(rows);
    return `${rows.length} rows`;
  }

  where(fn: (r: ProbeRow) => boolean): ProbeRow[] {
    return this.rows.filter(fn);
  }

  /** Distribution of one column — the fastest way to pick a threshold that isn't a guess. */
  stats(key: string) {
    const vals = this.rows
      .map(r => r[key])
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
      .sort((a, b) => a - b);
    if (vals.length === 0) return `no numeric values for "${key}"`;
    const q = (p: number) => vals[Math.min(vals.length - 1, Math.floor(p * vals.length))];
    return { n: vals.length, min: vals[0], p25: q(0.25), median: q(0.5), p75: q(0.75), max: vals[vals.length - 1] };
  }

  /** Tab-separated, ready to paste into a spreadsheet. */
  csv(rows: ProbeRow[] = this.rows): string {
    if (rows.length === 0) return '';
    const keys = Object.keys(rows[0]);
    // Returned, not logged: dumping thousands of lines into the console is useless, and
    // Chrome's `copy(__hook.csv())` puts it straight on the clipboard instead.
    const out = [keys.join('\t'), ...rows.map(r => keys.map(k => String(r[k] ?? '')).join('\t'))].join('\n');
    return out;
  }

  clear() { this.rows = []; this.ctx = null; this.runToken = null; }

}

const store = new HookProbeStore();

/** The same object exposed as `window.__hook`. Exported so it is importable from a headless
 *  script (and from the smoke harness, which is how this file stays honest). */
export const hookProbeStore = store;

declare global {
  interface Window { __hook: HookProbeStore }
}
if (typeof window !== 'undefined') window.__hook = store;

/**
 * Record one flat row per call, plus keep the live context. Cheap enough to call on every
 * trigger bar. Anything you pass as `extra` becomes extra columns — that is where you put
 * the intermediate values of the logic you are trying to frame.
 */
export function probe(ctx: EntryHookContext, extra?: Record<string, unknown>): void {
  store.begin(ctx);
  const m = ctx.metrics;
  store.rows.push({
    bar: ctx.absoluteIndex,
    time: new Date(ctx.candle.timestamp * 1000).toLocaleString('en-IN', { hour12: false }),
    label: ctx.trigger.label,
    count: ctx.trigger.count,
    side: ctx.trigger.side,
    regime: ctx.regime,
    ltMarket: ctx.ltMarket,
    htMarket: ctx.htMarket,
    pivotSeq: ctx.pivotSeq,
    close: round(ctx.candle.close, 2)!,
    atr: round(ctx.atr, 2)!,
    emaGap: ctx.ema21 === null ? null : round(ctx.candle.close - ctx.ema21, 2),
    legBars: ctx.legWindow ? ctx.legWindow.endIndex - ctx.legWindow.startIndex + 1 : null,
    brrAvg: round(m.brrAvg),
    effRatio: round(m.efficiencyRatio),
    overlap: round(m.barOverlapAvg),
    ema21Slope: round(m.ema21Slope),
    ...extra,
  });
}

/**
 * Conditional breakpoint. Pauses only when `cond` holds, so you land on a bar you actually
 * care about instead of the first one. `ctx` is captured on `__hook.ctx` first, so it is
 * inspectable even after you resume.
 *
 * Requires the app to be loaded with `?debugHook` — otherwise this runs on the worker
 * thread and the pause is invisible.
 */
export function pauseWhen(cond: boolean, ctx: EntryHookContext): void {
  store.begin(ctx);
  if (!cond) return;
  // eslint-disable-next-line no-debugger
  debugger;
}
