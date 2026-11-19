/**
 * Leg Decay — the exit that used to be built into the engine, now an editable hook.
 *
 * Until this file existed, `RegimeRules` carried `exitLegDecay` plus eleven
 * `exitDecayXxxFilter`/`exitDecayXxxThreshold` fields and the engine hard-coded the five
 * checks below. The thresholds were configurable; the *logic* was not — you could not add a
 * sixth check, weight one fail heavier than another, or demand two bars of decay in a row.
 * As a hook all of that is one edit away, and the old behaviour survives as the defaults.
 *
 * ── What it does ─────────────────────────────────────────────────────────────
 *
 * Re-grades the newest COMPLETED with-trend leg each bar, using the same instrumentation the
 * Confirmation-step entry filters gate on. Each check that fails is one strike; enough
 * strikes on one bar and the trade closes at that bar's close.
 *
 * Two guards, both carried over from the original and both load-bearing:
 *   • only legs whose extreme formed AFTER entry are graded — never re-judge the entry leg
 *     the confirmation filters already approved, or the trade exits on the bar it opened;
 *   • a leg shorter than the session's Leg Min Bars is not evidence of decay, it is not yet
 *     evidence of anything, so `legTooShort` skips the bar entirely.
 *
 * ── Tuning ───────────────────────────────────────────────────────────────────
 *
 * Edit the constants below and save — Vite hot-reloads. `MIN_FAILS` is the blunt dial: 1
 * exits at the first sign of weakness (the old default), 3 waits for the leg to fall apart.
 * Set a check's `mode` to 'off' to drop it, 'min' to demand the metric stay at or above its
 * threshold, 'max' to demand it stay at or below.
 */
import type { ExitHook } from '../../utils/exitHook';

/** No decay exit before this many bars in the trade. */
const MIN_BARS_IN_TRADE = 3;
/** Exit once at least this many checks fail on the same bar. */
const MIN_FAILS = 1;

type Mode = 'off' | 'min' | 'max';
interface Check {
  mode: Mode;
  threshold: number;
}

/** Kaufman ER of the current with-trend leg — is the trend still travelling directly? */
const EFFICIENCY: Check = { mode: 'min', threshold: 0.25 };
/** Longest run of aligned prior-bar breaks (Brooks micro-channel strength). */
const CONSEC_BREAK: Check = { mode: 'off', threshold: 3 };
/** Total aligned prior-bar breaks in the leg (momentum persistence). */
const BAR_BREAK: Check = { mode: 'off', threshold: 4 };
/** Direction-aligned EMA21 slope — flipped for shorts, so 'min' always means "still
 *  sloping the trade's way". */
const EMA21_SLOPE: Check = { mode: 'min', threshold: 0 };
/** Fraction of leg bars not touching the EMA20 (Brooks gap bars — strong trend). */
const GAP_BAR: Check = { mode: 'off', threshold: 0.3 };

/** The old engine's `passesMinMax`: an unmeasurable metric passes, matching how every flat
 *  entry filter treats `undefined`. Only a metric that exists can fail a check. */
function passes(check: Check, value: number | undefined): boolean {
  if (check.mode === 'off' || value === undefined) return true;
  return check.mode === 'min' ? value >= check.threshold : value <= check.threshold;
}

/** Flip a directional metric so 'min' reads the same for longs and shorts. */
function aligned(value: number | undefined, isLong: boolean): number | undefined {
  if (value === undefined) return undefined;
  return isLong ? value : -value;
}

export const legDecayExit: ExitHook = ctx => {
  const { position, metrics, legWindow } = ctx;

  // ── 1. Give the trade room before grading it ──────────────────────────────
  if (position.barsInTrade === null || position.barsInTrade < MIN_BARS_IN_TRADE) return false;

  // ── 2. Only grade a leg that formed after entry ───────────────────────────
  // ctx.legWindow is already the newest completed leg on the POSITION's side, so there is no
  // direction check to make here — only a recency one.
  if (!legWindow || position.entryBarIndex === null) return false;
  if (legWindow.endIndex <= position.entryBarIndex) return false;

  // ── 3. Too short to judge is not the same as failing ──────────────────────
  if (metrics.legTooShort) return false;

  // ── 4. Grade it ───────────────────────────────────────────────────────────
  const isLong = position.side === 'long';
  const fails: string[] = [];
  if (!passes(EFFICIENCY, metrics.efficiencyRatio)) fails.push('ER');
  if (!passes(CONSEC_BREAK, isLong ? metrics.maxConsecutiveHighBreaks : metrics.maxConsecutiveLowBreaks)) fails.push('consecBreak');
  if (!passes(BAR_BREAK, isLong ? metrics.highBreakCount : metrics.lowBreakCount)) fails.push('barBreak');
  if (!passes(EMA21_SLOPE, aligned(metrics.ema21Slope, isLong))) fails.push('ema21Slope');
  if (!passes(GAP_BAR, metrics.ema20GapBarRatio)) fails.push('gapBar');

  if (fails.length < MIN_FAILS) return false;

  return {
    reason: `leg decay: leg[${legWindow.startIndex}-${legWindow.endIndex}] failed ${fails.join(', ')}`,
  };
};
