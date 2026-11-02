// Pivot trendlines — the major sloped support / resistance lines as of one bar.
//
// Every pair of same-type swing points in the window is a candidate line (highs →
// resistance, lows → support). A candidate survives only if price still respects it:
// at most `maxViolations` closes beyond it since its first touch, and never the current
// bar's close. Survivors are scored on touches, span, the size of the reactions off each
// touch, recency and cleanliness (wick pierces); near-identical lines (same price at the
// current bar within the touch tolerance) collapse to the best one.
//
// Pivots only — the tolerance is a fraction of the window's median swing, no ATR / EMA.
// Look-ahead safe: only pivots fired on or before `index` and candles ≤ `index` are read,
// so the result at bar i is identical whether the series ends at i or later.

import type { Candle } from '../../types';
import type { AutoBacktestConfig } from '../autoBacktestEngine';
import { getPivotPointsUpTo } from '../indicators';
import { buildSwings, median } from './swings';
import type { SwingPoint } from './types';

export interface TrendlineParams {
  degree: number;         // swing degree: 1 = every swing, 2 = swings of swings, …
  windowPivots: number;   // swing points (highs + lows) at that degree the candidate lines are built from
  tolFrac: number;        // touch / break tolerance as a fraction of the window's median swing
  maxViolations: number;  // closes beyond the line (since its first touch) still tolerated
  minTouches: number;     // swing points within tolerance a line needs to be kept
  topN: number;           // lines kept per side
}

export type TrendlineConfig = Pick<AutoBacktestConfig,
  | 'trendlineDegree' | 'trendlineWindowPivots' | 'trendlineTolFrac' | 'trendlineMaxViolations'
  | 'trendlineMinTouches' | 'trendlineTopN' | 'minPivotGapBars'>;

export interface TrendlineParamDef {
  key: keyof TrendlineConfig;
  label: string;
  title: string;
  min: number;
  max: number;
  step: number;
  def: number;
}

/** Single table shared by resolveTrendlineParams (clamping) and Session Settings (inputs). */
export const TRENDLINE_PARAM_DEFS: readonly TrendlineParamDef[] = [
  { key: 'trendlineDegree', label: 'Swing degree', min: 1, max: 4, step: 1, def: 2,
    title: 'Which swings the lines are drawn through. 1 = every pivot swing (short-term lines). 2 = major swings only: a high above the swing highs either side of it, a low below the swing lows either side of it. 3–4 repeat that filter for longer-term lines (higher on lower timeframes: 2 suits 15m, 3 suits 5m for multi-day lines). Window, tolerance and touches are measured at this degree; a side with no line at this degree falls back one degree at a time.' },
  { key: 'trendlineWindowPivots', label: 'Window (pivots)', min: 10, max: 80, step: 1, def: 30,
    title: 'How many recent swing points (highs + lows) at the chosen degree candidate trendlines are drawn through. Larger = longer-term lines.' },
  { key: 'trendlineTolFrac', label: 'Touch tolerance (× median swing)', min: 0.02, max: 0.5, step: 0.01, def: 0.1,
    title: 'A swing point within this fraction of the window\'s median swing size of the line counts as a touch; a close further beyond it counts as a violation.' },
  { key: 'trendlineMaxViolations', label: 'Max closes through', min: 0, max: 5, step: 1, def: 0,
    title: 'Closes beyond the line (past the tolerance) since its first touch that are still allowed. The current bar\'s close beyond the line always breaks it.' },
  { key: 'trendlineMinTouches', label: 'Min touches', min: 2, max: 6, step: 1, def: 2,
    title: 'Swing points on the line (within tolerance) needed to show it. 3+ is a confirmed line; 2 shows the best two-point lines too (scored lower).' },
  { key: 'trendlineTopN', label: 'Lines per side', min: 1, max: 5, step: 1, def: 2,
    title: 'Highest-scoring resistance lines and support lines kept, after merging near-duplicates.' },
];

function clamp(v: number | undefined, def: TrendlineParamDef): number {
  const raw = v ?? def.def;
  if (!Number.isFinite(raw)) return def.def;
  return Math.min(def.max, Math.max(def.min, raw));
}

export function resolveTrendlineParams(config: Partial<TrendlineConfig>): TrendlineParams {
  const d = Object.fromEntries(TRENDLINE_PARAM_DEFS.map(p => [p.key, p])) as Record<string, TrendlineParamDef>;
  return {
    degree: Math.floor(clamp(config.trendlineDegree, d.trendlineDegree)),
    windowPivots: Math.floor(clamp(config.trendlineWindowPivots, d.trendlineWindowPivots)),
    tolFrac: clamp(config.trendlineTolFrac, d.trendlineTolFrac),
    maxViolations: Math.floor(clamp(config.trendlineMaxViolations, d.trendlineMaxViolations)),
    minTouches: Math.floor(clamp(config.trendlineMinTouches, d.trendlineMinTouches)),
    topN: Math.floor(clamp(config.trendlineTopN, d.trendlineTopN)),
  };
}

export interface Trendline {
  side: 'resistance' | 'support';
  degree: number;         // swing degree the line was built at (≤ the requested one)
  slope: number;          // price per bar
  intercept: number;      // price at bar 0 — priceAt(bar) = intercept + slope × bar
  priceNow: number;       // line price at the evaluated bar
  firstBar: number;       // earliest touch
  lastTouchBar: number;
  touchPoints: Array<{ bar: number; price: number }>;
  touches: number;
  violations: number;     // closes beyond line + tolerance since the first touch
  pierces: number;        // wicks beyond line + tolerance since the first touch
  reaction: number;       // mean swing leaving each touch ÷ median swing
  span: number;           // (lastTouchBar − firstBar) ÷ window bars
  score: number;
  distance: number;       // (close − priceNow) ÷ median swing; + above the line
  medianSwing: number;    // median swing size at the line's degree
  tolerance: number;      // touch / break band of this line = tolFrac × medianSwing
  slopeNorm: number;      // net progress per swing cycle (up + down swing), in median swings
}

export interface TrendlineState {
  barIndex: number;
  medianSwing: number;
  tolerance: number;      // tolFrac × medianSwing
  resistance: Trendline[]; // best first
  support: Trendline[];
}

export function trendlinePriceAt(line: Pick<Trendline, 'slope' | 'intercept'>, bar: number): number {
  return line.intercept + line.slope * bar;
}

/** One degree up: keep a high (low) only if it is above (below) the previous same-type point
 *  and at least as high (low) as the next one — a swing of swings. Needing the NEXT point
 *  makes it confirmed by data already on the chart, so it stays look-ahead safe; the newest
 *  point of each type waits until the following one prints. Re-alternated with mergePoint. */
function raiseDegree(points: readonly SwingPoint[]): SwingPoint[] {
  const keep = new Set<SwingPoint>();
  for (const type of ['high', 'low'] as const) {
    const same = points.filter(p => p.type === type);
    for (let i = 1; i + 1 < same.length; i++) {
      const [a, p, b] = [same[i - 1], same[i], same[i + 1]];
      if (type === 'high' ? p.price > a.price && p.price >= b.price : p.price < a.price && p.price <= b.price) keep.add(p);
    }
  }
  const out: SwingPoint[] = [];
  for (const p of points) if (keep.has(p)) pushMerged(out, p);
  return out;
}

/** In-place mergePoint without a cap — consecutive same-type points keep the more extreme. */
function pushMerged(out: SwingPoint[], sp: SwingPoint): void {
  const last = out[out.length - 1];
  if (!last || last.type !== sp.type) out.push(sp);
  else if (sp.type === 'high' ? sp.price > last.price : sp.price < last.price) out[out.length - 1] = sp;
}

/** Swing points per degree (index 0 = degree 1), each cut to the last `windowPivots`, and
 *  re-anchored to the true extreme of each swing. A pivot's price is its signal bar's
 *  low/high, which can sit a bar or two after the real turn; the extreme between the
 *  previous opposite point and the pivot's own bar is fully known by then. Each degree keeps
 *  roughly a third of the points, so the base is scaled by 3^(degree−1) to still yield
 *  ~windowPivots points at the top degree. */
function windowLevels(candles: Candle[], index: number, minGapBars: number, windowPivots: number, degree: number): SwingPoint[][] {
  const baseCap = windowPivots * 3 ** (degree - 1) + 1;
  const pivots = getPivotPointsUpTo(candles, index, minGapBars);
  // Merging only ever shrinks the sequence, so twice the cap in raw pivots is plenty.
  let raw: SwingPoint[] = [];
  for (const pv of pivots.slice(-2 * baseCap)) {
    pushMerged(raw, {
      type: pv.type === 'bearish' ? 'high' : 'low',
      price: pv.price, barIndex: pv.barIndex, time: pv.time, label: pv.trendLabel,
    });
  }
  if (raw.length > baseCap) raw = raw.slice(raw.length - baseCap);

  // Most extreme high (low) over bars [from, to], starting from `init`.
  const ext = (high: boolean, from: number, to: number, init: { price: number; bar: number }) => {
    let { price, bar } = init;
    for (let x = from; x <= to; x++) {
      const v = high ? candles[x].high : candles[x].low;
      if (high ? v > price : v < price) { price = v; bar = x; }
    }
    return { price, bar };
  };
  const at = (p: SwingPoint, e: { price: number; bar: number }): SwingPoint =>
    ({ ...p, price: e.price, barIndex: e.bar, time: candles[e.bar].timestamp });

  // Zigzag repair. Each point is searched from the previous point's RE-ANCHORED bar, and the
  // previous point moves forward when price went further its way before this swing's extreme.
  // The pivot detector can skip a turn — e.g. a gap-down low followed by a rally fires the
  // next HIGH pivot with no low in between — and that low is often the major one.
  let prev = raw[0];
  const out: SwingPoint[] = [];
  for (let k = 1; k < raw.length; k++) {
    const p = raw[k];
    const high = p.type === 'high';
    let cur = ext(high, prev.barIndex + 1, p.barIndex, { price: p.price, bar: p.barIndex });
    const further = ext(!high, prev.barIndex + 1, cur.bar - 1, { price: prev.price, bar: prev.barIndex });
    if (further.bar !== prev.barIndex) {
      prev = at(prev, further);
      if (out.length) out[out.length - 1] = prev;
      cur = ext(high, prev.barIndex + 1, p.barIndex, { price: p.price, bar: p.barIndex });
    }
    prev = at(p, cur);
    out.push(prev);
  }
  const cut = (pts: SwingPoint[]) => (pts.length > windowPivots ? pts.slice(pts.length - windowPivots) : pts);
  const levels = [out];
  for (let d = 1; d < degree; d++) levels.push(raiseDegree(levels[d - 1]));
  return levels.map(cut);
}

function medianSwingOf(points: readonly SwingPoint[]): number {
  return median(buildSwings(points).map(s => s.size));
}

function sideLines(
  side: Trendline['side'],
  candles: Candle[],
  index: number,
  points: readonly SwingPoint[],
  medianSwing: number,
  tol: number,
  p: TrendlineParams,
  degree: number,
): Trendline[] {
  const res = side === 'resistance';
  const sgn = res ? 1 : -1; // "beyond" = above for resistance, below for support
  const want = res ? 'high' : 'low';
  const idx: number[] = [];
  points.forEach((pt, k) => { if (pt.type === want) idx.push(k); });
  const windowBars = Math.max(1, index - points[0].barIndex);
  const close = candles[index].close;
  const swingBars = median(buildSwings(points).map(s => s.bars));

  // Size of the swing leaving point k — the next opposite point, or for the newest point
  // the furthest price has travelled away from it so far.
  const reactionOf = (k: number): number => {
    if (k + 1 < points.length) return Math.abs(points[k + 1].price - points[k].price);
    let ext = points[k].price;
    for (let x = points[k].barIndex + 1; x <= index; x++) {
      const v = res ? candles[x].low : candles[x].high;
      if (res ? v < ext : v > ext) ext = v;
    }
    return Math.abs(points[k].price - ext);
  };

  const out: Trendline[] = [];
  for (let a = 0; a < idx.length; a++) {
    for (let b = a + 1; b < idx.length; b++) {
      const A = points[idx[a]], B = points[idx[b]];
      const slope = (B.price - A.price) / (B.barIndex - A.barIndex);
      const intercept = A.price - slope * A.barIndex;
      const at = (x: number) => intercept + slope * x;
      if (sgn * (close - at(index)) > tol) continue; // broken now

      const touchK = idx.filter(k => Math.abs(points[k].price - at(points[k].barIndex)) <= tol);
      if (touchK.length < p.minTouches) continue;
      const firstBar = points[touchK[0]].barIndex;
      const lastTouchBar = points[touchK[touchK.length - 1]].barIndex;

      let violations = 0, pierces = 0;
      for (let x = firstBar; x <= index && violations <= p.maxViolations; x++) {
        const line = at(x);
        if (sgn * (candles[x].close - line) > tol) violations++;
        if (sgn * ((res ? candles[x].high : candles[x].low) - line) > tol) pierces++;
      }
      if (violations > p.maxViolations) continue;

      const reaction = touchK.reduce((s, k) => s + reactionOf(k), 0) / touchK.length / medianSwing;
      const span = (lastTouchBar - firstBar) / windowBars;
      const recency = Math.min(1, (index - lastTouchBar) / windowBars);
      // Touches dominate (squared — a third touch is what confirms a line); span, reaction size
      // and recency scale it; closes and wicks through the line cut it. Fixed weights — the
      // user-facing knobs are the bounds above.
      const score = touchK.length ** 2 * (0.5 + span) * (0.5 + Math.min(reaction, 2) / 2) * (1 - 0.5 * recency)
        / (1 + violations + 0.25 * pierces);
      const priceNow = at(index);
      out.push({
        side, degree, slope, intercept, priceNow, firstBar, lastTouchBar,
        touchPoints: touchK.map(k => ({ bar: points[k].barIndex, price: points[k].price })),
        touches: touchK.length, violations, pierces, reaction, span, score,
        distance: (close - priceNow) / medianSwing,
        medianSwing, tolerance: tol, slopeNorm: (slope * 2 * swingBars) / medianSwing,
      });
    }
  }

  out.sort((x, y) => y.score - x.score);
  const kept: Trendline[] = [];
  for (const l of out) {
    if (kept.length >= p.topN) break;
    if (kept.some(k => Math.abs(k.priceNow - l.priceNow) <= tol)) continue;
    kept.push(l);
  }
  return kept;
}

const cache = new WeakMap<Candle[], Map<string, Map<number, TrendlineState>>>();

/** Major trendlines as of bar `index`. Empty sides until the window holds two swings. */
export function findTrendlinesAt(candles: Candle[], index: number, minGapBars: number, p: TrendlineParams): TrendlineState {
  const key = [minGapBars, p.degree, p.windowPivots, p.tolFrac, p.maxViolations, p.minTouches, p.topN].join('|');
  let byKey = cache.get(candles);
  if (!byKey) { byKey = new Map(); cache.set(candles, byKey); }
  let byIndex = byKey.get(key);
  if (!byIndex) { byIndex = new Map(); byKey.set(key, byIndex); }
  const hit = byIndex.get(index);
  if (hit) return hit;

  const levels = windowLevels(candles, index, minGapBars, p.windowPivots, p.degree);
  // Each side is built at the highest degree ≤ the requested one that yields a line, its
  // tolerance scaled to that degree. A clean trend has no degree-2 lows (every low is higher
  // than the last), so its support falls back to the pullback lows below instead of vanishing.
  const side = (s: Trendline['side']): Trendline[] => {
    const type = s === 'resistance' ? 'high' : 'low';
    for (let d = levels.length - 1; d >= 0; d--) {
      if (levels[d].filter(pt => pt.type === type).length < p.minTouches) continue;
      const ms = medianSwingOf(levels[d]);
      const lines = ms > 0 ? sideLines(s, candles, index, levels[d], ms, p.tolFrac * ms, p, d + 1) : [];
      if (lines.length > 0) return lines;
    }
    return [];
  };
  const medianSwing = medianSwingOf(levels[levels.length - 1]) || medianSwingOf(levels[0]);
  const state: TrendlineState = {
    barIndex: index, medianSwing, tolerance: p.tolFrac * medianSwing,
    resistance: side('resistance'), support: side('support'),
  };
  byIndex.set(index, state);
  return state;
}

// ─── Trend strength ───────────────────────────────────────────────────────────

export type ChannelShape = 'parallel' | 'converging' | 'expanding';

export interface TrendStrength {
  dir: 'up' | 'down' | 'flat';
  /** The with-trend line the read is based on: rising support (up), falling resistance
   *  (down), else the better-scoring of the two (flat). Null without any line. */
  line: Trendline | null;
  slopeNorm: number;
  touches: number;
  /** Best support vs best resistance width, first-common-touch → now. Null without both. */
  channel: ChannelShape | null;
  /** How far price has run from the with-trend line, in median swings. Null when flat. */
  extension: number | null;
  /** 0–1: min(steepness, 1) × min(touches, 4)/4, cut 30% when the channel converges (a wedge — the trend is
   *  running out of room). Fixed weights. */
  strength: number;
  /** strength signed by direction: + up, − down, 0 flat. */
  dirStrength: number;
}

/** A line is flat when it moves less than its own tolerance across its span — the same
 *  "within one buffer" reading the structure classifier uses for flat edges. */
function isFlat(l: Trendline, index: number): boolean {
  return Math.abs(l.slope) * Math.max(1, index - l.firstBar) <= l.tolerance;
}

export function trendStrength(state: TrendlineState, close: number): TrendStrength {
  const i = state.barIndex;
  const sup = state.support[0] ?? null;
  const res = state.resistance[0] ?? null;
  const upLine = sup && sup.slope > 0 && !isFlat(sup, i) ? sup : null;
  const downLine = res && res.slope < 0 && !isFlat(res, i) ? res : null;

  let dir: TrendStrength['dir'] = 'flat';
  let line: Trendline | null = null;
  if (upLine && downLine) {
    // Rising support AND falling resistance = a converging triangle; the stronger line leads.
    line = upLine.score >= downLine.score ? upLine : downLine;
    dir = line === upLine ? 'up' : 'down';
  } else if (upLine) { line = upLine; dir = 'up'; }
  else if (downLine) { line = downLine; dir = 'down'; }
  else if (sup || res) line = !res || (sup && sup.score >= res.score) ? sup : res;

  let channel: ChannelShape | null = null;
  if (sup && res) {
    const x0 = Math.max(sup.firstBar, res.firstBar);
    const w0 = trendlinePriceAt(res, x0) - trendlinePriceAt(sup, x0);
    const w1 = res.priceNow - sup.priceNow;
    const band = Math.max(sup.tolerance, res.tolerance);
    channel = w1 < w0 - band ? 'converging' : w1 > w0 + band ? 'expanding' : 'parallel';
  }

  const extension = line && dir !== 'flat'
    ? (dir === 'up' ? close - line.priceNow : line.priceNow - close) / line.medianSwing
    : null;
  const strength = line && dir !== 'flat'
    ? Math.min(Math.abs(line.slopeNorm), 1) * (Math.min(line.touches, 4) / 4) * (channel === 'converging' ? 0.7 : 1)
    : 0;
  return {
    dir, line, slopeNorm: line?.slopeNorm ?? 0, touches: line?.touches ?? 0, channel, extension,
    strength, dirStrength: dir === 'up' ? strength : dir === 'down' ? -strength : 0,
  };
}

// ─── Setups ───────────────────────────────────────────────────────────────────

export type TrendlineSetupKind = 'bounce' | 'break_retest' | 'failed_break';

export interface TrendlineSetup {
  kind: TrendlineSetupKind;
  side: 'long' | 'short';
  line: Trendline;     // the line as of the state it was found in
  linePrice: number;   // that line's price at the evaluated bar
  /** Where a trendline stop sits beyond: the line (bounce, retest) or the failed
   *  excursion's extreme (failed break). The stop adds the line's tolerance past it. */
  anchor: number;
  eventBar: number;    // touch (bounce), retest, or close back inside (failed break)
}

/**
 * The setup of `kind` at bar `index`, for each side, looking back `bars` bars. `zone` scales
 * the line's tolerance into the touch band. Reads only states and candles ≤ index.
 *
 *  bounce        long: a current rising/flat support was touched (low within the zone) in
 *                the window and still holds. Short: falling/flat resistance, mirrored.
 *  break_retest  long: a resistance line from a recent state was closed through, then a
 *                later bar came back to it (low within the zone) and every close since the
 *                break held above it. Short mirrors on support.
 *  failed_break  long: a support line from a recent state was closed below, then price
 *                closed back above it and is still above — the breakout failed, fade it.
 *                Short mirrors on resistance.
 */
export function findTrendlineSetup(
  candles: Candle[],
  index: number,
  minGapBars: number,
  p: TrendlineParams,
  kind: TrendlineSetupKind,
  bars: number,
  zone: number,
): { long: TrendlineSetup | null; short: TrendlineSetup | null } {
  const from = Math.max(0, index - bars + 1);
  const close = candles[index].close;

  const bounce = (side: 'long' | 'short'): TrendlineSetup | null => {
    const long = side === 'long';
    const st = findTrendlinesAt(candles, index, minGapBars, p);
    for (const l of long ? st.support : st.resistance) {
      if (long ? l.slope < 0 && !isFlat(l, index) : l.slope > 0 && !isFlat(l, index)) continue; // counter-trend line
      const band = zone * l.tolerance;
      for (let x = index; x >= Math.max(from, l.firstBar); x--) {
        const at = trendlinePriceAt(l, x);
        if (long ? candles[x].low <= at + band : candles[x].high >= at - band) {
          return { kind: 'bounce', side, line: l, linePrice: l.priceNow, anchor: l.priceNow, eventBar: x };
        }
      }
    }
    return null;
  };

  // Lines of `lineSide` from the states at the window's earlier bars, newest state first.
  // A line usually survives in many consecutive states; `seen` skips repeats.
  const recentLines = (lineSide: 'support' | 'resistance'): Trendline[] => {
    const out: Trendline[] = [];
    const seen = new Set<string>();
    for (let j = index - 1; j >= Math.max(0, index - bars); j--) {
      for (const l of findTrendlinesAt(candles, j, minGapBars, p)[lineSide]) {
        const k = `${l.slope.toFixed(6)}|${l.intercept.toFixed(2)}`;
        if (!seen.has(k)) { seen.add(k); out.push(l); }
      }
    }
    return out;
  };

  const breakRetest = (side: 'long' | 'short'): TrendlineSetup | null => {
    const long = side === 'long';
    const sgn = long ? 1 : -1; // the new side of the broken line: above for long
    for (const l of recentLines(long ? 'resistance' : 'support')) {
      const tol = l.tolerance, band = zone * tol;
      const at = (x: number) => trendlinePriceAt(l, x);
      let brk = -1;
      for (let x = from; x <= index; x++) if (sgn * (candles[x].close - at(x)) > tol) { brk = x; break; }
      if (brk < 0 || brk === index) continue;
      let retest = -1, held = true;
      for (let x = brk + 1; x <= index && held; x++) {
        if (sgn * (candles[x].close - at(x)) < -tol) held = false;
        else if (retest < 0 && (long ? candles[x].low <= at(x) + band : candles[x].high >= at(x) - band)) retest = x;
      }
      if (!held || retest < 0 || sgn * (close - at(index)) <= 0) continue;
      return { kind: 'break_retest', side, line: l, linePrice: at(index), anchor: at(index), eventBar: retest };
    }
    return null;
  };

  const failedBreak = (side: 'long' | 'short'): TrendlineSetup | null => {
    const long = side === 'long';
    const sgn = long ? -1 : 1; // the direction the failed break went: below support for a long
    for (const l of recentLines(long ? 'support' : 'resistance')) {
      const tol = l.tolerance;
      const at = (x: number) => trendlinePriceAt(l, x);
      let brk = -1;
      for (let x = from; x <= index; x++) if (sgn * (candles[x].close - at(x)) > tol) { brk = x; break; }
      if (brk < 0 || brk === index) continue;
      let back = -1;
      for (let x = brk + 1; x <= index; x++) if (sgn * (candles[x].close - at(x)) < 0) { back = x; break; }
      if (back < 0 || sgn * (close - at(index)) >= 0) continue;
      let ext = long ? Infinity : -Infinity;
      for (let x = brk; x <= index; x++) ext = long ? Math.min(ext, candles[x].low) : Math.max(ext, candles[x].high);
      return { kind: 'failed_break', side, line: l, linePrice: at(index), anchor: ext, eventBar: back };
    }
    return null;
  };

  const f = kind === 'bounce' ? bounce : kind === 'break_retest' ? breakRetest : failedBreak;
  return { long: f('long'), short: f('short') };
}
