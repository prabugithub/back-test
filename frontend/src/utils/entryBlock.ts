/**
 * @backtest-only
 *
 * Entry blocks — a side of the auto engine held shut until price confirms a level.
 *
 * Set by an exit hook (ExitHookDecision.blockEntry) when it closes a trade on a pattern that
 * is not yet confirmed: a short booked on a DOUBLE BOTTOM blocks new longs until a bar closes
 * above the neckline; a long booked on a DOUBLE TOP blocks new shorts until a bar closes below
 * it. The other side stays open.
 *
 * Owned by the run loops (batch simulator, store) — one state per run, released every bar,
 * read by evaluateAutoSignals. Pure: no engine imports, so exit types and engine can both
 * depend on it without a module cycle.
 */

export type EntrySide = 'long' | 'short';

export interface EntryBlock {
  /** The level a bar must CLOSE beyond: above it for a long block, below it for a short. */
  level: number;
  /** Absolute bar index the block was set on. */
  setAt: number;
  reason: string;
}

export interface EntryBlockState {
  long: EntryBlock | null;
  short: EntryBlock | null;
}

export function createEntryBlockState(): EntryBlockState {
  return { long: null, short: null };
}

/** Block `side`, replacing any earlier block on it. */
export function setEntryBlock(s: EntryBlockState, side: EntrySide, block: EntryBlock): void {
  s[side] = block;
}

/** Lift every block this bar's close has broken through. Call once per bar. */
export function releaseEntryBlocks(s: EntryBlockState, candle: { close: number }): void {
  if (s.long && candle.close > s.long.level) s.long = null;
  if (s.short && candle.close < s.short.level) s.short = null;
}

export function blockedSides(s: EntryBlockState): { long: boolean; short: boolean } {
  return { long: s.long !== null, short: s.short !== null };
}

/** One-line status for the UI, or null when nothing is blocked. */
export function describeEntryBlocks(s: EntryBlockState): string | null {
  const parts: string[] = [];
  if (s.long) parts.push(`Long blocked until close > ${s.long.level.toFixed(2)} (${s.long.reason})`);
  if (s.short) parts.push(`Short blocked until close < ${s.short.level.toFixed(2)} (${s.short.reason})`);
  return parts.length ? parts.join('; ') : null;
}
