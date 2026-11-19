/**
 * @backtest-only
 *
 * Builds the recent-price-action leg sequence captured at a trade entry: the last
 * up-to-N Al Brooks impulse legs plus the pullback candles between them, contiguous
 * back from the entry bar. Legs come from the same H/L signal machinery the rest of
 * the auto-backtester uses (calculateAlBrooksRun) — no pivot points involved.
 *
 * Returned newest→oldest: index 0 is the segment closest to the entry bar, walking
 * back in time. Every candle from the oldest kept leg up to the entry bar belongs to
 * exactly one segment, so nothing (least of all the pullbacks) is dropped. A `leg` is an
 * impulse (start→swing extreme); a `pullback` segment is the retrace between two legs,
 * tagged with the direction OPPOSITE to the leg it retraces (a retrace of a bull leg
 * is a bearish move, so direction 'bear').
 */
import type { Candle, LegSegment } from '../types';
import { calculateAlBrooksRun, type AlBrooksRun } from './indicators';
import { calculateBarQuality, averageBarQuality, calculateBarBreaks } from './pivotAnalysis';

export type LegSequenceDetail = 'full' | 'avg';

/** The slice of an AlBrooks pass this builder needs. Both fields must come from the
 *  SAME run — indices are absolute, so mixing sources silently misaligns labels. */
export type LegSequenceSource = Pick<AlBrooksRun, 'legHistory' | 'signalsByBar'>;

/** Build one segment over the inclusive candle range [startIndex, endIndex].
 *  `signals` is the per-bar H/L label array, indexed absolutely into `candles`. */
function makeSegment(
  candles: Candle[],
  signals: (string | null)[],
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
  // Per-candle H/L label + the collapsed sequence of the ones that fired.
  const hl: (string | null)[] = [];
  const hlParts: string[] = [];
  // Per-candle raw OHLC, oldest→newest. `h`/`l` are the per-bar series; the segment
  // extremes accumulated above stay in `high`/`low`.
  const o: number[] = [];
  const h: number[] = [];
  const l: number[] = [];
  const c: number[] = [];
  for (let i = startIndex; i <= endIndex; i++) {
    const candle = candles[i];
    if (candle.high > high) high = candle.high;
    if (candle.low < low) low = candle.low;
    o.push(candle.open);
    h.push(candle.high);
    l.push(candle.low);
    c.push(candle.close);
    const isBull = candle.close > candle.open ? 1 : 0;
    bullBear.push(isBull);
    bullCount += isBull;
    const sig = signals[i] ?? null; // ?? null guards a short caller-supplied array
    hl.push(sig);
    if (sig) hlParts.push(sig);
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
    hlSeq: hlParts.join('-'),
  };
  if (detail === 'full') {
    seg.brr = samples.map(s => s.brr);
    seg.clv = samples.map(s => s.clv);
    seg.uwr = samples.map(s => s.uwr);
    seg.lwr = samples.map(s => s.lwr);
    seg.bullBear = bullBear;
    seg.hl = hl;
    seg.o = o;
    seg.h = h;
    seg.l = l;
    seg.c = c;
  }
  return seg;
}

/**
 * @param candles       Visible candles up to (and including) the entry bar, or the full
 *                      array — indices in the result are absolute into `candles`.
 * @param currentIndex  The entry bar index into `candles`.
 * @param count         Max number of impulse legs to keep (pullbacks are extra segments).
 * @param detail        'full' attaches per-candle brr/clv/uwr/lwr/bullBear/hl/o/h/l/c arrays; 'avg' omits them.
 * @param run           Optional precomputed AlBrooks pass (leg history + per-bar H/L labels).
 *                      Must come from ONE run over `candles` itself or a 0-based prefix of it —
 *                      indices are absolute. Recomputed via calculateAlBrooksRun when omitted;
 *                      one pass yields both, so this never runs the state machine twice.
 */
export function buildLegSequence(
  candles: Candle[],
  currentIndex: number,
  count: number = 10,
  detail: LegSequenceDetail = 'full',
  run?: LegSequenceSource
): LegSegment[] {
  if (!candles || candles.length === 0 || currentIndex < 0 || currentIndex >= candles.length) {
    return [];
  }

  const { legHistory, signalsByBar } = run ?? calculateAlBrooksRun(candles.slice(0, currentIndex + 1));
  // Only legs fully formed at or before the entry bar, with a valid range.
  const usable = legHistory
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
        makeSegment(candles, signalsByBar, cursor, leg.startIndex - 1, 'pullback', retraced === 'bull' ? 'bear' : 'bull', detail)
      );
    }
    const legStart = Math.max(leg.startIndex, cursor);
    if (legStart <= leg.endIndex) {
      segments.push(makeSegment(candles, signalsByBar, legStart, leg.endIndex, 'leg', leg.direction, detail));
      prevDir = leg.direction;
    }
    cursor = leg.endIndex + 1;
  }

  // Trailing pullback from the last leg's swing extreme up to the entry bar.
  if (cursor <= currentIndex) {
    const retraced = prevDir ?? 'bull';
    segments.push(
      makeSegment(candles, signalsByBar, cursor, currentIndex, 'pullback', retraced === 'bull' ? 'bear' : 'bull', detail)
    );
  }

  // Return newest→oldest: the segment closest to the entry bar comes first, walking
  // back in time. (Built oldest→newest above for the contiguous cursor walk.)
  return segments.reverse();
}
