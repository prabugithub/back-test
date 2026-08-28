import { WINDOW_FIELD_BY_KEY, type WindowClause, type WindowField } from '../../../utils/legPattern';

/** The window aggregates worth putting in front of a user. The clause model supports more
 *  operators than this (`in`, `neq`, the null tests), but every genuinely useful window
 *  gate is a floor, a ceiling, or a band — so the UI speaks min/max and emits gte/lte. */
const SHOWN: WindowField[] = [
  'dominance', 'legBalance', 'legEfficiency', 'impulseCount', 'pullbackDepth', 'avgBrr',
];

interface WindowClauseEditorProps {
  clauses: WindowClause[];
  onChange: (c: WindowClause[]) => void;
  /** Live values at the current bar, so a threshold is chosen against the data. */
  actual?: Partial<Record<WindowField, number | undefined>>;
}

export function WindowClauseEditor({ clauses, onChange, actual }: WindowClauseEditorProps) {
  const valueOf = (field: WindowField, op: 'gte' | 'lte'): number | '' => {
    const c = clauses.find(x => x.field === field && x.op === op);
    return c && Number.isFinite(c.value as number) ? (c.value as number) : '';
  };

  const set = (field: WindowField, op: 'gte' | 'lte', raw: string) => {
    const rest = clauses.filter(c => !(c.field === field && c.op === op));
    if (raw === '') return onChange(rest);
    onChange([...rest, { field, op, value: Number(raw) }]);
  };

  return (
    <div className="grid grid-cols-1 @3xl:grid-cols-2 @6xl:grid-cols-3 gap-2">
      {SHOWN.map(field => {
        const def = WINDOW_FIELD_BY_KEY[field];
        const live = actual?.[field];
        return (
          <div key={field} className="border border-gray-200 rounded-lg p-2 space-y-1">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] text-gray-400 uppercase tracking-wide font-medium cursor-help" title={def.tooltip}>
                {def.label}
              </p>
              {live !== undefined && (
                <span className="text-[9px] text-gray-400">
                  now <span className="font-medium text-gray-500">{def.int ? Math.round(live) : live.toFixed(2)}</span>
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] text-gray-400">≥</span>
              <input
                type="number" min={def.uiMin} max={def.uiMax} step={def.step}
                value={valueOf(field, 'gte')} onChange={e => set(field, 'gte', e.target.value)}
                placeholder="—" className="w-14 px-1 py-0.5 text-[10px] border rounded text-center"
              />
              <span className="text-[9px] text-gray-400 ml-1">≤</span>
              <input
                type="number" min={def.uiMin} max={def.uiMax} step={def.step}
                value={valueOf(field, 'lte')} onChange={e => set(field, 'lte', e.target.value)}
                placeholder="—" className="w-14 px-1 py-0.5 text-[10px] border rounded text-center"
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
