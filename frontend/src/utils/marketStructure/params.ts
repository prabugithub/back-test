// Market-structure thresholds. Every one is an AutoBacktestConfig field editable in
// Session Settings → Market Structure; nothing here is a hidden literal beyond the default.
// All are ratios of the segment's own swings — no ATR / indicator scaling.

import type { AutoBacktestConfig } from '../autoBacktestEngine';

export interface StructureParams {
  maxPivots: number;          // hard cap on the adaptive window (swing points kept per segment)
  minSwings: number;          // swings needed before a sub-regime is named
  breakFrac: number;          // break buffer as a fraction of the segment's median swing
  stairsMaxDepth: number;     // stairs: mean pullback retrace ≤ this
  stairsMaxTime: number;      // stairs: mean pullback bars / impulse bars ≤ this
  ampRatio: number;           // expanding (≥) / shrinking (≤ 1/x) impulse-size ratio
  tightFrac: number;          // tight range: height ≤ this × previous trend's median impulse
  wedgeConvergence: number;   // wedge: channel width narrows by at least this fraction
  escapeFrac: number;         // breakout attempt confirms once a close clears the edge by this × box height
}

export type StructureConfig = Pick<AutoBacktestConfig,
  | 'structureMaxPivots' | 'structureMinSwings' | 'structureBreakFrac'
  | 'structureStairsMaxDepth' | 'structureStairsMaxTime' | 'structureAmpRatio'
  | 'structureTightFrac' | 'structureWedgeConvergence' | 'structureEscapeFrac' | 'minPivotGapBars'>;

export interface StructureParamDef {
  key: keyof StructureConfig;
  label: string;
  title: string;
  min: number;
  max: number;
  step: number;
  def: number;
}

/** Single table shared by resolveStructureParams (clamping) and Session Settings (inputs). */
export const STRUCTURE_PARAM_DEFS: readonly StructureParamDef[] = [
  { key: 'structureMaxPivots', label: 'Max pivots / segment', min: 10, max: 200, step: 1, def: 60,
    title: 'Upper bound on the adaptive window. The window is normally the whole current structure segment (it grows until the structure breaks); this only caps very long segments.' },
  { key: 'structureMinSwings', label: 'Min swings for sub-regime', min: 2, max: 10, step: 1, def: 3,
    title: 'Swings a segment needs before its sub-regime (stairs, wedge, triangle…) is named. Until then it shows only Up / Down / Range.' },
  { key: 'structureBreakFrac', label: 'Break buffer (× median swing)', min: 0, max: 1, step: 0.05, def: 0.25,
    title: 'A close must clear a key pivot level by this fraction of the segment\'s median swing size to count as a break of structure or a breakout.' },
  { key: 'structureEscapeFrac', label: 'Breakout escape (× box height)', min: 0.1, max: 2, step: 0.05, def: 0.5,
    title: 'A close beyond the range box only opens a breakout ATTEMPT (still Range). It becomes a trend once a close clears the broken edge by this × the box height — or once a pullback holds outside the box and price then closes beyond the attempt’s best close. A close back inside first is a failed breakout and the box widens instead.' },
  { key: 'structureStairsMaxDepth', label: 'Stairs max retrace', min: 0.1, max: 1, step: 0.05, def: 0.4,
    title: 'Trend is "stairs" when the mean pullback size / prior impulse size stays at or below this.' },
  { key: 'structureStairsMaxTime', label: 'Stairs max pullback time', min: 0.2, max: 3, step: 0.1, def: 1,
    title: 'Trend is "stairs" only if the mean pullback candles / impulse candles also stays at or below this (shallow AND short).' },
  { key: 'structureAmpRatio', label: 'Expand / shrink ratio', min: 1.05, max: 3, step: 0.05, def: 1.15,
    title: 'Mean impulse size in the later half of the segment vs the earlier half. At or above this = expanding; at or below 1/this = shrinking.' },
  { key: 'structureTightFrac', label: 'Tight range (× prior impulse)', min: 0.05, max: 1, step: 0.05, def: 0.35,
    title: 'Range is "tight" when its height is at or below this × the median impulse of the preceding trend segment.' },
  { key: 'structureWedgeConvergence', label: 'Wedge convergence', min: 0.05, max: 0.9, step: 0.05, def: 0.25,
    title: 'Trend is a wedge when highs and lows slope with the trend and the channel width narrows by at least this fraction across the segment.' },
];

function clamp(v: number | undefined, def: StructureParamDef): number {
  const raw = v ?? def.def;
  if (!Number.isFinite(raw)) return def.def;
  return Math.min(def.max, Math.max(def.min, raw));
}

export function resolveStructureParams(config: Partial<StructureConfig>): StructureParams {
  const d = Object.fromEntries(STRUCTURE_PARAM_DEFS.map(p => [p.key, p])) as Record<string, StructureParamDef>;
  return {
    maxPivots: Math.floor(clamp(config.structureMaxPivots, d.structureMaxPivots)),
    minSwings: Math.floor(clamp(config.structureMinSwings, d.structureMinSwings)),
    breakFrac: clamp(config.structureBreakFrac, d.structureBreakFrac),
    stairsMaxDepth: clamp(config.structureStairsMaxDepth, d.structureStairsMaxDepth),
    stairsMaxTime: clamp(config.structureStairsMaxTime, d.structureStairsMaxTime),
    ampRatio: clamp(config.structureAmpRatio, d.structureAmpRatio),
    tightFrac: clamp(config.structureTightFrac, d.structureTightFrac),
    wedgeConvergence: clamp(config.structureWedgeConvergence, d.structureWedgeConvergence),
    escapeFrac: clamp(config.structureEscapeFrac, d.structureEscapeFrac),
  };
}

export function paramsKey(p: StructureParams, minGapBars: number): string {
  return [minGapBars, p.maxPivots, p.minSwings, p.breakFrac, p.stairsMaxDepth, p.stairsMaxTime,
    p.ampRatio, p.tightFrac, p.wedgeConvergence, p.escapeFrac].join('|');
}
