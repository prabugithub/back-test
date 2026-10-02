// Bar-by-bar market-structure state machine — pivots only.
//
// One forward pass over the candles. At bar i it consumes only the pivots that fired on or
// before bar i (calculatePivotPoints is a causal left-to-right fold: a pivot is known on the
// bar it fires on), so the state at bar i is identical whether the series ends at i or later.
//
// Each bar runs two steps:
//   1. pivot step — a newly confirmed pivot joins the current segment's swing points; range
//      box, key level and sub-regime are refreshed over ALL points in the segment (the
//      adaptive window: it grows until the structure breaks, capped by maxPivots).
//   2. close step — the bar's close is validated against the segment's pivot levels:
//        up    → range   : close < keyLevel (protected HL) − buffer       (break of structure)
//        range           : close > rangeHigh + buffer opens a breakout ATTEMPT — the state
//                          stays range (same segment, same box history) until price escapes:
//                            · distance — close ≥ edge + escapeFrac × box height, or
//                            · hold     — a swing low holds ≥ edge − buffer, then a close
//                                         above the attempt's best close (follow-through)
//                          A close back < edge − buffer first is a failed breakout: the attempt
//                          clears and the box has simply widened to include the excursion
//                          (a 3-push correction's marginal lower lows stay ONE range).
//        range → up      : escape confirmed
//      and the mirrors for down. Up ↔ down always passes through range.
//
// buffer = breakFrac × median swing size of the segment (fallback: recent swings overall).

import type { Candle } from '../../types';
import { getPivotPointsUpTo } from '../indicators';
import type { StructureParams } from './params';
import { paramsKey } from './params';
import { buildSwings, fitLine, mean, median } from './swings';
import type {
  PrevSegmentInfo, StructureBroad, StructureEvidence, StructureState, StructureSub,
  Swing, SwingPoint, TransitionReason,
} from './types';

interface Attempt {
  dir: 'up' | 'down';
  edge: number;        // broken box edge, frozen at the attempt start
  height: number;      // box height at the attempt start
  buffer: number;      // break buffer at the attempt start
  startBar: number;
  best: number;        // best close beyond the edge so far (max for up, min for down)
  holdTarget: number | null; // armed when a pullback holds outside the box: a close beyond it confirms
}

interface Seg {
  id: number;
  broad: StructureBroad;
  transitionBar: number;
  reason: TransitionReason;
  points: SwingPoint[];          // replaced (never mutated) on change — states hold references
  keyLevel: number | null;
  trendExtreme: number | null;   // highest high (up) / lowest low (down) since the trend began
  pendingSwing: number | null;   // lowest low since last HH (up) / highest high since last LL (down)
  failedBreakouts: number;
  prev: PrevSegmentInfo | null;
  attempt: Attempt | null;       // range only: a breakout not yet confirmed
}

/** Append a swing point, collapsing consecutive same-type points to the more extreme one. */
function mergePoint(points: SwingPoint[], sp: SwingPoint, cap: number): SwingPoint[] {
  const last = points[points.length - 1];
  let next: SwingPoint[];
  if (last && last.type === sp.type) {
    const more = sp.type === 'high' ? sp.price > last.price : sp.price < last.price;
    if (!more) return points;
    next = points.slice(0, -1);
    next.push(sp);
  } else {
    next = points.concat(sp);
  }
  return next.length > cap ? next.slice(next.length - cap) : next;
}

function boxOf(points: readonly SwingPoint[]): { hi: number | null; lo: number | null } {
  let hi: number | null = null, lo: number | null = null;
  for (const p of points) {
    if (p.type === 'high') hi = hi === null ? p.price : Math.max(hi, p.price);
    else lo = lo === null ? p.price : Math.min(lo, p.price);
  }
  return { hi, lo };
}

function medianImpulse(broad: StructureBroad, swings: readonly Swing[]): number {
  const imp = broad === 'range' ? swings : swings.filter(s => s.dir === broad);
  return median(imp.map(s => s.size));
}

function classify(
  seg: Seg,
  params: StructureParams,
  fallbackMedian: number,
): { sub: StructureSub | null; swings: Swing[]; evidence: StructureEvidence } {
  const points = seg.points;
  const swings = buildSwings(points);
  const medianSwing = swings.length > 0 ? median(swings.map(s => s.size)) : fallbackMedian;
  const buffer = params.breakFrac * medianSwing;

  const highs = points.filter(p => p.type === 'high');
  const lows = points.filter(p => p.type === 'low');
  const hiFit = fitLine(highs);
  const loFit = fitLine(lows);
  const firstBar = points.length > 0 ? points[0].barIndex : 0;
  const lastBar = points.length > 0 ? points[points.length - 1].barIndex : 0;
  const widthStart = hiFit && loFit ? hiFit.at(firstBar) - loFit.at(firstBar) : null;
  const widthEnd = hiFit && loFit ? hiFit.at(lastBar) - loFit.at(lastBar) : null;

  const evidence: StructureEvidence = {
    swingCount: swings.length,
    medianSwing,
    buffer,
    avgRetrace: null,
    avgTimeRatio: null,
    ampRatio: null,
    hiSlope: hiFit?.slope ?? null,
    loSlope: loFit?.slope ?? null,
    widthStart,
    widthEnd,
  };

  if (swings.length < params.minSwings) return { sub: null, swings, evidence };

  if (seg.broad !== 'range') {
    const dir = seg.broad;
    const retr: number[] = [];
    const time: number[] = [];
    for (let k = 1; k < swings.length; k++) {
      const imp = swings[k - 1];
      const pb = swings[k];
      if (imp.dir === dir && pb.dir !== dir && imp.size > 0) {
        retr.push(pb.size / imp.size);
        time.push(pb.bars / Math.max(1, imp.bars));
      }
    }
    // The segment's first swing is the breakout impulse out of the prior range — usually the
    // largest move, so leaving it in makes nearly every trend read as "shrinking". Amplitude
    // is compared over the impulses that followed it (at least 3).
    const impulses = swings.slice(1).filter(s => s.dir === dir).map(s => s.size);
    evidence.avgRetrace = retr.length ? mean(retr) : null;
    evidence.avgTimeRatio = time.length ? mean(time) : null;
    if (impulses.length >= 3) {
      const h = impulses.length >> 1;
      const first = mean(impulses.slice(0, h));
      const second = mean(impulses.slice(h));
      evidence.ampRatio = first > 0 ? second / first : null;
    }

    const withTrend = (s: number | null) => s !== null && (dir === 'up' ? s > 0 : s < 0);
    // Wedge = the LAST three pushes converge (exhaustion is a property of the trend's end,
    // not of its whole history). Three per side — two points always fit a line.
    if (highs.length >= 3 && lows.length >= 3) {
      const h3 = fitLine(highs.slice(-3));
      const l3 = fitLine(lows.slice(-3));
      const b0 = Math.min(highs[highs.length - 3].barIndex, lows[lows.length - 3].barIndex);
      const w0 = h3 && l3 ? h3.at(b0) - l3.at(b0) : 0;
      const w1 = h3 && l3 ? h3.at(lastBar) - l3.at(lastBar) : 0;
      if (h3 && l3 && withTrend(h3.slope) && withTrend(l3.slope) && w0 > 0
        && w1 <= (1 - params.wedgeConvergence) * w0) {
        return { sub: 'wedge', swings, evidence };
      }
    }
    if (evidence.ampRatio !== null) {
      if (evidence.ampRatio >= params.ampRatio) return { sub: 'expanding-trend', swings, evidence };
      if (evidence.ampRatio <= 1 / params.ampRatio) return { sub: 'shrinking-trend', swings, evidence };
    }
    if (evidence.avgRetrace !== null && evidence.avgRetrace <= params.stairsMaxDepth
      && (evidence.avgTimeRatio ?? 0) <= params.stairsMaxTime) {
      return { sub: 'stairs', swings, evidence };
    }
    return { sub: 'trending-range', swings, evidence };
  }

  // Range subs
  const { hi, lo } = boxOf(points);
  if (hi !== null && lo !== null) {
    const ref = seg.prev && seg.prev.broad !== 'range' && seg.prev.medianImpulse > 0
      ? seg.prev.medianImpulse
      : fallbackMedian;
    if (ref > 0 && hi - lo <= params.tightFrac * ref) return { sub: 'tight-range', swings, evidence };
  }
  // "Flat" = the fitted line moves less than one break buffer across the segment span.
  const span = lastBar - firstBar;
  const hiMove = evidence.hiSlope !== null ? evidence.hiSlope * span : 0;
  const loMove = evidence.loSlope !== null ? evidence.loSlope * span : 0;
  if (hiMove > buffer && loMove < -buffer) return { sub: 'expanding-triangle', swings, evidence };
  if (hiMove < -buffer && loMove > buffer) return { sub: 'converging-triangle', swings, evidence };
  return { sub: 'sideways', swings, evidence };
}

const timelineCache = new WeakMap<Candle[], Map<string, StructureState[]>>();

export function buildStructureTimeline(
  candles: Candle[],
  minGapBars: number,
  params: StructureParams,
): StructureState[] {
  const key = paramsKey(params, minGapBars);
  let byKey = timelineCache.get(candles);
  if (!byKey) {
    byKey = new Map();
    timelineCache.set(candles, byKey);
  }
  const hit = byKey.get(key);
  if (hit) return hit;

  const states = computeTimeline(candles, minGapBars, params);
  byKey.set(key, states);
  return states;
}

function computeTimeline(candles: Candle[], minGapBars: number, params: StructureParams): StructureState[] {
  const n = candles.length;
  const states: StructureState[] = new Array(n);
  if (n === 0) return states;

  const pivots = getPivotPointsUpTo(candles, n - 1, minGapBars);
  let pi = 0;
  let nextId = 1;

  // Recent swing points across segments — the fallback scale before a segment has swings.
  let recent: SwingPoint[] = [];

  const newSeg = (
    broad: StructureBroad, bar: number, reason: TransitionReason, points: SwingPoint[], prev: PrevSegmentInfo | null,
  ): Seg => ({
    id: nextId++, broad, transitionBar: bar, reason, points,
    keyLevel: null, trendExtreme: null, pendingSwing: null, failedBreakouts: 0, prev, attempt: null,
  });

  let seg: Seg = newSeg('range', 0, 'init', [], null);
  let cls = classify(seg, params, 0);
  let current: StructureState | null = null;
  let dirty = true;

  const fallbackMedian = () => median(buildSwings(recent).map(s => s.size));
  const reclassify = () => { cls = classify(seg, params, fallbackMedian()); dirty = true; };

  const prevInfo = (s: Seg): PrevSegmentInfo => ({
    broad: s.broad, sub: cls.sub, medianImpulse: medianImpulse(s.broad, cls.swings),
  });

  for (let i = 0; i < n; i++) {
    // ── 1. pivot step ───────────────────────────────────────────────────────────────
    while (pi < pivots.length && pivots[pi].barIndex <= i) {
      const pv = pivots[pi++];
      const sp: SwingPoint = {
        type: pv.type === 'bearish' ? 'high' : 'low',
        price: pv.price, barIndex: pv.barIndex, time: pv.time, label: pv.trendLabel,
      };
      recent = mergePoint(recent, sp, params.maxPivots);
      const before = seg.points;
      seg.points = mergePoint(seg.points, sp, params.maxPivots);
      if (seg.points === before) continue; // less extreme same-type pivot — no new information

      if (seg.broad === 'up') {
        if (sp.type === 'high') {
          if (seg.trendExtreme === null || sp.price > seg.trendExtreme) {
            seg.trendExtreme = sp.price;
            // A new high makes the low that launched it the protected level.
            if (seg.pendingSwing !== null) seg.keyLevel = seg.pendingSwing;
            seg.pendingSwing = null;
          }
        } else {
          seg.pendingSwing = seg.pendingSwing === null ? sp.price : Math.min(seg.pendingSwing, sp.price);
        }
      } else if (seg.broad === 'down') {
        if (sp.type === 'low') {
          if (seg.trendExtreme === null || sp.price < seg.trendExtreme) {
            seg.trendExtreme = sp.price;
            if (seg.pendingSwing !== null) seg.keyLevel = seg.pendingSwing;
            seg.pendingSwing = null;
          }
        } else {
          seg.pendingSwing = seg.pendingSwing === null ? sp.price : Math.max(seg.pendingSwing, sp.price);
        }
      } else if (seg.attempt) {
        // Pullback during a breakout attempt: holding outside the box arms follow-through;
        // one reaching back inside disarms it.
        const a = seg.attempt;
        const pullback = a.dir === 'up' ? sp.type === 'low' : sp.type === 'high';
        if (pullback) {
          const holds = a.dir === 'up' ? sp.price >= a.edge - a.buffer : sp.price <= a.edge + a.buffer;
          seg.attempt = { ...a, holdTarget: holds ? a.best : null };
        }
      }
      reclassify();
    }

    // ── 2. close step ───────────────────────────────────────────────────────────────
    const c = candles[i].close;
    const buf = cls.evidence.buffer;

    if (seg.broad === 'up' || seg.broad === 'down') {
      const up = seg.broad === 'up';
      if (seg.keyLevel !== null && (up ? c < seg.keyLevel - buf : c > seg.keyLevel + buf)) {
        // Break of structure — the trend's extreme anchors the new range.
        const want = up ? 'high' : 'low';
        let anchor = -1;
        for (let k = 0; k < seg.points.length; k++) {
          const p = seg.points[k];
          if (p.type !== want) continue;
          if (anchor < 0 || (up ? p.price > seg.points[anchor].price : p.price < seg.points[anchor].price)) anchor = k;
        }
        const prev = prevInfo(seg);
        seg = newSeg('range', i, 'bos', anchor >= 0 ? seg.points.slice(anchor) : [], prev);
        reclassify();
      }
    } else {
      // Range: progress an open attempt first.
      if (seg.attempt) {
        const a = seg.attempt;
        const up = a.dir === 'up';
        const best = up ? Math.max(a.best, c) : Math.min(a.best, c);
        const failed = up ? c < a.edge - a.buffer : c > a.edge + a.buffer;
        const escaped = up
          ? c >= a.edge + params.escapeFrac * a.height || (a.holdTarget !== null && c > a.holdTarget)
          : c <= a.edge - params.escapeFrac * a.height || (a.holdTarget !== null && c < a.holdTarget);
        if (failed) {
          // Back inside: the range resumes, its box already widened by the excursion.
          seg.attempt = null;
          seg.failedBreakouts++;
          seg.reason = 'failed-breakout';
          seg.transitionBar = i;
          dirty = true;
        } else if (escaped) {
          // Confirmed: the trend starts at the range's last opposite swing before the attempt.
          const want = up ? 'low' : 'high';
          let start = -1;
          for (let k = seg.points.length - 1; k >= 0; k--) {
            const p = seg.points[k];
            if (p.type === want && p.barIndex < a.startBar) { start = k; break; }
          }
          // Protected level: the latest pullback that held outside the box, else the broken edge.
          let held: number | null = null;
          for (const p of seg.points) {
            if (p.barIndex >= a.startBar && p.type === want
              && (up ? p.price >= a.edge - a.buffer : p.price <= a.edge + a.buffer)) held = p.price;
          }
          const prev = prevInfo(seg);
          const pts = start >= 0 ? seg.points.slice(start) : seg.points.filter(p => p.barIndex >= a.startBar);
          seg = newSeg(up ? 'up' : 'down', i, 'breakout', pts, prev);
          seg.keyLevel = held ?? a.edge;
          const ext = boxOf(pts);
          seg.trendExtreme = up ? ext.hi : ext.lo;
          reclassify();
        } else if (best !== a.best) {
          seg.attempt = { ...a, best };
          dirty = true;
        }
      }

      if (seg.broad === 'range' && !seg.attempt) {
        const { hi, lo } = boxOf(seg.points);
        // A range can only be broken once it has BOTH edges — after a BOS the box starts as
        // the trend's extreme alone, and the opposite edge must print (Brooks: an LH/HL forms)
        // before a move out of it counts as anything but one long leg.
        if (hi !== null && lo !== null) {
          const up = c > hi + buf;
          const down = !up && c < lo - buf;
          if (up || down) {
            // Escape is measured against the box height, floored at the swing scale (the
            // trend this range came out of, else recent swings): a range born seconds after
            // a BOS has a sliver of a box, and half a sliver is no escape at all.
            const scale = Math.max(hi - lo, seg.prev?.medianImpulse ?? 0, fallbackMedian());
            seg.attempt = {
              dir: up ? 'up' : 'down', edge: up ? hi : lo, height: scale, buffer: buf,
              startBar: i, best: c, holdTarget: null,
            };
            seg.reason = 'attempt';
            seg.transitionBar = i;
            dirty = true;
          }
        }
      }
    }

    if (dirty || !current) {
      const box = boxOf(seg.points);
      current = {
        barIndex: i,
        segmentId: seg.id,
        broad: seg.broad,
        sub: cls.sub,
        confirmed: seg.attempt === null,
        breakoutAttempt: seg.attempt?.dir ?? null,
        attemptStart: seg.attempt?.startBar ?? null,
        attemptEdge: seg.attempt?.edge ?? null,
        segmentStart: seg.points.length ? seg.points[0].barIndex : seg.transitionBar,
        transitionBar: seg.transitionBar,
        transitionReason: seg.reason,
        keyLevel: seg.keyLevel,
        rangeHigh: box.hi,
        rangeLow: box.lo,
        segmentPivots: seg.points,
        swings: cls.swings,
        prevSegment: seg.prev,
        failedBreakouts: seg.failedBreakouts,
        evidence: cls.evidence,
      };
      dirty = false;
    }
    states[i] = current;
  }
  return states;
}
