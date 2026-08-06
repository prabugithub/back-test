/**
 * @backtest-only
 *
 * Builds the recent-price-action leg sequence captured at a trade entry: the last
 * up-to-N Al Brooks impulse legs plus the pullback candles between them, contiguous
 * back from the entry bar. Legs come from the same H/L signal machinery the rest of
 * the auto-backtester uses (calculateAlBrooksLegHistory) — no pivot points involved.
 *
 * Returned newest→oldest: index 0 is the segment closest to the entry bar, walking
 * back in time. Every candle from the oldest kept leg up to the entry bar belongs to
 * exactly one segment, so nothing (least of all the pullbacks) is dropped. A `leg` is an
 * impulse (start→swing extreme); a `pullback` segment is the retrace between two legs,
 * tagged with the direction OPPOSITE to the leg it retraces (a retrace of a bull leg
 * is a bearish move, so direction 'bear').
 */
import type { Candle, LegSegment } from '../types';
import { calculateAlBrooksLegHistory, type CompletedLeg } from './indicators';
import { calculateBarQuality, averageBarQuality, calculateBarBreaks } from './pivotAnalysis';

export type LegSequenceDetail = 'full' | 'avg';

/** Build one segment over the inclusive candle range [startIndex, endIndex]. */
function makeSegment(
  candles: Candle[],
  startIndex: number,
  endIndex: number,
  kind: LegSegment['kind'],
  direction: LegSegment['direction'],
  detail: LegSequenceDetail
): LegSegment {
  const barCount = endIndex - startIndex + 1;
  const samples = calculateBarQuality(candles, endIndex, barCount);
  const avg = averageBarQuality(samples);
  const breaks = calculateBarBreaks(candles, endIndex, barCount);
  const startPrice = candles[startIndex].open;
  const endPrice = candles[endIndex].close;
  let high = -Infinity;
  let low = Infinity;
  // Per-candle direction, oldest→newest: 1 = bull (close > open), 0 = bear/doji.
  const bullBear: (0 | 1)[] = [];
  let bullCount = 0;
  for (let i = startIndex; i <= endIndex; i++) {
    if (candles[i].high > high) high = candles[i].high;
    if (candles[i].low < low) low = candles[i].low;
    const isBull = candles[i].close > candles[i].open ? 1 : 0;
    bullBear.push(isBull);
    bullCount += isBull;
  }
  const seg: LegSegment = {
    kind,
    direction,
    startIndex,
    endIndex,
    startTime: candles[startIndex].timestamp,
    endTime: candles[endIndex].timestamp,
    barCount,
    startPrice,
    endPrice,
    high,
    low,
    movePct: startPrice !== 0 ? ((endPrice - startPrice) / startPrice) * 100 : 0,
    brrAvg: avg.brrAvg ?? 0,
    clvAvg: avg.clvAvg ?? 0,
    uwrAvg: avg.uwrAvg ?? 0,
    lwrAvg: avg.lwrAvg ?? 0,
    highBreakCount: breaks.highBreakCount,
    lowBreakCount: breaks.lowBreakCount,
    bullCount,
  };
  if (detail === 'full') {
    seg.brr = samples.map(s => s.brr);
    seg.clv = samples.map(s => s.clv);
    seg.uwr = samples.map(s => s.uwr);
    seg.lwr = samples.map(s => s.lwr);
    seg.bullBear = bullBear;
  }
  return seg;
}

/**
 * @param candles       Visible candles up to (and including) the entry bar, or the full
 *                      array — indices in the result are absolute into `candles`.
 * @param currentIndex  The entry bar index into `candles`.
 * @param count         Max number of impulse legs to keep (pullbacks are extra segments).
 * @param detail        'full' attaches per-candle brr/clv/uwr/lwr arrays; 'avg' omits them.
 * @param legHistory    Optional precomputed history (must be computed over the same visible
 *                      prefix); recomputed via calculateAlBrooksLegHistory when omitted.
 */
export function buildLegSequence(
  candles: Candle[],
  currentIndex: number,
  count: number = 10,
  detail: LegSequenceDetail = 'full',
  legHistory?: CompletedLeg[]
): LegSegment[] {
  if (!candles || candles.length === 0 || currentIndex < 0 || currentIndex >= candles.length) {
    return [];
  }

  const history = legHistory ?? calculateAlBrooksLegHistory(candles.slice(0, currentIndex + 1));
  // Only legs fully formed at or before the entry bar, with a valid range.
  const usable = history
    .filter(l => l.endIndex <= currentIndex && l.startIndex >= 0 && l.startIndex <= l.endIndex)
    // Legs are pushed in completion order; interleaved bull/bear legs aren't strictly
    // start-ordered, so sort chronologically before walking the timeline.
    .sort((a, b) => a.startIndex - b.startIndex || a.endIndex - b.endIndex);

  const kept = usable.slice(-Math.max(1, count));
  if (kept.length === 0) return [];

  const segments: LegSegment[] = [];
  // Cursor = next uncovered candle. Guarantees contiguity and prevents overlap when
  // the independent bull/bear state machines produce time-overlapping legs.
  let cursor = kept[0].startIndex;
  let prevDir: 'bull' | 'bear' | null = null;

  for (const leg of kept) {
    if (leg.endIndex < cursor) continue; // fully swallowed by an earlier kept leg
    // Pullback gap before this leg — retrace of the previous leg (or, for a leading
    // gap with no previous leg, counter to this leg).
    if (leg.startIndex > cursor) {
      const retraced = prevDir ?? leg.direction;
      segments.push(
        makeSegment(candles, cursor, leg.startIndex - 1, 'pullback', retraced === 'bull' ? 'bear' : 'bull', detail)
      );
    }
    const legStart = Math.max(leg.startIndex, cursor);
    if (legStart <= leg.endIndex) {
      segments.push(makeSegment(candles, legStart, leg.endIndex, 'leg', leg.direction, detail));
      prevDir = leg.direction;
    }
    cursor = leg.endIndex + 1;
  }

  // Trailing pullback from the last leg's swing extreme up to the entry bar.
  if (cursor <= currentIndex) {
    const retraced = prevDir ?? 'bull';
    segments.push(
      makeSegment(candles, cursor, currentIndex, 'pullback', retraced === 'bull' ? 'bear' : 'bull', detail)
    );
  }

  // Return newest→oldest: the segment closest to the entry bar comes first, walking
  // back in time. (Built oldest→newest above for the contiguous cursor walk.)
  return segments.reverse();
}
