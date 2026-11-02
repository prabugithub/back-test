// Synthetic replica of the NIFTY 26 Jul – Aug 2024 structure the classifier must read as
//   strong UP → (BOS) ONE range [HH .. correction low] absorbing a 3-push correction with
//   marginal lower lows → late gap up with no follow-through (attempt that fails, NOT a trend).
// Shared by structureSmoke.ts (assertions) and runnable alone to print the segment list:
//   npx tsx scripts/structureFixture.ts
import { fileURLToPath } from 'node:url';
import type { Candle } from '../src/types';

/** Price path through `knots` (bar, price), one candle per bar, alternating-close noise. */
export function pathCandles(knots: Array<[number, number]>, gaps: Record<number, number> = {}): Candle[] {
  const base = Date.UTC(2024, 6, 26, 3, 45, 0) / 1000;
  const out: Candle[] = [];
  let shift = 0;
  const end = knots[knots.length - 1][0];
  for (let i = 0; i <= end; i++) {
    if (gaps[i]) shift += gaps[i];
    let k = 0;
    while (k < knots.length - 2 && knots[k + 1][0] < i) k++;
    const [b0, p0] = knots[k];
    const [b1, p1] = knots[k + 1];
    const t = b1 === b0 ? 0 : (i - b0) / (b1 - b0);
    const close = p0 + (p1 - p0) * t + shift;
    const open = i === 0 ? close - 2 : out[i - 1].close + (gaps[i] ?? 0);
    const wick = 3;
    out.push({
      timestamp: base + i * 300,
      open, close,
      high: Math.max(open, close) + wick,
      low: Math.min(open, close) - wick,
      volume: 1000,
    });
  }
  return out;
}

// Bars ≈ 5-min. Prices ≈ NIFTY.
export const NIFTY_LIKE_KNOTS: Array<[number, number]> = [
  // strong up-trend with shallow pullbacks (stairs)
  [0, 24400], [12, 24560], [16, 24530], [28, 24700], [32, 24670], [44, 24910], [48, 24880], [60, 24990],
  // 3-push correction — marginal lower lows in the same zone
  [68, 24830], [74, 24900], [82, 24810], [88, 24880], [96, 24800],
  // range rotation between ~24800 and ~24990
  [106, 24950], [114, 24840], [124, 24960], [134, 24850], [144, 24970], [154, 24860], [164, 24940],
  // late drift to the top, then (gap at 176) a pop that fades back inside
  [174, 24980], [178, 25040], [186, 24990], [194, 24950], [204, 24900],
];
export const NIFTY_LIKE_GAPS: Record<number, number> = { 176: 40 };

export function niftyLikeCandles(): Candle[] {
  return pathCandles(NIFTY_LIKE_KNOTS, NIFTY_LIKE_GAPS);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { getStructureSegments, getStructureTimeline, describeStructure } = await import('../src/utils/marketStructure');
  const { defaultAutoBacktestConfig } = await import('../src/utils/autoBacktestEngine');
  const candles = niftyLikeCandles();
  const states = getStructureTimeline(candles, defaultAutoBacktestConfig);
  for (const s of getStructureSegments(candles, defaultAutoBacktestConfig)) {
    const st = states[s.endIndex];
    console.log(`${String(s.startIndex).padStart(4)}–${String(s.endIndex).padEnd(4)} ${describeStructure(st).padEnd(30)} ${s.transitionReason.padEnd(15)} box=${st.rangeLow?.toFixed(0) ?? '-'}..${st.rangeHigh?.toFixed(0) ?? '-'} key=${st.keyLevel?.toFixed(0) ?? '-'}`);
  }
}
