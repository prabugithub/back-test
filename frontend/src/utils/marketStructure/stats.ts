// Descriptive statistics over the pivot market-structure timeline — what the structure itself
// did (counts, durations, moves, pullbacks, transitions), not trade results.
//
// One episode = one segmentId. Everything is pivot-derived except the closes used for the
// net / capturable / giveback figures (the close is what the classifier validates against).
// Pure: reads the shared, immutable StructureState objects and never mutates them.

import type { Candle } from '../../types';
import { buildSwings, mean, median, quantile } from './swings';
import type { StructureBroad, StructureEvidence, StructureState, StructureSub, Swing, SwingPoint } from './types';

/** Sub bucket: a named sub-regime, or 'forming' while the segment has too few swings. */
export type SubKey = StructureSub | 'forming';

export interface SubRun { sub: SubKey; bars: number }

export interface EpisodeStat {
  segmentId: number;
  broad: StructureBroad;
  /** True for the last episode — it has no break of structure / breakout yet. */
  open: boolean;
  /** First / last bar the timeline labelled with this segment (causal). */
  labelStart: number;
  labelEnd: number;
  labelledBars: number;
  /** Anchor swing point the segment was born from (hindsight start). */
  anchorBar: number;
  anchorPrice: number;
  /** Hindsight span: anchor → next episode's anchor (or the last bar when open). */
  spanEnd: number;
  spanBars: number;
  /** Bars the label trails the anchor (labelStart − anchorBar). */
  confirmLag: number;
  /** Trend: extreme swing point in the trend direction (range: unused, = anchor). */
  extremeBar: number;
  extremePrice: number;
  /** Trend: |extreme − anchor| (points / %). Range: box height. */
  move: number;
  movePct: number;
  /** Signed in the trend direction: last close − anchor (down trends flipped). Range: last close − anchor. */
  netMove: number;
  /** Trend: extreme vs the close on the confirmation bar, signed in the trend direction. */
  capturable: number;
  capturablePct: number;
  /** Trend: |extreme − last close| — given back before the break of structure. Null when open. */
  giveback: number | null;
  /** Counter-trend swings ending on/before the extreme (in-trend pullbacks). */
  oppositeCount: number;
  oppositeSum: number;
  oppositeMax: number;
  oppositeMaxPct: number;
  oppositeMaxBar: number | null;
  /** Deepest pullback ÷ the impulse before it. */
  worstRetrace: number | null;
  impulseCount: number;
  avgImpulse: number;
  /** |anchor → last close| ÷ Σ swing sizes — 1 = straight line, → 0 = choppy. */
  efficiency: number | null;
  /** Range box over all the episode's swing points. */
  rangeHigh: number | null;
  rangeLow: number | null;
  failedBreakouts: number;
  prevBroad: StructureBroad | null;
  nextBroad: StructureBroad | null;
  dominantSub: SubKey;
  finalSub: SubKey;
  subPath: SubRun[];
  points: SwingPoint[];
  swings: Swing[];
  evidence: StructureEvidence;
}

export interface DistSummary { n: number; mean: number; median: number; p25: number; p75: number; min: number; max: number; sum: number }

export interface StructureStats {
  totalBars: number;
  /** Per-bar label counts (causal): exact, sum to totalBars. */
  barsByBroad: Record<StructureBroad, number>;
  barsBySub: Record<StructureBroad, Partial<Record<SubKey, number>>>;
  episodes: EpisodeStat[];
}

const subKey = (s: StructureSub | null): SubKey => s ?? 'forming';

/** Uncapped mirror of the timeline's mergePoint (collapse same-type to the more extreme). */
function merge(points: SwingPoint[], sp: SwingPoint): void {
  const last = points[points.length - 1];
  if (last && last.barIndex === sp.barIndex && last.type === sp.type) return;
  if (last && last.type === sp.type) {
    const more = sp.type === 'high' ? sp.price > last.price : sp.price < last.price;
    if (more) points[points.length - 1] = sp;
    return;
  }
  points.push(sp);
}

interface Acc {
  first: StructureState;
  last: StructureState;
  start: number;
  end: number;
  points: SwingPoint[];
  lastRef: readonly SwingPoint[];
  runs: SubRun[];
}

export function computeStructureStats(
  candles: Candle[], states: readonly StructureState[], endIndex?: number,
): StructureStats {
  const end = Math.min(states.length - 1, endIndex ?? states.length - 1);
  const barsByBroad: Record<StructureBroad, number> = { up: 0, down: 0, range: 0 };
  const barsBySub: StructureStats['barsBySub'] = { up: {}, down: {}, range: {} };
  const accs: Acc[] = [];
  let cur: Acc | null = null;

  for (let i = 0; i <= end; i++) {
    const s = states[i];
    if (!s) continue;
    const sk = subKey(s.sub);
    barsByBroad[s.broad]++;
    barsBySub[s.broad][sk] = (barsBySub[s.broad][sk] ?? 0) + 1;

    if (!cur || cur.first.segmentId !== s.segmentId) {
      cur = { first: s, last: s, start: i, end: i, points: [...s.segmentPivots], lastRef: s.segmentPivots, runs: [] };
      accs.push(cur);
    } else if (s.segmentPivots !== cur.lastRef) {
      const p = s.segmentPivots[s.segmentPivots.length - 1];
      if (p) merge(cur.points, p);
      cur.lastRef = s.segmentPivots;
    }
    cur.last = s;
    cur.end = i;
    const run = cur.runs[cur.runs.length - 1];
    if (run && run.sub === sk) run.bars++;
    else cur.runs.push({ sub: sk, bars: 1 });
  }

  const anchorOf = (a: Acc) => a.points.length ? a.points[0] : null;
  const episodes = accs.map((a, k): EpisodeStat => {
    const broad = a.first.broad;
    const anchor = anchorOf(a);
    const anchorBar = anchor ? anchor.barIndex : a.start;
    const anchorPrice = anchor ? anchor.price : candles[a.start].close;
    const next = accs[k + 1];
    const open = !next;
    const nextAnchor = next ? (anchorOf(next)?.barIndex ?? next.start) : end;
    const spanEnd = Math.max(anchorBar, nextAnchor);
    const lastClose = candles[a.end].close;
    const swings = buildSwings(a.points);

    let rangeHigh: number | null = null, rangeLow: number | null = null;
    for (const p of a.points) {
      if (p.type === 'high') rangeHigh = rangeHigh === null ? p.price : Math.max(rangeHigh, p.price);
      else rangeLow = rangeLow === null ? p.price : Math.min(rangeLow, p.price);
    }

    let extremeBar = anchorBar, extremePrice = anchorPrice;
    let move = 0, netMove = lastClose - anchorPrice, capturable = 0;
    let giveback: number | null = null;
    let oppositeCount = 0, oppositeSum = 0, oppositeMax = 0, oppositeMaxPct = 0;
    let oppositeMaxBar: number | null = null, worstRetrace: number | null = null;
    const impulses: number[] = [];

    if (broad !== 'range') {
      const up = broad === 'up';
      const sign = up ? 1 : -1;
      for (const p of a.points) {
        if (p.type !== (up ? 'high' : 'low')) continue;
        if (up ? p.price > extremePrice : p.price < extremePrice) { extremePrice = p.price; extremeBar = p.barIndex; }
      }
      move = Math.abs(extremePrice - anchorPrice);
      netMove = sign * (lastClose - anchorPrice);
      capturable = sign * (extremePrice - candles[a.start].close);
      giveback = open ? null : Math.abs(extremePrice - lastClose);
      const withDir = up ? 'up' : 'down';
      for (let j = 0; j < swings.length; j++) {
        const sw = swings[j];
        if (sw.dir === withDir) { impulses.push(sw.size); continue; }
        if (sw.to.barIndex > extremeBar) continue; // after the extreme = giveback, not a pullback
        oppositeCount++;
        oppositeSum += sw.size;
        if (sw.size > oppositeMax) {
          oppositeMax = sw.size;
          oppositeMaxPct = sw.sizePct;
          oppositeMaxBar = sw.to.barIndex;
          const prior = j > 0 && swings[j - 1].dir === withDir ? swings[j - 1].size : 0;
          worstRetrace = prior > 0 ? sw.size / prior : null;
        }
      }
    } else if (rangeHigh !== null && rangeLow !== null) {
      move = rangeHigh - rangeLow;
    }

    const path = swings.reduce((t, s) => t + s.size, 0);
    const base = broad === 'range' ? (rangeLow ?? anchorPrice) : anchorPrice;
    let dominant = a.runs[0];
    const subTotals = new Map<SubKey, number>();
    for (const r of a.runs) subTotals.set(r.sub, (subTotals.get(r.sub) ?? 0) + r.bars);
    let domSub: SubKey = dominant.sub, domBars = -1;
    for (const [sub, bars] of subTotals) {
      // Prefer a named sub over 'forming' on ties.
      if (bars > domBars || (bars === domBars && domSub === 'forming')) { domSub = sub; domBars = bars; }
    }
    dominant = { sub: domSub, bars: domBars };

    return {
      segmentId: a.first.segmentId,
      broad,
      open,
      labelStart: a.start,
      labelEnd: a.end,
      labelledBars: a.end - a.start + 1,
      anchorBar,
      anchorPrice,
      spanEnd,
      spanBars: spanEnd - anchorBar + 1,
      confirmLag: a.start - anchorBar,
      extremeBar,
      extremePrice,
      move,
      movePct: base > 0 ? (move / base) * 100 : 0,
      netMove,
      capturable,
      capturablePct: candles[a.start].close > 0 ? (capturable / candles[a.start].close) * 100 : 0,
      giveback,
      oppositeCount,
      oppositeSum,
      oppositeMax,
      oppositeMaxPct,
      oppositeMaxBar,
      worstRetrace,
      impulseCount: impulses.length,
      avgImpulse: mean(impulses),
      efficiency: path > 0 ? Math.min(1, Math.abs(lastClose - anchorPrice) / path) : null,
      rangeHigh,
      rangeLow,
      failedBreakouts: a.last.failedBreakouts,
      prevBroad: k > 0 ? accs[k - 1].first.broad : null,
      nextBroad: next ? next.first.broad : null,
      dominantSub: dominant.sub,
      finalSub: subKey(a.last.sub),
      subPath: a.runs,
      points: a.points,
      swings,
      evidence: a.last.evidence,
    };
  });

  return { totalBars: end + 1, barsByBroad, barsBySub, episodes };
}

export function summarize(values: readonly number[]): DistSummary {
  if (values.length === 0) return { n: 0, mean: 0, median: 0, p25: 0, p75: 0, min: 0, max: 0, sum: 0 };
  let min = Infinity, max = -Infinity, sum = 0;
  for (const v of values) { if (v < min) min = v; if (v > max) max = v; sum += v; }
  return {
    n: values.length, mean: mean(values), median: median(values),
    p25: quantile(values, 0.25), p75: quantile(values, 0.75), min, max, sum,
  };
}

/** Broad-state transition counts: from[broad] → to[broad | 'open']. */
export function transitionMatrix(episodes: readonly EpisodeStat[]): Record<StructureBroad, Record<StructureBroad | 'open', number>> {
  const z = () => ({ up: 0, down: 0, range: 0, open: 0 });
  const m = { up: z(), down: z(), range: z() };
  for (const e of episodes) m[e.broad][e.nextBroad ?? 'open']++;
  return m;
}

/** Sub → sub changes inside episodes (consecutive runs). Key: "from→to". */
export function subTransitions(episodes: readonly EpisodeStat[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of episodes) {
    for (let j = 1; j < e.subPath.length; j++) {
      const k = `${e.subPath[j - 1].sub}→${e.subPath[j].sub}`;
      m.set(k, (m.get(k) ?? 0) + 1);
    }
  }
  return m;
}
