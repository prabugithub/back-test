/**
 * Strong-trend-DAY H1/H2 continuation. LONG ONLY.
 *
 * The setup, in words:
 *
 *   First decide whether TODAY is a strong bull trend day, the way a discretionary Al Brooks
 *   trader reads it: yesterday's structure, the multi-day context, and how today is
 *   developing. Only on such a day, buy H1/H2 near the EMA (or an H1 far from it once the day
 *   has run 20+ gap bars without touching the EMA).
 *
 * The judgement is a WEIGHTED SCORE plus a few HARD VETOES, not a stack of hard gates: one
 * marginal factor should not kill an otherwise textbook day, but a failed breakout should.
 *
 * ── 1. Yesterday (priorDayProfile — built once per session, cached) ─────────
 *
 *   - Contraction: yesterday's range vs the average daily range (ADR). Trend days follow
 *     trading-range days. Too tight (< TIGHT_RANGE_ADR) is 50/50 breakout mode, too wide
 *     (> WIDE_RANGE_ADR) is usually followed by a range day.
 *   - Close location: a close in the top quarter of the day (a bull trend bar on the daily).
 *   - Late breakout: in the last `trendDayLateBars` bars price CLOSED above the earlier day
 *     high, in at least two pushes to new highs, with clean bull bars.
 *   - Climax check: late breakouts that end in 2+ oversized bull bars usually open the next
 *     day with a pullback — a tight channel into the close is wanted, not a buy climax.
 *   - Pivot structure: the day's LL swing low followed by a higher swing low (HL) above the
 *     day's midpoint — the trading range resolved up.
 *   - EMA21 slope at yesterday's close: flat→rising scores, falling costs.
 *
 * ── 2. Broader structure (daily bars aggregated from the 5m data) ───────────
 *
 *   - Daily higher lows over the last three sessions.
 *   - Yesterday inside the prior `trendDayMultiDayLookback`-session range and today breaking
 *     out above it scores; opening just under that multi-day high (resistance) costs.
 *
 * ── 3. Today (todayProfile — recomputed each call over today's bars only) ───
 *
 *   Vetoes (each one KILLS the day — no further entries this session):
 *   - no close above the previous day's high (PDH) within `trendDayPdhBreakBars` bars
 *     (a gap open above counts);
 *   - after that break, any close back below PDH (failed breakout);
 *   - a big bear bar closing below EMA21, or two consecutive bear closes below it;
 *   - a close below the opening swing low.
 *   Scored: gap size vs ADR, first-bar quality and whether its low holds, first-hour trend vs
 *   chop, the biggest bear body, a run of gap bars above EMA21.
 *
 * ── 4. The bar itself ───────────────────────────────────────────────────────
 *
 *   Trigger H1 or H2, price above EMA21 and within EMA_NEAR_ATR of it — or an H1 far from the
 *   EMA when the current gap-bar run is ≥ `trendDayGapBarsMin` and the day scores
 *   STRONG_TREND_DAY_SCORE. The old bar-level strength reads (H1 streak, clean bull bars in
 *   the leg, EMA21/EMA50 slope) are now score components, not gates. Room to the next
 *   prior-day resistance for the target stays a veto (see below), and at most
 *   `trendDayMaxEntries` entries are approved per session.
 *
 * Every window (ADR days, late bars, PDH-break bars, first-hour bars, gap bars, max entries)
 * comes from Session Settings — see DEFAULT_TREND_DAY_WINDOWS. Ratio thresholds and score
 * weights are the named constants below: STARTING VALUES, to be re-tuned from
 * `__hook.stats(...)` on your own data. Every component is recorded by probe() before any
 * verdict and written into the trade's reason string, so each trade explains itself.
 *
 * ── Room to resistance, and why a pullback must not fail it ─────────────────
 *
 * Resistance = the lowest PRIOR-DAY pivot swing high strictly above today's session high so
 * far. Today's own swing highs are excluded (the trend exceeds them within bars), and a level
 * the session has already traded through is support, not resistance — so a pullback into a
 * broken level is measured against the NEXT untouched level. Entry, the stop the engine will
 * actually place (utils/stopLoss.ts) and that resistance must leave
 * max(MIN_TARGET_RR, rules.targetRR) reward:risk. Nothing overhead passes.
 *
 * ── How the leg sequence is laid out ────────────────────────────────────────
 *
 * `ctx.legs()` is NEWEST-FIRST, and a bull leg's retrace is tagged `direction: 'bear'`. An
 * H1/H2 usually fires as a retrace ends (segs[0] = bear pullback, segs[1] = bull leg), but in
 * a strong trend the leg often runs right up to the entry bar (segs[0] = bull leg). Both
 * shapes are accepted; anything else scores no clean-leg point rather than blocking.
 */
import type { EntryHook, EntryHookContext } from '../utils/entryHook';
import { getAtrValueAt, getEmaValueAt } from '../utils/indicators';
import { calculateEMASlope } from '../utils/pivotAnalysis';
import { istDayIndex, getSessionOpenContext, type SessionOpenContext } from '../utils/sessionDay';
import { prospectiveStop } from '../utils/stopLoss';
import type { Candle, LegSegment } from '../types';
import { probe } from './debug';

/**
 * Fallbacks for the optional `AutoBacktestConfig.trendDay*` windows, shared with Session
 * Settings. Lives here rather than in autoBacktestEngine.ts because the engine imports the
 * strategy registry — a value import back into it would be a module cycle.
 */
export const DEFAULT_TREND_DAY_WINDOWS = {
  trendDayAdrDays: 10,
  trendDayMultiDayLookback: 5,
  trendDayLateBars: 18,
  trendDayPdhBreakBars: 6,
  trendDayFirstHourBars: 12,
  trendDayGapBarsMin: 20,
  trendDayMaxEntries: 3,
} as const;

// ── Yesterday ──────────────────────────────────────────────────────────────
/** Range / ADR below this = too tight: breakout mode, often another range day. */
const TIGHT_RANGE_ADR = 0.35;
/** Range / ADR at or below this (and above TIGHT) = the contraction that precedes trend days. */
const CONTRACTION_ADR = 0.8;
/** Range / ADR above this = a big swing day, usually followed by a trading-range day. */
const WIDE_RANGE_ADR = 1.3;
/** Close location (0 = day low, 1 = day high) for a bull trend bar on the daily. */
const STRONG_CLOSE_LOC = 0.75;
/** Close location at or below this = sellers won the close. */
const WEAK_CLOSE_LOC = 0.4;
/** Pushes to a new day high needed in the late window — "two good bull legs". */
const MIN_LATE_LEGS = 2;
/** A late bull bar is climactic at this multiple of yesterday's average body. */
const CLIMAX_BODY_MULT = 2.5;
/** This many climactic late bars = a buy climax into the close. */
const CLIMAX_MIN_BARS = 2;

// ── Broader structure ──────────────────────────────────────────────────────
/** A multi-day high within this many ADRs above PDH is resistance the day opens into. */
const RESISTANCE_NEAR_ADR = 0.3;

// ── Today ──────────────────────────────────────────────────────────────────
/** Gap (open − prior close) / ADR up to this = the healthy small gap. */
const GOOD_GAP_ADR = 0.3;
/** Gap / ADR above this = the move may have already happened — often a range day. */
const BIG_GAP_ADR = 0.5;
/** A bull trend bar closes in at least the top third of its range. */
const TREND_BAR_CLOSE_LOC = 0.67;
/** Bars after the first bar that must hold its low for "first bar held". */
const FIRST_BAR_HOLD_BARS = 3;
/** First-hour net progress (close − open) / first-hour range at or above this = trending. */
const FIRST_HOUR_PROGRESS = 0.5;
/** First hour already used this much of ADR ... */
const FIRST_HOUR_SPENT_ADR = 0.6;
/** ... with progress below this = chop; the rest of the day is usually a range. */
const FIRST_HOUR_CHOP_PROGRESS = 0.3;
/** A bear bar is "big" when its body is at least this many ATRs. */
const BIG_BEAR_BODY_ATR = 0.8;
/** The opening swing low spans at least this many opening bars (longer if PDH broke later). */
const OPENING_SWING_BARS = 3;
/** Max distance above EMA21, in ATRs, for an entry to count as "near the moving average". */
const EMA_NEAR_ATR = 1.0;

// ── Bar-level strength (now score components) ──────────────────────────────
/** A bull bar is CLEAN at or above this body-to-range ratio. */
const MIN_CLEAN_BRR = 0.5;
/** Clean bull bars inside the current bull leg for the clean-leg point. */
const MIN_CLEAN_BULL_BARS = 3;
/** H1s in a row (H-side labels, trigger included) for the H1-streak point. */
const REQUIRED_H1_STREAK = 2;
/** true: interleaved L labels break the H1 streak. false: only H-side labels are read. */
const H1_STREAK_STRICT = false;
/** Entry-bar EMA slopes, in ATRs per bar, for the slope point (both must pass). */
const MIN_EMA21_SLOPE_ATR = 0.05;
const MIN_EMA50_SLOPE_ATR = 0.03;

// ── Verdict ────────────────────────────────────────────────────────────────
/** Score needed to call today a strong trend day. */
const MIN_TREND_DAY_SCORE = 6;
/** Score needed for the far-from-EMA gap-bar H1. */
const STRONG_TREND_DAY_SCORE = 9;
/** Least reward:risk room to resistance; the regime's own targetRR wins when larger. 0 = off. */
const MIN_TARGET_RR = 2;

/** Points per score component. Positive = trend-day evidence, negative = against. */
const W = {
  contraction: 2,
  tooTight: -1,
  tooWide: -2,
  strongClose: 1,
  weakClose: -1,
  lateTwoLegs: 2,
  lateBreakout: 1,
  climax: -1,
  pivotResolvedUp: 1,
  emaRising: 1,
  emaFalling: -1,
  dailyHigherLows: 1,
  multiDayBreakout: 1,
  intoMultiDayHigh: -1,
  goodGap: 1,
  bigGap: -1,
  firstBarTrend: 1,
  firstBarBear: -1,
  firstBarHeld: 1,
  firstHourTrend: 1,
  firstHourChop: -1,
  bigBearBar: -1,
  gapBars: 1,
  h1Streak: 1,
  cleanLeg: 1,
  slopes: 1,
} as const;

const EMA_PERIOD = 21;

/** `ctx.state` keys — namespaced because `ctx.state` is shared by every hook in the run. */
const LEVELS_KEY = 'strongTrendH1.priorDayLevels';
const PROFILE_KEY = 'strongTrendH1.priorDayProfile';
const SESSION_KEY = 'strongTrendH1.session';

/** probe()'s own rounding is private to debug.ts; extras arrive raw, so round here. */
const r = (v: number | null | undefined, dp: number): number | null =>
  v === null || v === undefined || !Number.isFinite(v) ? null : Number(v.toFixed(dp));

export const strongTrendH1: EntryHook = ctx => {
  // ── 1. Trigger: long side, H1 or H2 ───────────────────────────────────────
  // if (ctx.trigger.side !== 'long') return false;
  // if (ctx.trigger.count !== 1 && ctx.trigger.count !== 2) return false;

  const win = windows(ctx);
  const open = getSessionOpenContext(ctx.fullCandles, ctx.absoluteIndex);
  if (!open) return false;
  const prior = priorDayProfile(ctx, open, win);
  if (!prior) return false; // no previous session loaded — the day cannot be judged
  const today = todayProfile(ctx, open, prior, win);
  const day = sessionState(ctx, open);

  // ── 2. The bull leg being bought ──────────────────────────────────────────
  const segs = ctx.legs();
  const head = segs[0];
  let bullLeg: LegSegment | null = null;
  let pullback: LegSegment | null = null;
  if (head?.kind === 'leg' && head.direction === 'bull') {
    bullLeg = head;
  } else if (head?.kind === 'pullback' && head.direction === 'bear') {
    const next = segs[1];
    if (next && next.kind === 'leg' && next.direction === 'bull') {
      bullLeg = next;
      pullback = head;
    }
  }
  const clean = bullLeg ? countCleanBullBars(bullLeg) : null;

  // ── 3. Label stream (bounded by Session Settings → Leg Seq N) ─────────────
  const labels = recentLabels(ctx, segs);
  const hStreak = countLeadingH1(labels.filter(l => l[0] === 'H'));
  const rawStreak = countLeadingH1(labels);
  const streak = H1_STREAK_STRICT ? rawStreak : hStreak;
  const lRun = maxLCount(labels);

  // ── 4. Moving averages at the ENTRY bar ───────────────────────────────────
  // ctx.ema21 is entry-bar anchored; EMA50 is looked up from the cached series on
  // fullCandles (never ctx.candles, a fresh slice that would force a recompute).
  const atr = ctx.atr;
  const entry = ctx.candle.close;
  const ema21 = ctx.ema21;
  const ema50 = getEmaValueAt(ctx.fullCandles, ctx.absoluteIndex, 50);
  const ema21Slope = calculateEMASlope(ctx.fullCandles, ctx.absoluteIndex, 21, ctx.config.ema21SlopeLookback ?? 10);
  const ema50Slope = calculateEMASlope(ctx.fullCandles, ctx.absoluteIndex, 50, ctx.config.ema50SlopeLookback ?? 20);
  const slope21Atr = ema21Slope !== undefined && atr > 0 ? ema21Slope / atr : null;
  const slope50Atr = ema50Slope !== undefined && atr > 0 ? ema50Slope / atr : null;
  const emaDistAtr = ema21 !== null && atr > 0 ? (entry - ema21) / atr : null;

  // ── 5. Room to the next resistance ────────────────────────────────────────
  const sl = prospectiveStop('long', entry, ctx.rules, ctx.pivots, ctx.fullCandles, ctx.absoluteIndex, atr);
  const risk = sl === null ? null : entry - sl;
  const levels = priorDayLevels(ctx);
  const resistance = firstAbove(levels.highs, today.sessionHigh);
  const support = firstBelow(levels.lows, today.sessionLow);
  const headroom = resistance === null ? null : resistance - entry;
  const headroomRR = headroom !== null && risk !== null && risk > 0 ? headroom / risk : null;
  const requiredRR = Math.max(MIN_TARGET_RR, ctx.rules.targetRR);

  // ── 6. The trend-day score ────────────────────────────────────────────────
  const { score, parts } = scoreDay(prior, today, win, {
    h1Streak: streak >= REQUIRED_H1_STREAK,
    cleanLeg: clean !== null && clean.total >= MIN_CLEAN_BULL_BARS,
    slopes: slope21Atr !== null && slope21Atr >= MIN_EMA21_SLOPE_ATR
      && slope50Atr !== null && slope50Atr >= MIN_EMA50_SLOPE_ATR,
  });

  // Day-level vetoes. Each is a fact about the session so far, so it can only go from false
  // to true — once one fires the day is killed and stays killed.
  const pdhDeadline = win.trendDayPdhBreakBars;
  const veto =
    today.pdhBreakBar === null && today.bars >= pdhDeadline ? 'noPdhBreak'
    : today.pdhBreakBar !== null && today.pdhBreakBar >= pdhDeadline ? 'latePdhBreak'
    : today.pdhFailed ? 'pdhFailed'
    : today.bearBreak ? 'bearBreak'
    : today.openingLowBroken ? 'openingLowBroken'
    : null;
  if (veto && !day.killed) day.killed = veto;

  const nearEma = emaDistAtr !== null && emaDistAtr >= 0 && emaDistAtr <= EMA_NEAR_ATR;
  const farGapBarH1 = ctx.trigger.count === 1
    && today.gapBars >= win.trendDayGapBarsMin
    && score >= STRONG_TREND_DAY_SCORE;

  // Recorded before any verdict so __hook.table() / __hook.stats() see every trigger bar.
  probe(ctx, {
    tdScore: score,
    tdParts: parts.join(' '),
    killed: day.killed,
    entriesToday: day.entries,
    // yesterday
    pdh: r(prior.pdh, 2),
    rangeAdr: r(prior.rangeAdr, 2),
    closeLoc: r(prior.closeLoc, 2),
    lateBreakout: prior.lateBreakout,
    lateLegs: prior.lateLegs,
    lateClean: prior.lateClean,
    climaxBars: prior.climaxBars,
    pivotResolvedUp: prior.pivotResolvedUp,
    llToHlBars: prior.llToHlBars,
    swingsLlToHl: prior.swingsLlToHl,
    ySlopeAtr: r(prior.emaSlopeAtrClose, 3),
    dailyHigherLows: prior.dailyHigherLows,
    yInsideMultiDay: prior.yInsideMultiDay,
    multiDayHigh: r(prior.multiDayHigh, 2),
    // today
    barsToday: today.bars,
    pdhBreakBar: today.pdhBreakBar,
    gapAdr: r(today.gapAdr, 2),
    firstBarTrend: today.firstBarTrend,
    firstBarHeld: today.firstBarHeld,
    fhRangeAdr: r(today.fhRangeAdr, 2),
    fhProgress: r(today.fhProgress, 2),
    maxBearBodyAtr: r(today.maxBearBodyAtr, 2),
    gapBars: today.gapBars,
    maxGapBars: today.maxGapBars,
    // bar
    hStreak,
    rawStreak,
    lRun,
    labels: labels.slice(0, 6).join('·'),
    cleanBars: clean?.total ?? null,
    cleanRun: clean?.maxRun ?? null,
    legBars: bullLeg?.barCount ?? null,
    pullbackBars: pullback?.barCount ?? 0,
    ema21: r(ema21, 2),
    ema50: r(ema50, 2),
    ema21SlopeAtr: r(slope21Atr, 3),
    ema50SlopeAtr: r(slope50Atr, 3),
    emaDistAtr: r(emaDistAtr, 2),
    nearEma,
    farGapBarH1,
    // room
    sl: r(sl, 2),
    risk: r(risk, 2),
    resistance: r(resistance, 2),
    headroomRR: r(headroomRR, 2),
    requiredRR: r(requiredRR, 2),
    support: r(support, 2),
  });

  // ── 7. Verdicts ───────────────────────────────────────────────────────────
  if (day.killed) return false;
  if (today.pdhBreakBar === null) return false;       // not broken out yet — not a trend day yet
  if (day.entries >= win.trendDayMaxEntries && day.lastEntryBar !== ctx.absoluteIndex) return false;
  if (ema21 === null || entry <= ema21) return false; // must hold above the moving average
  // if (score < MIN_TREND_DAY_SCORE) return false;
  // if (!nearEma && !farGapBarH1) return false;
  if (!farGapBarH1) return false;

  // No stop means the engine could not form one either; refuse here where the reason shows.
  if (risk === null || !(risk > 0)) return false;
  if (headroomRR !== null && headroomRR < requiredRR) return false;

  // The engine may ask again for the same bar under another regime — count the bar once.
  if (day.lastEntryBar !== ctx.absoluteIndex) {
    day.entries++;
    day.lastEntryBar = ctx.absoluteIndex;
  }

  // Stamped onto the trade's reason, so every trade carries its own proof in Trade History.
  ctx.log(
    `TD score=${score}/${MIN_TREND_DAY_SCORE} [${parts.join(' ')}] `
    + `pdh=${prior.pdh.toFixed(2)} brk@${today.pdhBreakBar} `
    + `${nearEma ? 'nearEMA' : `gapBars=${today.gapBars}`} emaDist=${emaDistAtr === null ? 'na' : emaDistAtr.toFixed(2)} `
    + `H1x${streak} clean=${clean ? `${clean.total}/${bullLeg?.barCount}` : 'na'} `
    + `res=${resistance === null ? 'open' : resistance.toFixed(2)} `
    + `rr=${headroomRR === null ? 'open' : headroomRR.toFixed(1)}/${requiredRR} `
    + `sup=${support === null ? 'none' : support.toFixed(2)} entry#${day.entries}`
  );

  return true;

  // To take a structural stop under the pullback (or under the leg when there is no pullback
  // segment) instead of the regime's configured one, replace the line above with:
  //
  //   const anchor = pullback ? pullback.low : bullLeg?.low;
  //   return anchor === undefined ? true : { sl: anchor - (atr > 0 ? atr * 0.25 : 0) };
};

// ─── Windows ─────────────────────────────────────────────────────────────────

type TrendDayWindows = { -readonly [K in keyof typeof DEFAULT_TREND_DAY_WINDOWS]: number };

/** Session Settings values with the shared fallbacks, floored to sane minimums. */
function windows(ctx: EntryHookContext): TrendDayWindows {
  const c = ctx.config;
  const d = DEFAULT_TREND_DAY_WINDOWS;
  const pick = (v: number | undefined, def: number, min: number) =>
    Number.isFinite(v) ? Math.max(min, Math.floor(v as number)) : def;
  return {
    trendDayAdrDays: pick(c.trendDayAdrDays, d.trendDayAdrDays, 3),
    trendDayMultiDayLookback: pick(c.trendDayMultiDayLookback, d.trendDayMultiDayLookback, 2),
    trendDayLateBars: pick(c.trendDayLateBars, d.trendDayLateBars, 3),
    trendDayPdhBreakBars: pick(c.trendDayPdhBreakBars, d.trendDayPdhBreakBars, 1),
    trendDayFirstHourBars: pick(c.trendDayFirstHourBars, d.trendDayFirstHourBars, 2),
    trendDayGapBarsMin: pick(c.trendDayGapBarsMin, d.trendDayGapBarsMin, 1),
    trendDayMaxEntries: pick(c.trendDayMaxEntries, d.trendDayMaxEntries, 1),
  };
}

// ─── Daily bars (the higher timeframe) ───────────────────────────────────────

interface DayBar {
  day: number;
  /** Absolute index of the session's first and last 5m bar. */
  start: number;
  end: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

/**
 * Up to `count` complete sessions strictly before `before` (today's open bar), NEWEST-FIRST,
 * aggregated from the base candles. Nothing at or after `before` is read, so no lookahead.
 */
function priorDays(candles: Candle[], before: number, count: number): DayBar[] {
  const out: DayBar[] = [];
  let i = before - 1;
  while (i >= 0 && out.length < count) {
    const day = istDayIndex(candles[i].timestamp);
    const end = i;
    let high = Number.NEGATIVE_INFINITY;
    let low = Number.POSITIVE_INFINITY;
    while (i >= 0 && istDayIndex(candles[i].timestamp) === day) {
      if (candles[i].high > high) high = candles[i].high;
      if (candles[i].low < low) low = candles[i].low;
      i--;
    }
    const start = i + 1;
    out.push({ day, start, end, open: candles[start].open, high, low, close: candles[end].close });
  }
  return out;
}

// ─── Yesterday ───────────────────────────────────────────────────────────────

interface PriorDayProfile {
  pdh: number;
  pdl: number;
  pdc: number;
  /** Mean range of the `trendDayAdrDays` sessions before yesterday; null with < 3 of them. */
  adr: number | null;
  rangeAdr: number | null;
  closeLoc: number;
  lateBreakout: boolean;
  lateLegs: number;
  lateClean: number;
  climaxBars: number;
  pivotResolvedUp: boolean;
  llToHlBars: number | null;
  /** Swing pivots (either type) strictly between the LL and the HL — the legs between them. */
  swingsLlToHl: number | null;
  emaSlopeAtrClose: number | null;
  dailyHigherLows: boolean;
  yInsideMultiDay: boolean;
  multiDayHigh: number | null;
}

/**
 * Everything about the previous session(s) the day verdict needs. Cached on `ctx.state` per
 * IST day: it reads only bars before today's open, so it is fixed for the whole session.
 */
function priorDayProfile(
  ctx: EntryHookContext,
  open: SessionOpenContext,
  win: TrendDayWindows,
): PriorDayProfile | null {
  const today = istDayIndex(ctx.candle.timestamp);
  const cached = ctx.state[PROFILE_KEY] as { day: number; profile: PriorDayProfile | null } | undefined;
  if (cached && cached.day === today) return cached.profile;

  const profile = buildPriorDayProfile(ctx, open, win);
  ctx.state[PROFILE_KEY] = { day: today, profile };
  return profile;
}

function buildPriorDayProfile(
  ctx: EntryHookContext,
  open: SessionOpenContext,
  win: TrendDayWindows,
): PriorDayProfile | null {
  const fc = ctx.fullCandles;
  const days = priorDays(fc, open.openBarIndex, Math.max(win.trendDayAdrDays, win.trendDayMultiDayLookback) + 1);
  const y = days[0];
  if (!y) return null;
  const range = y.high - y.low;
  if (!(range > 0)) return null;

  const adrSet = days.slice(1, 1 + win.trendDayAdrDays);
  const adr = adrSet.length >= 3 ? adrSet.reduce((s, d) => s + (d.high - d.low), 0) / adrSet.length : null;

  // Late window: yesterday's last N bars, against the day's high BEFORE that window.
  const lateStart = Math.max(y.start, y.end - win.trendDayLateBars + 1);
  let preLateHigh = Number.NEGATIVE_INFINITY;
  let bodySum = 0;
  for (let i = y.start; i <= y.end; i++) {
    if (i < lateStart && fc[i].high > preLateHigh) preLateHigh = fc[i].high;
    bodySum += Math.abs(fc[i].close - fc[i].open);
  }
  const avgBody = bodySum / (y.end - y.start + 1);

  let lateBreakout = false;
  let lateLegs = 0;
  let lateClean = 0;
  let climaxBars = 0;
  let running = preLateHigh;
  let inPush = false;
  for (let i = lateStart; i <= y.end; i++) {
    const b = fc[i];
    // Brooks: the breakout must CLOSE beyond the range high, not just poke through it.
    if (Number.isFinite(preLateHigh) && b.close > preLateHigh) lateBreakout = true;
    // A push = a run of bars making new day highs; any bar that doesn't ends the push.
    if (b.high > running) {
      if (!inPush) lateLegs++;
      inPush = true;
      running = b.high;
    } else {
      inPush = false;
    }
    const barRange = b.high - b.low;
    const body = b.close - b.open;
    if (body > 0 && barRange > 0 && body / barRange >= MIN_CLEAN_BRR) lateClean++;
    if (body > 0 && avgBody > 0 && body >= CLIMAX_BODY_MULT * avgBody) climaxBars++;
  }
  // No bars before the late window means no earlier range to break out of.
  if (!Number.isFinite(preLateHigh)) lateLegs = 0;

  // Pivot structure: the day's lowest swing low (LL), then the last higher swing low (HL).
  const dayPivots = ctx.pivots.filter(p => p.barIndex >= y.start && p.barIndex <= y.end);
  let ll: (typeof dayPivots)[number] | null = null;
  for (const p of dayPivots) if (p.type === 'bullish' && (!ll || p.price < ll.price)) ll = p;
  let hl: (typeof dayPivots)[number] | null = null;
  if (ll) {
    for (const p of dayPivots) {
      if (p.type === 'bullish' && p.barIndex > ll.barIndex && p.price > ll.price) hl = p;
    }
  }
  const mid = (y.high + y.low) / 2;
  const pivotResolvedUp = hl !== null && hl.price > mid;
  const llToHlBars = ll && hl ? hl.barIndex - ll.barIndex : null;
  const swingsLlToHl = ll && hl
    ? dayPivots.filter(p => p.barIndex > ll!.barIndex && p.barIndex < hl!.barIndex).length
    : null;

  const ySlope = calculateEMASlope(fc, y.end, EMA_PERIOD, ctx.config.ema21SlopeLookback ?? 10);
  const yAtr = getAtrValueAt(fc, y.end);
  const emaSlopeAtrClose = ySlope !== undefined && yAtr > 0 ? ySlope / yAtr : null;

  const dailyHigherLows = days.length >= 3 && days[0].low > days[1].low && days[1].low > days[2].low;

  const md = days.slice(1, 1 + win.trendDayMultiDayLookback);
  let multiDayHigh: number | null = null;
  let yInsideMultiDay = false;
  if (md.length >= 2) {
    multiDayHigh = Math.max(...md.map(d => d.high));
    const multiDayLow = Math.min(...md.map(d => d.low));
    yInsideMultiDay = y.high <= multiDayHigh && y.low >= multiDayLow;
  }

  return {
    pdh: y.high,
    pdl: y.low,
    pdc: y.close,
    adr,
    rangeAdr: adr ? range / adr : null,
    closeLoc: (y.close - y.low) / range,
    lateBreakout,
    lateLegs,
    lateClean,
    climaxBars,
    pivotResolvedUp,
    llToHlBars,
    swingsLlToHl,
    emaSlopeAtrClose,
    dailyHigherLows,
    yInsideMultiDay,
    multiDayHigh,
  };
}

// ─── Today ───────────────────────────────────────────────────────────────────

interface TodayProfile {
  /** Bars so far today, trigger bar included. */
  bars: number;
  sessionHigh: number;
  sessionLow: number;
  /** Bars-since-open of the first close above PDH; null if none yet. */
  pdhBreakBar: number | null;
  pdhFailed: boolean;
  gapAdr: number | null;
  firstBarTrend: boolean;
  firstBarBear: boolean;
  /** null until FIRST_BAR_HOLD_BARS bars after the first have printed. */
  firstBarHeld: boolean | null;
  fhRangeAdr: number | null;
  fhProgress: number | null;
  maxBearBodyAtr: number;
  bearBreak: boolean;
  /** Current run of bars whose low stayed above EMA21, ending at the trigger bar. */
  gapBars: number;
  maxGapBars: number;
  openingLowBroken: boolean;
}

/** Today's development up to and including the trigger bar. Bounded by bars-per-day. */
function todayProfile(
  ctx: EntryHookContext,
  open: SessionOpenContext,
  prior: PriorDayProfile,
  win: TrendDayWindows,
): TodayProfile {
  const fc = ctx.fullCandles;
  const o = open.openBarIndex;
  const last = ctx.absoluteIndex;

  let sessionHigh = Number.NEGATIVE_INFINITY;
  let sessionLow = Number.POSITIVE_INFINITY;
  let pdhBreakBar: number | null = null;
  for (let i = o; i <= last; i++) {
    if (fc[i].high > sessionHigh) sessionHigh = fc[i].high;
    if (fc[i].low < sessionLow) sessionLow = fc[i].low;
    if (pdhBreakBar === null && fc[i].close > prior.pdh) pdhBreakBar = i - o;
  }

  // Opening swing low: the low of the opening bars up to the PDH break. Fixed once that
  // window has printed; a later CLOSE below it = the opening drive failed.
  const swingEnd = o + Math.max(OPENING_SWING_BARS, (pdhBreakBar ?? 0) + 1) - 1;
  let openingLow = Number.POSITIVE_INFINITY;
  for (let i = o; i <= Math.min(swingEnd, last); i++) if (fc[i].low < openingLow) openingLow = fc[i].low;

  let pdhFailed = false;
  let openingLowBroken = false;
  let maxBearBodyAtr = 0;
  let bearBreak = false;
  let prevBearBelowEma = false;
  let gapBars = 0;
  let maxGapBars = 0;
  for (let i = o; i <= last; i++) {
    const b = fc[i];
    const rel = i - o;
    if (pdhBreakBar !== null && rel > pdhBreakBar && b.close < prior.pdh) pdhFailed = true;
    if (i > swingEnd && b.close < openingLow) openingLowBroken = true;

    const ema = getEmaValueAt(fc, i, EMA_PERIOD);
    const atr = getAtrValueAt(fc, i);
    const bearBody = b.open - b.close;
    const bearBodyAtr = bearBody > 0 && atr > 0 ? bearBody / atr : 0;
    if (bearBodyAtr > maxBearBodyAtr) maxBearBodyAtr = bearBodyAtr;

    const bearBelowEma = bearBody > 0 && ema !== null && b.close < ema;
    if (bearBelowEma && (bearBodyAtr >= BIG_BEAR_BODY_ATR || prevBearBelowEma)) bearBreak = true;
    prevBearBelowEma = bearBelowEma;

    if (ema !== null && b.low > ema) {
      gapBars++;
      if (gapBars > maxGapBars) maxGapBars = gapBars;
    } else {
      gapBars = 0;
    }
  }

  const b0 = fc[o];
  const r0 = b0.high - b0.low;
  const firstBarTrend = b0.close > b0.open && r0 > 0
    && (b0.close - b0.low) / r0 >= TREND_BAR_CLOSE_LOC
    && (b0.close - b0.open) / r0 >= MIN_CLEAN_BRR;
  const firstBarBear = b0.close < b0.open;
  let firstBarHeld: boolean | null = null;
  if (last - o >= FIRST_BAR_HOLD_BARS) {
    firstBarHeld = true;
    for (let i = o + 1; i <= o + FIRST_BAR_HOLD_BARS; i++) if (fc[i].low < b0.low) firstBarHeld = false;
  }

  const fhEnd = Math.min(last, o + win.trendDayFirstHourBars - 1);
  let fhHigh = Number.NEGATIVE_INFINITY;
  let fhLow = Number.POSITIVE_INFINITY;
  for (let i = o; i <= fhEnd; i++) {
    if (fc[i].high > fhHigh) fhHigh = fc[i].high;
    if (fc[i].low < fhLow) fhLow = fc[i].low;
  }
  const fhRange = fhHigh - fhLow;
  const fhProgress = fhRange > 0 ? (fc[fhEnd].close - open.dayOpen) / fhRange : null;
  const fhRangeAdr = prior.adr ? fhRange / prior.adr : null;
  const gapAdr = prior.adr ? (open.dayOpen - prior.pdc) / prior.adr : null;

  return {
    bars: last - o + 1,
    sessionHigh,
    sessionLow,
    pdhBreakBar,
    pdhFailed,
    gapAdr,
    firstBarTrend,
    firstBarBear,
    firstBarHeld,
    fhRangeAdr,
    fhProgress,
    maxBearBodyAtr,
    bearBreak,
    gapBars,
    maxGapBars,
    openingLowBroken,
  };
}

// ─── Score ───────────────────────────────────────────────────────────────────

/** Weighted evidence for a strong bull trend day. `parts` lists every non-zero contribution. */
function scoreDay(
  p: PriorDayProfile,
  t: TodayProfile,
  win: TrendDayWindows,
  bar: { h1Streak: boolean; cleanLeg: boolean; slopes: boolean },
): { score: number; parts: string[] } {
  let score = 0;
  const parts: string[] = [];
  const add = (key: keyof typeof W, when: boolean) => {
    if (!when) return;
    score += W[key];
    parts.push(`${key}${W[key] > 0 ? '+' : ''}${W[key]}`);
  };

  // Yesterday
  if (p.rangeAdr !== null) {
    add('tooTight', p.rangeAdr < TIGHT_RANGE_ADR);
    add('contraction', p.rangeAdr >= TIGHT_RANGE_ADR && p.rangeAdr <= CONTRACTION_ADR);
    add('tooWide', p.rangeAdr > WIDE_RANGE_ADR);
  }
  add('strongClose', p.closeLoc >= STRONG_CLOSE_LOC);
  add('weakClose', p.closeLoc <= WEAK_CLOSE_LOC);
  const twoLegs = p.lateBreakout && p.lateLegs >= MIN_LATE_LEGS && p.lateClean >= MIN_CLEAN_BULL_BARS;
  add('lateTwoLegs', twoLegs);
  add('lateBreakout', p.lateBreakout && !twoLegs);
  add('climax', p.climaxBars >= CLIMAX_MIN_BARS);
  add('pivotResolvedUp', p.pivotResolvedUp);
  if (p.emaSlopeAtrClose !== null) {
    add('emaRising', p.emaSlopeAtrClose >= MIN_EMA21_SLOPE_ATR);
    add('emaFalling', p.emaSlopeAtrClose <= -MIN_EMA21_SLOPE_ATR);
  }

  // Broader structure
  add('dailyHigherLows', p.dailyHigherLows);
  if (p.multiDayHigh !== null) {
    const top = Math.max(p.multiDayHigh, p.pdh);
    add('multiDayBreakout', t.sessionHigh > top && (p.yInsideMultiDay || p.pdc > p.multiDayHigh));
    add('intoMultiDayHigh', p.adr !== null && p.multiDayHigh > p.pdh && t.sessionHigh < p.multiDayHigh
      && (p.multiDayHigh - p.pdh) / p.adr <= RESISTANCE_NEAR_ADR);
  }

  // Today
  if (t.gapAdr !== null) {
    add('goodGap', t.gapAdr > 0 && t.gapAdr <= GOOD_GAP_ADR);
    add('bigGap', t.gapAdr > BIG_GAP_ADR);
  }
  add('firstBarTrend', t.firstBarTrend);
  add('firstBarBear', t.firstBarBear);
  add('firstBarHeld', t.firstBarHeld === true);
  if (t.fhProgress !== null) {
    add('firstHourTrend', t.fhProgress >= FIRST_HOUR_PROGRESS);
    add('firstHourChop', t.fhRangeAdr !== null && t.fhRangeAdr > FIRST_HOUR_SPENT_ADR
      && t.fhProgress < FIRST_HOUR_CHOP_PROGRESS);
  }
  add('bigBearBar', t.maxBearBodyAtr >= BIG_BEAR_BODY_ATR);
  add('gapBars', t.maxGapBars >= win.trendDayGapBarsMin);

  // The bar
  add('h1Streak', bar.h1Streak);
  add('cleanLeg', bar.cleanLeg);
  add('slopes', bar.slopes);

  return { score, parts };
}

// ─── Per-session state ───────────────────────────────────────────────────────

interface SessionState {
  day: number;
  /** The veto that killed the day, or null while it is still alive. */
  killed: string | null;
  entries: number;
  lastEntryBar: number;
}

function sessionState(ctx: EntryHookContext, open: SessionOpenContext): SessionState {
  const day = istDayIndex(open.openBarTimestamp);
  const cur = ctx.state[SESSION_KEY] as SessionState | undefined;
  if (cur && cur.day === day) return cur;
  const fresh: SessionState = { day, killed: null, entries: 0, lastEntryBar: -1 };
  ctx.state[SESSION_KEY] = fresh;
  return fresh;
}

// ─── Prior-day swing levels (room to resistance) ─────────────────────────────

/** Prior-day swing highs (ascending) and swing lows (descending), from the system's pivots. */
interface PriorDayLevels {
  /** IST day these were built for — the cache key. */
  day: number;
  highs: number[];
  lows: number[];
}

/**
 * Swing levels laid down on PREVIOUS trading days, newest session excluded. A `bearish`
 * pivot records a swing high and a `bullish` one a swing low. Cached per IST day: new pivots
 * can only land on today, which is filtered out, so the set is fixed for the session.
 * `ctx.pivots` is oldest-first, so the scan stops at the first pivot belonging to today.
 */
function priorDayLevels(ctx: EntryHookContext): PriorDayLevels {
  const day = istDayIndex(ctx.candle.timestamp);
  const cached = ctx.state[LEVELS_KEY] as PriorDayLevels | undefined;
  if (cached && cached.day === day) return cached;

  const highs: number[] = [];
  const lows: number[] = [];
  for (const p of ctx.pivots) {
    if (istDayIndex(p.time) >= day) break; // today's own swings — deliberately not resistance
    if (p.type === 'bearish') highs.push(p.price);
    else lows.push(p.price);
  }
  highs.sort((a, b) => a - b);
  lows.sort((a, b) => b - a);

  const fresh: PriorDayLevels = { day, highs, lows };
  ctx.state[LEVELS_KEY] = fresh;
  return fresh;
}

/** First value strictly above `mark` in an ASCENDING list — the nearest intact resistance. */
function firstAbove(ascending: number[], mark: number): number | null {
  for (const v of ascending) if (v > mark) return v;
  return null;
}

/** First value strictly below `mark` in a DESCENDING list — the nearest intact support. */
function firstBelow(descending: number[], mark: number): number | null {
  for (const v of descending) if (v < mark) return v;
  return null;
}

// ─── Bar-level helpers ───────────────────────────────────────────────────────

/**
 * Clean bull bars within a segment: bull-bodied AND body-to-range ≥ MIN_CLEAN_BRR. Needs the
 * 'full'-detail per-candle arrays (`ctx.legs()` always builds them); null when absent, which
 * scores no clean-leg point rather than a silent zero.
 */
function countCleanBullBars(seg: LegSegment): { total: number; maxRun: number } | null {
  const { bullBear, brr } = seg;
  if (!bullBear || !brr || bullBear.length !== brr.length || bullBear.length === 0) return null;

  let total = 0;
  let run = 0;
  let maxRun = 0;
  for (let i = 0; i < bullBear.length; i++) {
    const isClean = bullBear[i] === 1 && brr[i] >= MIN_CLEAN_BRR;
    if (isClean) {
      total++;
      run++;
      if (run > maxRun) maxRun = run;
    } else {
      run = 0;
    }
  }
  return { total, maxRun };
}

/**
 * The H/L labels over the current leg sequence, NEWEST-FIRST, the trigger bar's own label
 * first. Read off `ctx.signals` (window-aligned) and bounded by the OLDEST segment's start,
 * so the window is whatever Session Settings' Leg Seq N spans.
 */
function recentLabels(ctx: EntryHookContext, segs: LegSegment[]): string[] {
  const windowOffset = ctx.absoluteIndex - ctx.index; // absolute index of ctx.candles[0]
  const oldest = segs[segs.length - 1];
  const floorIdx = oldest ? Math.max(0, oldest.startIndex - windowOffset) : 0;

  const out: string[] = [];
  for (let i = ctx.index; i >= floorIdx; i--) {
    const label = ctx.signals[i];
    if (label) out.push(label);
  }
  return out;
}

/** How many labels from the front of a newest-first list are 'H1'. */
function countLeadingH1(labels: string[]): number {
  let n = 0;
  while (n < labels.length && labels[n] === 'H1') n++;
  return n;
}

/** Highest bear count in the window — the "L7 and still no new low" read. */
function maxLCount(labels: string[]): number {
  let max = 0;
  for (const label of labels) {
    if (label[0] !== 'L') continue;
    const n = Number.parseInt(label.slice(1), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max;
}
