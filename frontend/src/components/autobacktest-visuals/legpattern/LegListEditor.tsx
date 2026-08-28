import { Plus } from 'lucide-react';
import { CardShell } from '../CardShell';
import { LegSlotCard, type SpreadLookup } from './LegSlotCard';
import { MAX_LEG_SLOTS, defaultLegSlot, type LegSlot } from '../../../utils/legPattern';

interface LegListEditorProps {
  legs: LegSlot[];
  onChange: (legs: LegSlot[]) => void;
  spreads?: SpreadLookup;
  /** Impulse legs actually present in the window at the current bar, for the warning. */
  availableLegs?: number;
}

/**
 * The ordered leg list — the whole pattern.
 *
 * Position is meaning here: leg[0] is the most recent impulse leg, leg[1] the one before
 * it. There is no bull/bear split and no "where does this match" question, because the
 * index answers it. Each position states its own direction, so an uptrend shape is
 * literally "leg[0] bull, leg[1] bear, leg[2] bull" if that is what you want.
 */
export function LegListEditor({ legs, onChange, spreads, availableLegs }: LegListEditorProps) {
  const setSlot = (i: number) => (s: LegSlot) => onChange(legs.map((x, k) => (k === i ? s : x)));
  const removeSlot = (i: number) => () => onChange(legs.filter((_, k) => k !== i));
  const atCap = legs.length >= MAX_LEG_SLOTS;

  const short = availableLegs !== undefined && legs.length > availableLegs;

  return (
    <CardShell
      title="Leg positions"
      subtitle="leg[0] is the most recent impulse leg, counting back. Pullbacks are not numbered — each leg carries its own."
      action={
        <button
          type="button"
          disabled={atCap}
          onClick={() => onChange([...legs, defaultLegSlot('any')])}
          className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded border border-gray-300 text-gray-600 hover:bg-gray-100 disabled:opacity-40 shrink-0"
          title={atCap ? `At most ${MAX_LEG_SLOTS} positions` : undefined}
        >
          <Plus size={11} /> Add leg[{legs.length}]
        </button>
      }
    >
      <div className="space-y-2">
        {legs.length === 0 && (
          <p className="text-[10px] text-gray-400 py-1">
            No positions yet. Add leg[0] to start describing the shape — for an uptrend you
            would typically require it to be Bull.
          </p>
        )}

        {legs.map((s, i) => (
          <LegSlotCard
            key={i}
            slot={s}
            index={i}
            onChange={setSlot(i)}
            onRemove={removeSlot(i)}
            spreads={spreads}
          />
        ))}

        {short && (
          <p className="text-[9px] text-amber-700">
            The window at this bar holds only {availableLegs} impulse leg
            {availableLegs === 1 ? '' : 's'}, so a pattern naming {legs.length} positions
            rejects it. Raise <span className="font-medium">Leg Seq N</span> in Session
            Settings, or use fewer positions.
          </p>
        )}
      </div>
    </CardShell>
  );
}
