/**
 * Strategy Report — pure analytics behind components/strategy-report/.
 *
 * Turns a run's fills into one row per CLOSED position, attributes each to the regime
 * rule-set, entry-hook stack and exit rule that produced it, and aggregates them. The
 * component scorecard is built from the ACTIVE AutoBacktestConfig, so what is listed is
 * what is configured (a configured component with no trades shows as 0 hits).
 *
 * No React here — everything is a function of (trades, config).
 */
import type { Trade } from '../types';
import { groupTradesIntoPositions } from './tradeAnalysis';
import { computePositionsCharges, toNetPositions, type ChargesConfig } from './charges';
import {
  type AutoBacktestConfig,
  type RegimeKey,
  type RegimeRules,
  REGIME_LABELS,
  entryHookStackIds,
  exitHookStackIds,
} from './autoBacktestEngine';
import { getEntryHookLabel } from '../strategies';
import { getExitHookLabel } from '../strategies/exits';

// ─── Rows ─────────────────────────────────────────────────────────────────────

export interface ReportTrade {
  id: string;
  direction: 'Long' | 'Short';
  regime: string;      // RegimeKey, or 'unattributed'
  trigger: string;     // 'H2', 'L1', 'Pivot', … parsed from the entry reason; '—' when unknown
  entryStack: string;  // hook stack id 'a+b', 'built-in', or '—'
  exitReason: string;  // raw ExitReason
  exitRule: string;    // finer: 'climax', 'double top', 'SL (trailed)', …
  pnl: number;         // net of charges when a ChargesConfig was given
  r: number | null;    // pnl ÷ initial risk (|entry − initial SL| × qty); null without an SL
  barsHeld: number | null;
  entryTs: number;     // ms
  exitTs: number;      // ms
  entryTsSec: number;  // candle-unit timestamp for scrollToTime
  ltMarket: string;
  htMarket: string;
  entryPrice: number;
  exitPrice: number | null;
  qty: number;
  exitDetail: string;
  entryReason: string;
}

const REGIME_BY_LABEL: Record<string, RegimeKey> = Object.fromEntries(
  (Object.entries(REGIME_LABELS) as [RegimeKey, string][]).map(([k, v]) => [v, k])
);

/** Entry reasons look like `Long [Uptrend] H2 | HH-HL | LT:… | HT:… [hook:a+b] | logs`
 *  (autoBacktestEngine evaluateAutoSignals / hookReason). A hook that set its own reason
 *  replaces the head, so regime/trigger may be missing — the stamped fields win anyway. */
export function parseEntryReason(reason: string | undefined): { regime?: RegimeKey; trigger?: string; hookId?: string } {
  if (!reason) return {};
  const head = /^(?:Long|Short)\s+\[([^\]]+)\]\s+([^|\s]+)/.exec(reason);
  const hook = /\[hook:([^\]]+)\]/.exec(reason);
  return {
    regime: head ? REGIME_BY_LABEL[head[1]] : undefined,
    trigger: head?.[2],
    hookId: hook?.[1],
  };
}

const EXIT_REASON_LABEL: Record<string, string> = {
  TP: 'TP hit',
  SL: 'SL',
  REVERSAL: 'Reversal',
  OPP_SIGNAL: 'Opposite signal',
  TRENDLINE_BREAK: 'Trendline break',
  EXIT_HOOK: 'Exit hook',
  LEG_DECAY: 'Leg decay (retired)',
  TIME_OVER: 'Square-off',
  MANUAL: 'Manual',
};

/** Finer exit attribution. Exit-hook details all start with `<rule>: …` (climax:,
 *  climax-body:, climax reversal:, double top:, double bottom:, leg decay:, time stop:). */
export function deriveExitRule(reason: string | undefined, detail: string | undefined, slTrailed?: boolean): string {
  if (!reason) return '—';
  if (reason === 'SL') return slTrailed ? 'SL (trailed)' : 'SL (initial)';
  if (reason === 'EXIT_HOOK') {
    const m = /^\s*([^:|]{1,40}):/.exec(detail ?? '');
    return m ? m[1].trim().toLowerCase() : 'exit hook (other)';
  }
  return EXIT_REASON_LABEL[reason] ?? reason;
}

function intervalMinutes(interval: string | undefined): number | null {
  if (!interval) return null;
  const n = Number(interval);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** One row per CLOSED position. With chargesConfig, pnl (and R) are net of charges. */
export function buildReportRows(trades: Trade[], chargesConfig?: ChargesConfig): ReportTrade[] {
  let positions = groupTradesIntoPositions(trades).filter(p => p.status === 'CLOSED');
  if (chargesConfig) {
    const { byPositionId } = computePositionsCharges(positions, chargesConfig);
    positions = toNetPositions(positions, byPositionId);
  }
  return positions.map(p => {
    const entry = p.executions[0];
    const exit = p.executions[p.executions.length - 1];
    const parsed = parseEntryReason(entry?.journal?.entrySign);
    const regime = entry?.entryRegime ?? parsed.regime ?? 'unattributed';
    const hookId = entry?.entryHookId ?? parsed.hookId;
    const isAuto = !!entry?.journal?.entrySign && entry.journal.tradeCategory === 'System';
    const risk = entry?.stopLoss !== undefined && entry.stopLoss !== null
      ? Math.abs(entry.price - entry.stopLoss) * p.totalQuantity
      : 0;
    const mins = intervalMinutes(entry?.interval);
    const entryTs = p.entryTime;
    return {
      id: p.id,
      direction: p.direction === 'LONG' ? 'Long' : 'Short',
      regime,
      trigger: parsed.trigger ?? '—',
      entryStack: hookId ?? (isAuto ? 'built-in' : '—'),
      exitReason: p.exitReason ?? '—',
      exitRule: deriveExitRule(p.exitReason, exit?.exitDetail, exit?.slTrailed),
      pnl: p.realizedPnL,
      r: risk > 0 ? p.realizedPnL / risk : null,
      barsHeld: mins && p.durationMinutes !== undefined ? Math.round(p.durationMinutes / mins) : null,
      entryTs,
      exitTs: p.exitTime ?? entryTs,
      // executions are normalised to ms; candles are in seconds
      entryTsSec: entryTs > 1e11 ? Math.round(entryTs / 1000) : entryTs,
      ltMarket: entry?.journal?.ltMarket || '—',
      htMarket: entry?.journal?.htMarket || '—',
      entryPrice: p.avgEntryPrice,
      exitPrice: p.avgExitPrice ?? null,
      qty: p.totalQuantity,
      exitDetail: exit?.exitDetail ?? '',
      entryReason: entry?.journal?.entrySign ?? '',
    };
  });
}

// ─── Statistics ───────────────────────────────────────────────────────────────

export interface Stats {
  n: number;
  wins: number;
  losses: number;
  winRate: number;          // 0–100
  ciLow: number;            // Wilson 95% interval on win rate, 0–100
  ciHigh: number;
  net: number;
  avg: number;
  avgWin: number;
  avgLoss: number;          // negative
  grossWin: number;
  grossLoss: number;        // positive
  pf: number;               // Infinity when no losses and some wins; 0 when empty
  avgR: number | null;
  rCount: number;
  maxDD: number;            // positive ₹, from cumulative P&L in exit order
  maxConsecLosses: number;
}

/** Wilson score interval — honest for small n and for win rates near 0/100. */
export function wilson(wins: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 0];
  const p = wins / n;
  const denom = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, ((centre - margin) / denom) * 100), Math.min(100, ((centre + margin) / denom) * 100)];
}

export function computeStats(rows: ReportTrade[]): Stats {
  let wins = 0, grossWin = 0, grossLoss = 0, net = 0, rSum = 0, rCount = 0;
  for (const t of rows) {
    net += t.pnl;
    if (t.pnl > 0) { wins++; grossWin += t.pnl; } else { grossLoss += -t.pnl; }
    if (t.r !== null) { rSum += t.r; rCount++; }
  }
  const n = rows.length;
  const losses = n - wins;
  const [ciLow, ciHigh] = wilson(wins, n);

  let cum = 0, peak = 0, maxDD = 0, run = 0, maxRun = 0;
  for (const t of [...rows].sort((a, b) => a.exitTs - b.exitTs)) {
    cum += t.pnl;
    peak = Math.max(peak, cum);
    maxDD = Math.max(maxDD, peak - cum);
    run = t.pnl > 0 ? 0 : run + 1;
    maxRun = Math.max(maxRun, run);
  }

  return {
    n, wins, losses,
    winRate: n ? (wins / n) * 100 : 0,
    ciLow, ciHigh,
    net,
    avg: n ? net / n : 0,
    avgWin: wins ? grossWin / wins : 0,
    avgLoss: losses ? -grossLoss / losses : 0,
    grossWin, grossLoss,
    pf: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
    avgR: rCount ? rSum / rCount : null,
    rCount,
    maxDD,
    maxConsecLosses: maxRun,
  };
}

/** Below this many trades a row's win rate / PF is noise — the UI badges it. */
export const LOW_SAMPLE = 20;

// ─── Dimensions (slicers, breakdowns, drill-down) ─────────────────────────────

export type DimKey =
  | 'regime' | 'direction' | 'trigger' | 'entryStack' | 'exitRule' | 'exitReason' | 'result'
  | 'year' | 'month' | 'weekday' | 'hour' | 'ltMarket' | 'htMarket' | 'barsHeld' | 'rBucket';

export interface Dimension {
  key: DimKey;
  label: string;
  get: (t: ReportTrade) => string;
  /** Display label for a value. */
  format?: (v: string) => string;
  /** Explicit value order; values not listed sort after, alphabetically. */
  order?: string[];
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const BARS_ORDER = ['1–3', '4–10', '11–25', '26–50', '51+', '—'];
const R_ORDER = ['≤ −1R', '−1R…0', '0…1R', '1R…2R', '2R…3R', '> 3R', '—'];

function barsBucket(b: number | null): string {
  if (b === null) return '—';
  if (b <= 3) return '1–3';
  if (b <= 10) return '4–10';
  if (b <= 25) return '11–25';
  if (b <= 50) return '26–50';
  return '51+';
}

function rBucket(r: number | null): string {
  if (r === null) return '—';
  if (r <= -1) return '≤ −1R';
  if (r <= 0) return '−1R…0';
  if (r <= 1) return '0…1R';
  if (r <= 2) return '1R…2R';
  if (r <= 3) return '2R…3R';
  return '> 3R';
}

export function regimeLabel(v: string): string {
  return REGIME_LABELS[v as RegimeKey] ?? (v === 'unattributed' ? 'Unattributed' : v);
}

/** 'a+b' → 'Label A + Label B'. */
export function stackLabel(v: string): string {
  if (v === 'built-in') return 'Built-in chain';
  if (v === '—') return 'Manual / unknown';
  return v.split('+').map(id => getEntryHookLabel(id) ?? id).join(' + ');
}

export const DIMENSIONS: Record<DimKey, Dimension> = {
  regime: { key: 'regime', label: 'Regime rule-set', get: t => t.regime, format: regimeLabel, order: ['uptrend', 'downtrend', 'range', 'reversal', 'unattributed'] },
  direction: { key: 'direction', label: 'Direction', get: t => t.direction, order: ['Long', 'Short'] },
  trigger: { key: 'trigger', label: 'Entry trigger', get: t => t.trigger },
  entryStack: { key: 'entryStack', label: 'Entry hook stack', get: t => t.entryStack, format: stackLabel },
  exitRule: { key: 'exitRule', label: 'Exit rule', get: t => t.exitRule },
  exitReason: { key: 'exitReason', label: 'Exit reason', get: t => t.exitReason, format: v => EXIT_REASON_LABEL[v] ?? v },
  result: { key: 'result', label: 'Result', get: t => (t.pnl > 0 ? 'Win' : 'Loss'), order: ['Win', 'Loss'] },
  year: { key: 'year', label: 'Year', get: t => String(new Date(t.entryTs).getFullYear()) },
  month: {
    key: 'month', label: 'Month',
    get: t => { const d = new Date(t.entryTs); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; },
  },
  weekday: { key: 'weekday', label: 'Weekday', get: t => WEEKDAYS[new Date(t.entryTs).getDay()], order: WEEKDAYS },
  hour: { key: 'hour', label: 'Entry hour', get: t => `${String(new Date(t.entryTs).getHours()).padStart(2, '0')}:00` },
  ltMarket: { key: 'ltMarket', label: 'LT market', get: t => t.ltMarket },
  htMarket: { key: 'htMarket', label: 'HT market', get: t => t.htMarket },
  barsHeld: { key: 'barsHeld', label: 'Bars held', get: t => barsBucket(t.barsHeld), order: BARS_ORDER },
  rBucket: { key: 'rBucket', label: 'R-multiple', get: t => rBucket(t.r), order: R_ORDER },
};

/** Dimensions offered in the Breakdown picker, in menu order. */
export const BREAKDOWN_DIMS: DimKey[] = [
  'exitRule', 'regime', 'direction', 'trigger', 'entryStack', 'month', 'year', 'weekday', 'hour',
  'barsHeld', 'rBucket', 'ltMarket', 'htMarket', 'exitReason',
];

export function formatDimValue(dim: DimKey, v: string): string {
  return DIMENSIONS[dim].format?.(v) ?? v;
}

export function sortDimValues(dim: DimKey, values: string[]): string[] {
  const order = DIMENSIONS[dim].order;
  return [...values].sort((a, b) => {
    const ia = order ? order.indexOf(a) : -1;
    const ib = order ? order.indexOf(b) : -1;
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    return a.localeCompare(b);
  });
}

export function groupRows(rows: ReportTrade[], dim: DimKey): Map<string, ReportTrade[]> {
  const get = DIMENSIONS[dim].get;
  const map = new Map<string, ReportTrade[]>();
  for (const t of rows) {
    const k = get(t);
    const list = map.get(k);
    if (list) list.push(t); else map.set(k, [t]);
  }
  return map;
}

// ─── Filters ──────────────────────────────────────────────────────────────────

export interface ReportFilter {
  dim: DimKey;
  value: string;
}

export function applyFilters(rows: ReportTrade[], filters: ReportFilter[]): ReportTrade[] {
  if (filters.length === 0) return rows;
  return rows.filter(t => filters.every(f => DIMENSIONS[f.dim].get(t) === f.value));
}

/** Drill-down: add (or replace the same-dimension) filter, keeping order as a breadcrumb. */
export function pushFilters(current: ReportFilter[], add: ReportFilter[]): ReportFilter[] {
  let next = current;
  for (const f of add) {
    const i = next.findIndex(x => x.dim === f.dim);
    next = i === -1 ? [...next, f] : [...next.slice(0, i), f, ...next.slice(i + 1)];
  }
  return next;
}

// ─── Configured components ────────────────────────────────────────────────────

type Cfg = AutoBacktestConfig & Record<string, unknown>;

interface ParamSpec { key: string; label: string; fallback: number | string; suffix?: string }

const CLIMAX_PARAMS: ParamSpec[] = [
  { key: 'climaxExitMultiple', label: 'Multiple', fallback: 4, suffix: '×' },
  { key: 'climaxExitLookback', label: 'Lookback', fallback: 20 },
];
const CLIMAX_REV_PARAMS: ParamSpec[] = [
  { key: 'climaxReversalMultiple', label: 'Multiple', fallback: 4.5, suffix: '×' },
  { key: 'climaxReversalWindow', label: 'Window', fallback: 20 },
  { key: 'climaxExitLookback', label: 'Lookback', fallback: 20 },
];
const DOUBLE_TOP_PARAMS: ParamSpec[] = [
  { key: 'doubleTopMinGap', label: 'Gap', fallback: 25 },
  { key: 'doubleTopMaxGap', label: 'Max gap', fallback: 200 },
  { key: 'doubleTopTolFrac', label: 'Tol', fallback: 0.2 },
  { key: 'doubleTopReversalFrac', label: 'Reversal', fallback: 0.5 },
];

/** Session-Settings parameters that drive each hook / exit rule — shown inline so a row
 *  reads "Climax · Multiple 4× · Lookback 20". Unlisted ids show no parameters. */
const HOOK_PARAMS: Record<string, ParamSpec[]> = {
  'chop-guard': [
    { key: 'chopMinEfficiency', label: 'Min ER', fallback: 0.2 },
    { key: 'chopMinEmaAtr', label: 'Min EMA ATR', fallback: 0.4 },
  ],
  'double-top-guard': DOUBLE_TOP_PARAMS,
  'retrace-guard': [
    { key: 'retraceGuardMinLegPct', label: 'Major leg', fallback: 1.6, suffix: '%' },
    { key: 'retraceGuardFrac', label: 'Frac', fallback: 0.5 },
    { key: 'retraceGuardMaxFrac', label: 'Max frac', fallback: 1.25 },
    { key: 'retraceGuardBullBars', label: 'Bars', fallback: 3 },
    { key: 'retraceGuardBodyMult', label: 'Body', fallback: 1, suffix: '×' },
  ],
};

const RULE_PARAMS: Record<string, ParamSpec[]> = {
  climax: CLIMAX_PARAMS,
  'climax-body': CLIMAX_PARAMS,
  'climax reversal': CLIMAX_REV_PARAMS,
  'double top': DOUBLE_TOP_PARAMS,
  'double bottom': DOUBLE_TOP_PARAMS,
};

/** Exit rules each registered exit hook can emit (the `<rule>:` detail prefixes). */
const EXIT_HOOK_RULES: Record<string, string[]> = {
  'leg-decay': ['leg decay'],
  'climax-profit': ['climax', 'double top', 'double bottom'],
  'climax-profit-body': ['climax-body', 'double top', 'double bottom'],
  'leg-decay-climax': ['climax', 'double top', 'double bottom', 'leg decay'],
  'climax-reversal': ['climax reversal', 'double top', 'double bottom'],
  'leg-decay-climax-reversal': ['climax reversal', 'double top', 'double bottom', 'leg decay'],
  'time-stop': ['time stop'],
};

function formatParams(config: Cfg, specs: ParamSpec[] | undefined): string[] {
  if (!specs) return [];
  return specs.map(s => {
    const raw = config[s.key];
    const v = raw === undefined || raw === null || raw === '' ? s.fallback : raw;
    return `${s.label} ${v}${s.suffix ?? ''}`;
  });
}

export interface ScoreRow {
  key: string;
  label: string;
  /** e.g. 'Primary · gate', 'Guard', 'Built-in', 'Exit hook: Climax Profit'. */
  role: string;
  params: string[];
  /** Filters applied when the row is clicked. Empty = not drillable (guards). */
  drill: ReportFilter[];
  stats: Stats | null;      // null for guards (they block, they don't produce trades)
  blocked?: number | null;  // guards: trigger bars declined in the last run; null = unknown
}

export interface RegimeSection {
  regime: string;
  label: string;
  stats: Stats;
  summary: string[];        // direction, entry mode, SL/TP method — the regime's key config
  entry: ScoreRow[];
  exit: ScoreRow[];
}

function slSummary(r: RegimeRules): string {
  switch (r.slMethod) {
    case 'atr': return `SL ATR×${r.slAtrMultiplier}`;
    case 'fixed': return `SL ${r.slFixedPoints} pts`;
    case 'trendline': return 'SL trendline';
    default: return 'SL pivot';
  }
}

/**
 * The per-regime scorecard, driven by the config: every ENABLED regime, its entry stack
 * (primary + each guard with its block count) and every exit mechanism that can close a
 * trade under it — configured ones listed even at 0 hits, observed-but-unconfigured ones
 * appended so nothing in the trade log is unaccounted for. Trades whose regime is
 * not enabled now (or unknown) get their own section.
 */
export function buildScorecard(
  config: AutoBacktestConfig,
  rows: ReportTrade[],
  /** hookDiagnostics.declines — keyed '<regime>:<hookId>'. */
  declines: Record<string, number> | undefined,
): RegimeSection[] {
  const cfg = config as Cfg;
  const byRegime = groupRows(rows, 'regime');
  const regimes: string[] = (['uptrend', 'downtrend', 'range', 'reversal'] as RegimeKey[]).filter(k => config[k].enabled);
  for (const k of byRegime.keys()) if (!regimes.includes(k)) regimes.push(k);

  return regimes.map(regime => {
    const list = byRegime.get(regime) ?? [];
    const rules: RegimeRules | undefined = (config as unknown as Record<string, RegimeRules>)[regime];
    const isConfigured = !!rules && rules.enabled;
    const regimeFilter: ReportFilter = { dim: 'regime', value: regime };

    // ── Entry ──
    const entry: ScoreRow[] = [];
    const byStack = groupRows(list, 'entryStack');
    const mode = rules?.entryHookMode ?? 'off';
    const configuredIds = isConfigured && mode !== 'off' ? entryHookStackIds(rules!) : [];
    const configuredStack = configuredIds.length ? configuredIds.join('+') : 'built-in';
    if (isConfigured) {
      const stackRows = byStack.get(configuredStack) ?? [];
      entry.push({
        key: `entry:${configuredStack}`,
        label: configuredIds.length ? (getEntryHookLabel(configuredIds[0]) ?? configuredIds[0]) : `Built-in chain · ${rules!.entryMode}`,
        role: configuredIds.length ? `Primary · ${mode}` : 'Built-in',
        params: configuredIds.length ? formatParams(cfg, HOOK_PARAMS[configuredIds[0]]) : [rules!.direction.replace('_', ' ').toLowerCase()],
        drill: [regimeFilter, { dim: 'entryStack', value: configuredStack }],
        stats: computeStats(stackRows),
        blocked: configuredIds.length > 1 ? (declines ? declines[`${regime}:${configuredIds[0]}`] ?? 0 : null) : undefined,
      });
      for (const id of configuredIds.slice(1)) {
        entry.push({
          key: `guard:${id}`,
          label: getEntryHookLabel(id) ?? id,
          role: 'Guard',
          params: formatParams(cfg, HOOK_PARAMS[id]),
          drill: [],
          stats: null,
          blocked: declines ? declines[`${regime}:${id}`] ?? 0 : null,
        });
      }
    }
    for (const [stack, stackRows] of byStack) {
      if (isConfigured && stack === configuredStack) continue;
      entry.push({
        key: `entry:${stack}`,
        label: stackLabel(stack),
        role: 'Not in current config',
        params: [],
        drill: [regimeFilter, { dim: 'entryStack', value: stack }],
        stats: computeStats(stackRows),
      });
    }

    // ── Exit ──
    const exit: ScoreRow[] = [];
    const byRule = groupRows(list, 'exitRule');
    const seen = new Set<string>();
    const addRule = (rule: string, role: string, params: string[] = []) => {
      if (seen.has(rule)) return;
      seen.add(rule);
      exit.push({
        key: `exit:${rule}`,
        label: rule,
        role,
        params,
        drill: [regimeFilter, { dim: 'exitRule', value: rule }],
        stats: computeStats(byRule.get(rule) ?? []),
      });
    };
    if (isConfigured) {
      const r = rules!;
      const exitMode = r.exitHookMode ?? 'off';
      if (exitMode !== 'off') {
        for (const id of exitHookStackIds(r)) {
          const hookLabel = getExitHookLabel(id) ?? id;
          for (const rule of EXIT_HOOK_RULES[id] ?? []) {
            addRule(rule, `Exit hook · ${hookLabel}`, formatParams(cfg, RULE_PARAMS[rule]));
          }
        }
      }
      addRule('TP hit', 'Built-in', [r.targetMode === 'trendline' ? 'target trendline' : `RR ${r.targetRR}`]);
      addRule('SL (initial)', 'Built-in', [slSummary(r)]);
      if (r.exitTrailPivot || r.exitTrailTrendline) {
        addRule('SL (trailed)', 'Built-in', [r.exitTrailPivot ? 'pivot trail' : '', r.exitTrailTrendline ? 'trendline trail' : ''].filter(Boolean));
      }
      if (r.exitOnReversal) addRule('Reversal', 'Built-in', [`confirm ${r.exitReversalConfirmBars ?? 1} bar(s)`]);
      if (r.exitOnOppSignal) addRule('Opposite signal', 'Built-in');
      if (r.exitOnTrendlineBreak) addRule('Trendline break', 'Built-in');
      if (config.autoSquareOff) addRule('Square-off', 'Built-in', [`at ${config.squareOffTime}`]);
    }
    // Anything that closed a trade but is not (or no longer) configured.
    for (const rule of byRule.keys()) addRule(rule, isConfigured ? 'Observed' : 'Not in current config', formatParams(cfg, RULE_PARAMS[rule]));

    const summary = isConfigured
      ? [rules!.direction.replace('_', ' ').toLowerCase(), `entry ${rules!.entryMode}`, slSummary(rules!), `RR ${rules!.targetRR}`]
      : ['not enabled in current config'];

    return { regime, label: regimeLabel(regime), stats: computeStats(list), summary, entry, exit };
  });
}

// ─── Formatting helpers shared by the components ──────────────────────────────

export function fmtMoney(n: number): string {
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${sign}₹${Math.abs(Math.round(n)).toLocaleString('en-IN')}`;
}

export function fmtPF(pf: number): string {
  if (pf === Infinity) return '∞';
  return pf === 0 ? '—' : pf.toFixed(2);
}

export function fmtR(r: number | null): string {
  if (r === null) return '—';
  return `${r >= 0 ? '+' : '−'}${Math.abs(r).toFixed(2)}R`;
}

/** Tailwind text colour for a signed value / a profit factor. */
export function pnlColor(v: number): string {
  return v > 0 ? 'text-green-700' : v < 0 ? 'text-red-600' : 'text-gray-500';
}

export function pfColor(pf: number): string {
  if (pf === 0) return 'text-gray-400';
  return pf >= 1.5 ? 'text-green-700' : pf >= 1 ? 'text-yellow-700' : 'text-red-600';
}
