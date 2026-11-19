import { useCallback, useState } from 'react';
import type { Candle } from '../../../types';
import {
  IMPULSE,
  buildLegWindow,
  type LegFeature,
  type NumericField,
} from '../../../utils/legPattern';
import type { FieldSpread } from './BoundsControl';
import type { SpreadLookup } from './LegSlotCard';

/** Sampled bars. Each one builds a full leg window, so this is genuinely expensive —
 *  which is why it sits behind an explicit button rather than running per keystroke. */
const SAMPLE_BARS = 200;
const WARMUP = 60;

const FIELDS: NumericField[] = [
  'candles', 'movePct', 'avgBrr', 'avgDirClv', 'breakPersist', 'breakCount',
  'rangeRatio', 'maxRun', 'depthRatio',
];

function readField(f: LegFeature, field: NumericField): number | null {
  switch (field) {
    case 'candles': return f.barCount;
    case 'movePct': return f.absMovePct;
    case 'avgBrr': return f.brr;
    case 'avgDirClv': return f.dirClv;
    case 'breakPersist': return f.breakPersist;
    case 'breakCount': return f.realizedDir >= 0 ? f.highBreakCount : f.lowBreakCount;
    case 'rangeRatio': return f.rangeRatio;
    case 'maxRun': return f.brrArr ? f.maxRun : null;
    case 'depthRatio': return f.kind === IMPULSE ? null : f.depthRatio;
    default: return null;
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

type Key = `${NumericField}|${'impulse' | 'pullback'}`;

export interface LegPatternStats {
  lookup: SpreadLookup;
  sampledBars: number;
  segments: number;
}

/**
 * Per-field percentiles over the segments the pattern targets, so a threshold is chosen
 * against the data rather than against a guess (§10.1).
 *
 * Expect the numbers to be humbling. On the reference dataset the median bull impulse leg
 * was 3 candles and 0.10%, and its longest run at BRR ≥ 0.8 was zero — conditions written
 * for the long, clean legs people picture match almost nothing.
 */
export function useLegPatternStats(candles: Candle[], currentIndex: number, windowLegs: number) {
  const [stats, setStats] = useState<LegPatternStats | null>(null);
  const [running, setRunning] = useState(false);

  const analyse = useCallback(() => {
    if (candles.length === 0) return;
    setRunning(true);
    // Yield once so the button's pending state paints before the sync sweep blocks.
    setTimeout(() => {
      const buckets = new Map<Key, number[]>();
      const end = Math.min(currentIndex, candles.length - 1);
      const start = Math.max(WARMUP, end - SAMPLE_BARS + 1);
      let segments = 0;
      let sampled = 0;

      for (let i = start; i <= end; i++) {
        const w = buildLegWindow(candles, i, { windowLegs, needsPerCandle: true });
        sampled++;
        // Only the newest segment is new at each bar; the rest repeat across bars and
        // would over-weight older legs if every window contributed all of them.
        const f = w.features[0];
        if (!f) continue;
        segments++;
        const kind = f.kind === IMPULSE ? 'impulse' : 'pullback';
        for (const field of FIELDS) {
          const v = readField(f, field);
          if (v === null || !Number.isFinite(v)) continue;
          const key: Key = `${field}|${kind}`;
          const arr = buckets.get(key);
          if (arr) arr.push(v);
          else buckets.set(key, [v]);
        }
      }

      const spreads = new Map<Key, FieldSpread>();
      for (const [key, vals] of buckets) {
        if (vals.length < 8) continue; // too thin to be worth showing as "typical"
        vals.sort((a, b) => a - b);
        spreads.set(key, {
          p10: percentile(vals, 0.10), p25: percentile(vals, 0.25), p50: percentile(vals, 0.50),
          p75: percentile(vals, 0.75), p90: percentile(vals, 0.90), n: vals.length,
        });
      }

      setStats({
        lookup: (field, kind) => spreads.get(`${field}|${kind}`),
        sampledBars: sampled,
        segments,
      });
      setRunning(false);
    }, 0);
  }, [candles, currentIndex, windowLegs]);

  return { stats, running, analyse };
}
