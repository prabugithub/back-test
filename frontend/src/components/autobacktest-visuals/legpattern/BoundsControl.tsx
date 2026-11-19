import { SegmentedControl } from '../SegmentedControl';
import { NUMERIC_FIELD_BY_KEY, type Bounds, type NumericField } from '../../../utils/legPattern';

/** Percentile spread of this field across the legs the section targets, for the §10.1
 *  "choose against the data, not against a guess" strip. */
export interface FieldSpread {
  p10: number; p25: number; p50: number; p75: number; p90: number; n: number;
}

interface BoundsControlProps {
  field: NumericField;
  value: Bounds | undefined;
  onChange: (b: Bounds | undefined) => void;
  spread?: FieldSpread;
  /** Shown instead of the field's own label — used by the nested pullback card, where
   *  "Depth ratio" wants to read as "how much of THIS leg it gave back". */
  labelOverride?: string;
  tooltipOverride?: string;
}

type Mode = 'off' | 'min' | 'max' | 'between';

function modeOf(b: Bounds | undefined): Mode {
  const hasMin = Number.isFinite(b?.min as number);
  const hasMax = Number.isFinite(b?.max as number);
  if (hasMin && hasMax) return 'between';
  if (hasMin) return 'min';
  if (hasMax) return 'max';
  return 'off';
}

/**
 * A min/max pair, which `ThresholdFilterControl` structurally cannot express — it carries a
 * single `threshold` and infers the operator from its mode string. `between` is the
 * dominant form in a leg pattern (`candles: {min:3, max:10}`), so this is a sibling
 * control in the same visual language rather than an extension of that one.
 *
 * A newly-enabled bound OPENS AT p25–p75 when a spread is available, so a fresh condition
 * starts near-neutral and gets tightened rather than loosened. Opening at arbitrary
 * numbers starts the spec at "matches nothing", and the natural response to that is to
 * loosen — which is the wrong direction to explore from, and it hides how rare the shape
 * you asked for actually is.
 */
export function BoundsControl({ field, value, onChange, spread, labelOverride, tooltipOverride }: BoundsControlProps) {
  const def = NUMERIC_FIELD_BY_KEY[field];
  const mode = modeOf(value);
  const round = (v: number) => {
    const snapped = Math.round(v / def.step) * def.step;
    return def.int ? Math.round(snapped) : Number(snapped.toFixed(2));
  };

  // Sensible opening values: the data's own middle when we have it, else the middle of
  // the slider so the first drag goes somewhere meaningful.
  const openMin = spread ? round(spread.p25) : round(def.uiMin + (def.uiMax - def.uiMin) * 0.25);
  const openMax = spread ? round(spread.p75) : round(def.uiMin + (def.uiMax - def.uiMin) * 0.75);

  const setMode = (m: Mode) => {
    if (m === 'off') return onChange(undefined);
    if (m === 'min') return onChange({ min: Number.isFinite(value?.min as number) ? value!.min : openMin, max: null });
    if (m === 'max') return onChange({ min: null, max: Number.isFinite(value?.max as number) ? value!.max : openMax });
    onChange({
      min: Number.isFinite(value?.min as number) ? value!.min : openMin,
      max: Number.isFinite(value?.max as number) ? value!.max : openMax,
    });
  };

  const patch = (k: 'min' | 'max', raw: string) => {
    const n = raw === '' ? null : Number(raw);
    onChange({ ...(value ?? {}), [k]: n === null || Number.isNaN(n) ? null : n });
  };

  const pctOf = (v: number) =>
    def.uiMax > def.uiMin ? Math.min(100, Math.max(0, ((v - def.uiMin) / (def.uiMax - def.uiMin)) * 100)) : 0;

  const fmt = (v: number) => (def.int ? String(Math.round(v)) : v.toFixed(2));

  return (
    <div className="border border-gray-200 rounded-lg p-2 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] text-gray-400 uppercase tracking-wide font-medium cursor-help"
           title={tooltipOverride ?? def.tooltip}>
          {labelOverride ?? def.label}
        </p>
        {spread && (
          <span className="text-[9px] text-gray-400" title={`Across ${spread.n} sampled segments`}>
            typical <span className="font-medium text-gray-500">{fmt(spread.p25)}–{fmt(spread.p75)}</span>
          </span>
        )}
      </div>

      <SegmentedControl<Mode>
        value={mode}
        onChange={setMode}
        options={[
          { value: 'off', label: 'Off' },
          { value: 'min', label: '≥' },
          { value: 'max', label: '≤' },
          { value: 'between', label: 'between' },
        ]}
      />

      {mode !== 'off' && (
        <>
          <div className="flex items-center gap-1.5">
            {(mode === 'min' || mode === 'between') && (
              <input
                type="number" min={def.uiMin} max={def.uiMax} step={def.step}
                value={Number.isFinite(value?.min as number) ? (value!.min as number) : ''}
                onChange={e => patch('min', e.target.value)}
                className="w-16 px-1 py-0.5 text-[10px] border rounded text-center"
                placeholder="min"
              />
            )}
            {mode === 'between' && <span className="text-[10px] text-gray-400">to</span>}
            {(mode === 'max' || mode === 'between') && (
              <input
                type="number" min={def.uiMin} max={def.uiMax} step={def.step}
                value={Number.isFinite(value?.max as number) ? (value!.max as number) : ''}
                onChange={e => patch('max', e.target.value)}
                className="w-16 px-1 py-0.5 text-[10px] border rounded text-center"
                placeholder="max"
              />
            )}
            <span className="text-[9px] text-gray-400 ml-auto">
              {def.unit === 'percent' ? '%' : def.unit === 'fraction' ? '0–1' : 'bars'}
            </span>
          </div>

          {/* Percentile strip: where the configured band sits against the real data. */}
          {spread && (
            <div className="relative h-3" title={`p10 ${fmt(spread.p10)} · p25 ${fmt(spread.p25)} · median ${fmt(spread.p50)} · p75 ${fmt(spread.p75)} · p90 ${fmt(spread.p90)}`}>
              <div className="absolute inset-x-0 top-1.5 h-px bg-gray-200" />
              <div
                className="absolute top-1 h-1 bg-gray-300 rounded"
                style={{ left: `${pctOf(spread.p10)}%`, width: `${Math.max(1, pctOf(spread.p90) - pctOf(spread.p10))}%` }}
              />
              <div
                className="absolute top-0.5 h-2 bg-gray-400 rounded"
                style={{ left: `${pctOf(spread.p25)}%`, width: `${Math.max(1, pctOf(spread.p75) - pctOf(spread.p25))}%` }}
              />
              <div className="absolute top-0 h-3 w-px bg-gray-600" style={{ left: `${pctOf(spread.p50)}%` }} />
              {Number.isFinite(value?.min as number) && (
                <div className="absolute top-0 h-3 w-0.5 bg-indigo-600" style={{ left: `${pctOf(value!.min as number)}%` }} />
              )}
              {Number.isFinite(value?.max as number) && (
                <div className="absolute top-0 h-3 w-0.5 bg-indigo-600" style={{ left: `${pctOf(value!.max as number)}%` }} />
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
