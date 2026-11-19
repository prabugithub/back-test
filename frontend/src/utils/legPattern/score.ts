/**
 * @backtest-only
 *
 * Leg-pattern engine — composite leg score (§4).
 *
 * A single tunable strength per segment, so a rule can say "strong leg" without
 * enumerating what strong means.
 *
 * THE SPAN NORMALISATION IS LOAD-BEARING. Every component is already in [0,1], so the raw
 * weighted sum spans [-negTotal, +posTotal]; shifting and dividing maps it onto [0,1] so a
 * stored threshold keeps the same meaning when the weights are retuned. Collapsing this to
 * a plain weighted sum invalidates every threshold anyone has saved.
 */
import type { LegFeature, LegWindow } from './adapter';
import { IMPULSE } from './adapter';
import { DEFAULT_SCORE_WEIGHTS, type ScoreComponent, type ScoreWeights } from './schema';

const clamp01 = (v: number): number => (v > 1 ? 1 : v < 0 ? 0 : v);

/** Component values for one segment. `overlap` is the per-WINDOW constant term — the same
 *  value for every segment in the window — which is why it is passed in rather than read
 *  off the feature. */
function componentValue(f: LegFeature, k: ScoreComponent, windowConstant: number): number {
  switch (k) {
    case 'brr': return f.brr;
    case 'dirClv': return f.dirClv;
    case 'breakPersist': return f.breakPersist;
    case 'moveVsMedian': return f.moveVsMedian;
    case 'runLength': return f.runLength;
    case 'climax': return f.climaxPenalty;
    case 'overlap': return windowConstant;
  }
}

export interface ScoreSpan {
  posTotal: number;
  negTotal: number;
  span: number;
}

export function weightSpan(weights: ScoreWeights): ScoreSpan {
  let posTotal = 0;
  let negTotal = 0;
  for (const k of Object.keys(weights) as ScoreComponent[]) {
    const w = weights[k];
    if (w > 0) posTotal += w;
    else if (w < 0) negTotal += -w;
  }
  const span = posTotal + negTotal;
  return { posTotal, negTotal, span: span === 0 ? 1 : span };
}

export function scoreLeg(f: LegFeature, weights: ScoreWeights, windowConstant: number, spanInfo?: ScoreSpan): number {
  const { negTotal, span } = spanInfo ?? weightSpan(weights);
  let raw = 0;
  for (const k of Object.keys(weights) as ScoreComponent[]) {
    raw += weights[k] * componentValue(f, k, windowConstant);
  }
  return clamp01((raw + negTotal) / span);
}

/** One score per segment, index-aligned with `window.features`. */
export function scoreWindow(window: LegWindow, weights?: Partial<ScoreWeights>): number[] {
  const w: ScoreWeights = { ...DEFAULT_SCORE_WEIGHTS, ...(weights ?? {}) };
  const spanInfo = weightSpan(w);
  return window.features.map(f => scoreLeg(f, w, window.overlapAvg, spanInfo));
}

/**
 * Share of impulse legs scoring at or above the threshold.
 *
 * Impulse-only is deliberate: pullbacks are retraces, and scoring one as "good" would mean
 * something different. Returns `undefined` when the window has no impulse legs — that is
 * an honest "not measurable", and it fails a numeric clause naturally rather than being
 * reported as 0 (which would read as "every leg is weak").
 */
export function goodLegPct(window: LegWindow, scores: number[], threshold: number): number | undefined {
  let total = 0;
  let good = 0;
  for (let i = 0; i < window.features.length; i++) {
    if (window.features[i].kind !== IMPULSE) continue;
    total++;
    if (scores[i] >= threshold) good++;
  }
  return total > 0 ? good / total : undefined;
}
