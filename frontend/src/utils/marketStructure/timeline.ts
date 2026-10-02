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
//        up    → range  : close < keyLevel (protected HL) − buffer        (break of structure)
//        range → up     : close > rangeHigh + buffer                      (breakout, unconfirmed)
//        up(unconf.)    : first swing low holding ≥ broken rangeHigh − buffer confirms it;
//                         a close back < rangeHigh − buffer is a failed breakout → range resumes
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

interface Seg {
  id: number;
  broad: StructureBroad;
  confirmed: boolean;
  transitionBar: number;
  reason: TransitionReason;
  points: SwingPoint[];          // replaced (never mutated) on change — states hold references
  keyLevel: number | null;
  breakoutLevel: number | null;
  trendExtreme: number | null;   // highest high (up) / lowest low (down) since the trend began
  pendingSwing: number | null;   // lowest low since last HH (up) / highest high since last LL (down)
  failedBreakouts: number;
  prev: PrevSegmentInfo | null;
  savedRange: Seg | null;        // the range a still-unconfirmed breakout left — restored on failure
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

  let seg: Seg = {
    id: nextId++, broad: 'range', confirmed: true, transitionBar: 0, reason: 'init',
    points: [], keyLevel: null, breakoutLevel: null, trendExtreme: null, pendingSwing: null,
    failedBreakouts: 0, prev: null, savedRange: null,
  };
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

      const buf = cls.evidence.buffer;
      if (seg.broad === 'up') {
        if (sp.type === 'high') {
          if (seg.trendExtreme === null || sp.price > seg.trendExtreme) {
            const hadHigh = seg.trendExtreme !== null;
            seg.trendExtreme = sp.price;
            // Follow-through: a pullback low then a NEW high confirms a breakout whose
            // pullback dipped back under the broken edge without a close through it.
            if (!seg.confirmed && hadHigh && seg.pendingSwing !== null) {
              seg.confirmed = true;
              seg.reason = 'confirmed';
              seg.transitionBar = i;
            }
            // A new high makes the low that launched it the protected level.
            if (seg.confirmed && seg.pendingSwing !== null) seg.keyLevel = seg.pendingSwing;
            seg.pendingSwing = null;
          }
        } else {
          seg.pendingSwing = seg.pendingSwing === null ? sp.price : Math.min(seg.pendingSwing, sp.price);
          if (!seg.confirmed && seg.breakoutLevel !== null && sp.price >= seg.breakoutLevel - buf) {
            seg.confirmed = true;
            seg.keyLevel = sp.price;
            seg.pendingSwing = null;
            seg.reason = 'confirmed';
            seg.transitionBar = i;
          }
        }
      } else if (seg.broad === 'down') {
        if (sp.type === 'low') {
          if (seg.trendExtreme === null || sp.price < seg.trendExtreme) {
            const hadLow = seg.trendExtreme !== null;
            seg.trendExtreme = sp.price;
            if (!seg.confirmed && hadLow && seg.pendingSwing !== null) {
              seg.confirmed = true;
              seg.reason = 'confirmed';
              seg.transitionBar = i;
            }
            if (seg.confirmed && seg.pendingSwing !== null) seg.keyLevel = seg.pendingSwing;
            seg.pendingSwing = null;
          }
        } else {
          seg.pendingSwing = seg.pendingSwing === null ? sp.price : Math.max(seg.pendingSwing, sp.price);
          if (!seg.confirmed && seg.breakoutLevel !== null && sp.price <= seg.breakoutLevel + buf) {
            seg.confirmed = true;
            seg.keyLevel = sp.price;
            seg.pendingSwing = null;
            seg.reason = 'confirmed';
            seg.transitionBar = i;
          }
        }
      }
      reclassify();
    }

    // ── 2. close step ───────────────────────────────────────────────────────────────
    const c = candles[i].close;
    const buf = cls.evidence.buffer;

    if (seg.broad === 'up' || seg.broad === 'down') {
      const up = seg.broad === 'up';
      if (!seg.confirmed && seg.breakoutLevel !== null
        && (up ? c < seg.breakoutLevel - buf : c > seg.breakoutLevel + buf)) {
        // Failed breakout — back inside the box. Resume the range, keeping the swings
        // printed meanwhile.
        const r = seg.savedRange!;
        const lastBar = r.points.length ? r.points[r.points.length - 1].barIndex : -1;
        let pts = r.points;
        for (const p of seg.points) if (p.barIndex > lastBar) pts = mergePoint(pts, p, params.maxPivots);
        seg = { ...r, points: pts, failedBreakouts: r.failedBreakouts + 1, reason: 'failed-breakout', transitionBar: i };
        reclassify();
      } else if (seg.confirmed && seg.keyLevel !== null
        && (up ? c < seg.keyLevel - buf : c > seg.keyLevel + buf)) {
        // Break of structure — the trend's extreme anchors the new range.
        const want = up ? 'high' : 'low';
        let anchor = -1;
        for (let k = 0; k < seg.points.length; k++) {
          const p = seg.points[k];
          if (p.type !== want) continue;
          if (anchor < 0 || (up ? p.price > seg.points[anchor].price : p.price < seg.points[anchor].price)) anchor = k;
        }
        const prev = prevInfo(seg);
        seg = {
          id: nextId++, broad: 'range', confirmed: true, transitionBar: i, reason: 'bos',
          points: anchor >= 0 ? seg.points.slice(anchor) : [],
          keyLevel: null, breakoutLevel: null, trendExtreme: null, pendingSwing: null,
          failedBreakouts: 0, prev, savedRange: null,
        };
        reclassify();
      }
    } else {
      const { hi, lo } = boxOf(seg.points);
      // A range can only be broken once it has BOTH edges — after a BOS the box starts as
      // the trend's extreme alone, and the opposite edge must print (Brooks: an LH/HL forms)
      // before the move counts as a new trend rather than one long leg.
      const twoSided = hi !== null && lo !== null;
      const upBreak = twoSided && c > hi! + buf;
      const downBreak = twoSided && !upBreak && c < lo! - buf;
      if (upBreak || downBreak) {
        const up = upBreak;
        // The breakout impulse starts at the range's last opposite swing.
        const want = up ? 'low' : 'high';
        let start = -1;
        for (let k = seg.points.length - 1; k >= 0; k--) {
          if (seg.points[k].type === want) { start = k; break; }
        }
        const prev = prevInfo(seg);
        const savedRange = seg;
        seg = {
          id: nextId++, broad: up ? 'up' : 'down', confirmed: false, transitionBar: i, reason: 'breakout',
          points: start >= 0 ? seg.points.slice(start) : [],
          keyLevel: null, breakoutLevel: up ? hi : lo, trendExtreme: null, pendingSwing: null,
          failedBreakouts: 0, prev, savedRange,
        };
        reclassify();
      }
    }

    if (dirty || !current) {
      const box = boxOf(seg.points);
      current = {
        barIndex: i,
        segmentId: seg.id,
        broad: seg.broad,
        sub: cls.sub,
        confirmed: seg.confirmed,
        segmentStart: seg.points.length ? seg.points[0].barIndex : seg.transitionBar,
        transitionBar: seg.transitionBar,
        transitionReason: seg.reason,
        keyLevel: seg.keyLevel,
        breakoutLevel: seg.confirmed ? null : seg.breakoutLevel,
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
