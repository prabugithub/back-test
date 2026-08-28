/**
 * @backtest-only
 *
 * Leg-pattern engine — plain-English readback.
 *
 * This is not decoration. A leg pattern is an ordered, positional shape, and the one
 * failure mode nobody catches by reading JSON is a spec that says something adjacent to
 * what its author meant — especially around the nesting, where "the pullback that followed
 * this leg" and "the pullback this leg came out of" are one index apart and read almost
 * identically in a form. Rendering the spec back as a sentence is what makes that visible.
 */
import {
  NUMERIC_FIELD_BY_KEY,
  WINDOW_FIELD_BY_KEY,
  boundsConstrains,
  runCondConstrains,
  type Bounds,
  type LegConditions,
  type LegPatternConfig,
  type LegSlot,
  type NumericField,
  type PullbackRule,
  type RunCond,
  type SideSel,
  type WindowClause,
} from './schema';

const num = (v: number, step: number): string =>
  step >= 1 ? String(Math.round(v)) : v.toFixed(step >= 0.1 ? 1 : 2);

/** "3–10 candles" / "at least 3 candles" / "at most 10 candles" */
function describeBound(field: NumericField, b: Bounds): string {
  const def = NUMERIC_FIELD_BY_KEY[field];
  const unit = def.unit === 'percent' ? '%' : '';
  const noun = field === 'candles' ? ' candles' : '';
  const lo = Number.isFinite(b.min as number) ? (b.min as number) : null;
  const hi = Number.isFinite(b.max as number) ? (b.max as number) : null;
  const label = field === 'candles' ? '' : `${def.label.toLowerCase()} `;

  if (lo !== null && hi !== null) return `${label}${num(lo, def.step)}–${num(hi, def.step)}${unit}${noun}`;
  if (lo !== null) return `${label}at least ${num(lo, def.step)}${unit}${noun}`;
  return `${label}at most ${num(hi as number, def.step)}${unit}${noun}`;
}

function describeRun(r: RunCond): string {
  const side =
    r.side === 'opposite' ? ' against it'
    : r.side === 'bull' ? ' bull'
    : r.side === 'bear' ? ' bear'
    : r.side === 'any' ? ''
    : ' in its own direction';
  return `at least ${r.minRun} consecutive candles at BRR ≥ ${(r.minBrr ?? 0.5).toFixed(2)}${side}`;
}

function describeConditions(c: LegConditions): string[] {
  const parts: string[] = [];
  for (const key of Object.keys(NUMERIC_FIELD_BY_KEY) as NumericField[]) {
    const b = c[key];
    if (boundsConstrains(b)) parts.push(describeBound(key, b!));
  }
  for (const r of c.runs ?? []) {
    if (runCondConstrains(r)) parts.push(describeRun(r));
  }
  return parts;
}

function sideWord(side: SideSel | undefined): string {
  return side === 'bull' ? 'bull ' : side === 'bear' ? 'bear ' : '';
}

/** The nesting, said out loud. */
function describePullback(pb: PullbackRule): string {
  const presence = pb.presence ?? 'required';
  if (presence === 'forbidden') {
    return 'and then NO retrace at all — it runs straight on';
  }
  const conds = describeConditions(pb);
  const lead = presence === 'optional' ? 'and then, if a retrace followed it,' : 'and then a retrace';
  if (conds.length === 0) {
    return presence === 'optional' ? '' : 'and then a retrace of any shape';
  }
  const forming = pb.allowForming === false ? ' (already complete)' : '';
  return `${lead} ${conds.join(', ')}${forming}`;
}

/** Ordinal for a position: leg[0] is "the most recent", leg[1] "the one before it". */
function positionName(index: number): string {
  if (index === 0) return 'leg[0] — the most recent impulse leg';
  if (index === 1) return 'leg[1] — the one before it';
  return `leg[${index}] — ${index + 1} legs back`;
}

export function describeSlot(slot: LegSlot, index: number): string {
  const conds = describeConditions(slot);
  const side = slot.side ?? 'any';

  let s = positionName(index) + ': ';
  const what = `${sideWord(side)}`.trim();
  if (!what && conds.length === 0 && !slot.pullback) {
    return s + 'anything (this position just has to exist).';
  }
  s += what ? `must be ${what}` : 'any direction';
  if (conds.length) s += `, ${conds.join(', ')}`;
  if (slot.pullback) {
    const pb = describePullback(slot.pullback);
    if (pb) s += `, ${pb}`;
  }
  return s + '.';
}

function describeWindowClause(c: WindowClause): string {
  const def = WINDOW_FIELD_BY_KEY[c.field];
  const label = def?.label ?? c.field;
  const step = def?.step ?? 0.05;
  const v = c.value;
  switch (c.op) {
    case 'is-null': return `${label} is not measurable`;
    case 'not-null': return `${label} is measurable`;
    case 'between': {
      const a = Array.isArray(v) ? v : [0, 0];
      return `${label} between ${num(Math.min(a[0], a[1]), step)} and ${num(Math.max(a[0], a[1]), step)}`;
    }
    case 'in': return `${label} is one of ${(Array.isArray(v) ? v : []).join(', ')}`;
    case 'eq': return `${label} = ${num(v as number, step)}`;
    case 'neq': return `${label} ≠ ${num(v as number, step)}`;
    case 'gte': return `${label} ≥ ${num(v as number, step)}`;
    case 'gt': return `${label} > ${num(v as number, step)}`;
    case 'lte': return `${label} ≤ ${num(v as number, step)}`;
    case 'lt': return `${label} < ${num(v as number, step)}`;
  }
}

/** The whole spec in words. Read this aloud before trusting a pattern. */
export function describeLegPattern(cfg: LegPatternConfig): string {
  const out: string[] = [];

  const clauses = (cfg.window ?? []).map(describeWindowClause).filter(Boolean);
  if (clauses.length) out.push(`Window: ${clauses.join('; ')}.`);

  if (cfg.direction === 'long') out.push('Long entries only.');
  else if (cfg.direction === 'short') out.push('Short entries only.');

  const legs = cfg.legs ?? [];
  if (legs.length) {
    out.push(
      `The window must hold at least ${legs.length} impulse leg${legs.length === 1 ? '' : 's'}, ` +
      `counting back from the current bar:`
    );
    legs.forEach((s, i) => out.push(describeSlot(s, i)));
  }

  if (cfg.retrace?.enabled) {
    out.push(
      `Price must have retraced no more than ${cfg.retrace.maxPct}% into the range of the ` +
      `newest ${cfg.retrace.windowLegs} segments.`
    );
  }

  if (out.length === 0) return 'Nothing configured — every window matches.';

  out.push(
    cfg.sideBasis === 'struct'
      ? 'Direction is read from each leg\'s structural label.'
      : 'Direction is read from where each leg actually ended up.'
  );
  return out.join(' ');
}
