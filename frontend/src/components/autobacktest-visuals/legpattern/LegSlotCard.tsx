import { useState } from 'react';
import { ChevronDown, ChevronRight, CornerDownRight, Plus, Trash2 } from 'lucide-react';
import { SegmentedControl } from '../SegmentedControl';
import { BoundsControl, type FieldSpread } from './BoundsControl';
import { RunCondEditor } from './RunCondEditor';
import {
  defaultPullbackRule,
  describeSlot,
  type Bounds,
  type LegSlot,
  type NumericField,
  type PullbackRule,
  type SideSel,
} from '../../../utils/legPattern';

/** Fields that make sense on an impulse leg. `depthRatio` is excluded — it is a pullback
 *  quantity, and in this design it belongs to the nested block where it is measured
 *  against this very leg. */
const LEG_FIELDS: NumericField[] = [
  'candles', 'movePct', 'avgBrr', 'avgDirClv', 'breakPersist', 'breakCount', 'maxBreakRun',
  'rangeRatio', 'maxRun', 'legScore',
];

/** Fields that make sense on the retrace. `depthRatio` leads, because it is the one that
 *  only becomes unambiguous through the nesting. */
const PULLBACK_FIELDS: NumericField[] = [
  'depthRatio', 'candles', 'movePct', 'avgBrr', 'avgDirClv', 'breakPersist', 'rangeRatio',
];

export type SpreadLookup = (field: NumericField, kind: 'impulse' | 'pullback') => FieldSpread | undefined;

interface LegSlotCardProps {
  slot: LegSlot;
  index: number;
  onChange: (s: LegSlot) => void;
  onRemove: () => void;
  spreads?: SpreadLookup;
}

/** leg[0] is the most recent impulse leg, leg[1] the one before it. The index IS the
 *  position, so there is no "which leg does this match" question to answer. */
function positionLabel(i: number): { title: string; hint: string } {
  if (i === 0) return { title: 'leg[0]', hint: 'the most recent impulse leg' };
  if (i === 1) return { title: 'leg[1]', hint: 'the one before it' };
  return { title: `leg[${i}]`, hint: `${i + 1} legs back` };
}

export function LegSlotCard({ slot, index, onChange, onRemove, spreads }: LegSlotCardProps) {
  const [open, setOpen] = useState(index === 0);
  const set = (patch: Partial<LegSlot>) => onChange({ ...slot, ...patch });
  const setBound = (f: NumericField) => (b: Bounds | undefined) => {
    const next = { ...slot } as LegSlot;
    if (b) next[f] = b; else delete next[f];
    onChange(next);
  };

  const pb = slot.pullback;
  const setPb = (patch: Partial<PullbackRule>) => set({ pullback: { ...(pb ?? defaultPullbackRule()), ...patch } });
  const setPbBound = (f: NumericField) => (b: Bounds | undefined) => {
    const next = { ...(pb ?? defaultPullbackRule()) } as PullbackRule;
    if (b) next[f] = b; else delete next[f];
    set({ pullback: next });
  };

  const { title, hint } = positionLabel(index);

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <div className="flex items-start gap-2 p-2">
        <button type="button" onClick={() => setOpen(o => !o)} className="mt-0.5 text-gray-400 hover:text-gray-600">
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-medium text-gray-600">
            <span className="font-mono">{title}</span>
            <span className="ml-1 text-gray-400 font-normal">· {hint}</span>
          </p>
          <p className="text-[9px] text-gray-400 leading-snug mt-0.5">
            {describeSlot(slot, index).replace(/^leg\[\d+\][^:]*: /, '')}
          </p>
        </div>
        <button type="button" title="Remove this position" onClick={onRemove}
                className="shrink-0 p-1 text-gray-400 hover:text-red-600">
          <Trash2 size={12} />
        </button>
      </div>

      {open && (
        <div className="px-2 pb-2 space-y-2">
          <div>
            <p className="text-[9px] text-gray-400 mb-0.5">This leg must be</p>
            <SegmentedControl<SideSel>
              value={slot.side ?? 'any'}
              onChange={v => set({ side: v })}
              options={[
                { value: 'bull', label: 'Bull', activeClassName: 'bg-green-600 text-white border-green-600' },
                { value: 'bear', label: 'Bear', activeClassName: 'bg-red-600 text-white border-red-600' },
                { value: 'any', label: 'Either' },
              ]}
            />
          </div>

          <div className="grid grid-cols-1 @3xl:grid-cols-2 @6xl:grid-cols-3 gap-2">
            {LEG_FIELDS.map(f => (
              <BoundsControl
                key={f} field={f} value={slot[f]} onChange={setBound(f)}
                spread={spreads?.(f, 'impulse')}
              />
            ))}
          </div>

          <RunCondEditor
            runs={slot.runs ?? []}
            onChange={runs => set({ runs: runs.length ? runs : undefined })}
          />

          {/* ── THE NESTING ─────────────────────────────────────────────────── */}
          <div className="rounded-lg border-l-2 border-l-indigo-400 border border-gray-200 bg-indigo-50/30 p-2 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[10px] text-indigo-700 uppercase tracking-wide font-medium flex items-center gap-1">
                  <CornerDownRight size={11} /> …and then the retrace that followed {title}
                </p>
                <p className="text-[9px] text-gray-500 mt-0.5">
                  The pullback immediately after this leg. Depth is measured against this
                  leg, so "half" always means half of the leg you just described.
                  {index === 0 && ' For leg[0] this is the retrace running into the current bar.'}
                </p>
              </div>
              {!pb ? (
                <button type="button" onClick={() => set({ pullback: defaultPullbackRule() })}
                        className="shrink-0 flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded border border-indigo-300 text-indigo-700 hover:bg-indigo-100">
                  <Plus size={11} /> Add
                </button>
              ) : (
                <button type="button" onClick={() => set({ pullback: undefined })}
                        className="shrink-0 p-1 text-gray-400 hover:text-red-600" title="Remove the pullback rule">
                  <Trash2 size={12} />
                </button>
              )}
            </div>

            {pb && (
              <>
                <div>
                  <p className="text-[9px] text-gray-400 mb-0.5">Must a retrace exist?</p>
                  <SegmentedControl<'required' | 'optional' | 'forbidden'>
                    value={pb.presence ?? 'required'}
                    onChange={v => setPb({ presence: v })}
                    options={[
                      { value: 'required', label: 'Required', title: 'A retrace must have followed this leg.' },
                      { value: 'optional', label: 'Optional', title: 'May be absent — but when present it must still satisfy the conditions below.' },
                      { value: 'forbidden', label: 'None', title: 'The leg ran straight on: it is either the newest segment, or the next segment is another leg.' },
                    ]}
                  />
                  {(pb.presence ?? 'required') === 'forbidden' && (
                    <p className="text-[9px] text-amber-700 mt-1">
                      Matches only when this leg has no retrace yet — the conditions below are ignored.
                    </p>
                  )}
                </div>

                {(pb.presence ?? 'required') !== 'forbidden' && (
                  <>
                    <label className="flex items-center gap-1.5 text-[9px] text-gray-500 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={pb.allowForming === false}
                        onChange={e => setPb({ allowForming: !e.target.checked })}
                        className="accent-indigo-600"
                      />
                      Require the retrace to be complete
                      <span className="text-gray-400" title="The newest segment runs up to and including the current bar, so its candle count and averages are still growing. Tick this to exclude it.">(?)</span>
                    </label>

                    <div className="grid grid-cols-1 @3xl:grid-cols-2 @6xl:grid-cols-3 gap-2">
                      {PULLBACK_FIELDS.map(f => (
                        <BoundsControl
                          key={f} field={f} value={pb[f]} onChange={setPbBound(f)}
                          spread={spreads?.(f, 'pullback')}
                          labelOverride={f === 'depthRatio' ? `Gave back (× ${title})` : undefined}
                          tooltipOverride={f === 'depthRatio'
                            ? `Fraction of ${title} the retrace gave back. 0.5 = half. Exact by construction, because it is measured against the leg this position names.`
                            : undefined}
                        />
                      ))}
                    </div>

                    <RunCondEditor
                      runs={pb.runs ?? []}
                      onChange={runs => setPb({ runs: runs.length ? runs : undefined })}
                    />
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
