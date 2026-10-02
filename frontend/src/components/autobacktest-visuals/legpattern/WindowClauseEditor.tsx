import { WINDOW_FIELD_BY_KEY, type WindowClause, type WindowField } from '../../../utils/legPattern';

/** The window aggregates worth putting in front of a user. The clause model supports more
 *  operators than this (`in`, `neq`, the null tests), but every genuinely useful window
 *  gate is a floor, a ceiling, or a band — so the UI speaks min/max and emits gte/lte. */
const SHOWN: WindowField[] = [
  'dominance', 'legBalance', 'legEfficiency', 'impulseCount', 'pullbackDepth', 'avgBrr',
];

/** Categorical aggregates (pivot market structure) — chips emitting one `in` clause. */
const CATEGORICAL: WindowField[] = ['structureBroad', 'structureSub'];

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

  const picked = (field: WindowField): number[] => {
    const c = clauses.find(x => x.field === field && x.op === 'in');
    return c && Array.isArray(c.value) ? c.value : [];
  };

  const toggle = (field: WindowField, code: number) => {
    const cur = picked(field);
    const next = cur.includes(code) ? cur.filter(v => v !== code) : [...cur, code];
    const rest = clauses.filter(c => !(c.field === field && c.op === 'in'));
    onChange(next.length ? [...rest, { field, op: 'in', value: next }] : rest);
  };

  return (
    <div className="grid grid-cols-1 @3xl:grid-cols-2 @6xl:grid-cols-3 gap-2">
      {CATEGORICAL.map(field => {
        const def = WINDOW_FIELD_BY_KEY[field];
        const live = actual?.[field];
        const sel = picked(field);
        return (
          <div key={field} className="border border-gray-200 rounded-lg p-2 space-y-1 @3xl:col-span-2 @6xl:col-span-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] text-gray-400 uppercase tracking-wide font-medium cursor-help" title={def.tooltip}>
                {def.label} {sel.length === 0 && <span className="normal-case">(any)</span>}
              </p>
              <span className="text-[9px] text-gray-400">
                now <span className="font-medium text-gray-500">{def.options?.find(o => o.value === live)?.label ?? 'forming'}</span>
              </span>
            </div>
            <div className="flex flex-wrap gap-1">
              {def.options?.map(o => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => toggle(field, o.value)}
                  className={`px-1.5 py-0.5 text-[10px] rounded border ${
                    sel.includes(o.value)
                      ? 'bg-indigo-600 border-indigo-600 text-white'
                      : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        );
      })}
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
