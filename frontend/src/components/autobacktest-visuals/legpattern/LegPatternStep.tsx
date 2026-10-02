import { useMemo } from 'react';
import { AlertTriangle, BarChart3, CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { useSessionStore } from '../../../stores/sessionStore';
import { CardShell } from '../CardShell';
import { SegmentedControl } from '../SegmentedControl';
import { ToggleSwitch } from '../ToggleSwitch';
import type { RegimeStepProps } from '../RegimeWorkflowSteps';
import { LegListEditor } from './LegListEditor';
import { WindowClauseEditor } from './WindowClauseEditor';
import { useLegPatternStats } from './useLegPatternStats';
import {
  RETRACE_MAX_PCT_CAP,
  RETRACE_WINDOW_MAX,
  RETRACE_WINDOW_MIN,
  buildLegWindow,
  computeAggregates,
  defaultLegPatternConfig,
  getMatcher,
  type LegPatternConfig,
} from '../../../utils/legPattern';

/**
 * The Leg Pattern step.
 *
 * What makes this different from every other filter step: the thing being configured is an
 * ORDERED shape, not a set of independent thresholds. So the two elements that carry the
 * most weight here are the plain-English readback under each section (proving the spec
 * says what its author meant — especially around the nesting) and the "why no match" panel
 * (because a spec matching zero windows is the normal failure mode, not an exception).
 */
export function LegPatternStep({ rules, up, meta, isShort, config }: RegimeStepProps) {
  const candles = useSessionStore(s => s.candles);
  const currentIndex = useSessionStore(s => s.currentIndex);

  const cfg = rules.legPattern;
  const windowLegs = config.legSequenceCount ?? 10;
  const patch = (p: Partial<LegPatternConfig>) =>
    up({ legPattern: { ...(cfg ?? defaultLegPatternConfig()), ...p } });

  const { stats, running, analyse } = useLegPatternStats(candles, currentIndex, windowLegs);

  const matcher = useMemo(() => getMatcher(cfg), [cfg]);

  // Hoisted so the memo below depends on a scalar rather than on `cfg` as a whole —
  // otherwise every unrelated edit to the pattern rebuilds the window.
  const legStrength = cfg?.thresholds?.legStrength ?? 0.6;
  const baselineLookback = config.barRangeLookback;
  const overlapLookback = config.barOverlapLookback;

  // The window at the current bar, for the live readouts and the explain panel.
  const live = useMemo(() => {
    if (!candles.length || currentIndex < 0 || currentIndex >= candles.length) return null;
    try {
      const w = buildLegWindow(candles, currentIndex, {
        windowLegs,
        needsPerCandle: matcher?.needsPerCandle ?? false,
        baselineLookback,
        overlapLookback,
      });
      return { window: w, agg: computeAggregates(w, null, legStrength) };
    } catch {
      return null;
    }
  }, [candles, currentIndex, windowLegs, matcher, baselineLookback, overlapLookback, legStrength]);

  const verdicts = useMemo(
    () => (matcher && live ? matcher.explain(live.window, !isShort) : null),
    [matcher, live, isShort]
  );

  const enabled = !!cfg?.enabled;
  const retrace = cfg?.retrace ?? { enabled: false, windowLegs: 10, maxPct: 32 };

  return (
    <div className="space-y-2">
      {/* ── Master ─────────────────────────────────────────────────────────── */}
      <CardShell
        title="Leg pattern"
        subtitle="An ordered shape over the recent legs — the thing an average can't express."
        action={<ToggleSwitch checked={enabled} onChange={v => patch({ enabled: v })} activeColor={meta.activeBg} />}
      >
        {!enabled ? (
          <p className="text-[10px] text-gray-400">
            Off — this regime's entries are not shape-filtered. Every other filter still applies.
          </p>
        ) : (
          <div className="space-y-2">
            <div>
              <p className="text-[9px] text-gray-400 mb-0.5">Read each leg's direction from</p>
              <SegmentedControl<'realized' | 'struct'>
                value={cfg?.sideBasis ?? 'realized'}
                onChange={v => patch({ sideBasis: v })}
                options={[
                  { value: 'realized', label: 'Where it ended up', title: 'The sign of the leg\'s actual open-to-close move.' },
                  { value: 'struct', label: 'Its structural label', title: 'What the Al Brooks leg machine tagged it. Note a PULLBACK is tagged with the direction opposite the leg it retraces.' },
                ]}
              />
              <p className="text-[9px] text-gray-400 mt-1">
                These disagree more often than you would expect — a leg can be labelled bull
                and still close below where it opened. Switch and re-run to see if it matters.
              </p>
            </div>

            {matcher?.error && (
              <div className="flex items-start gap-1.5 rounded border border-red-300 bg-red-50 p-2">
                <XCircle size={12} className="text-red-600 mt-0.5 shrink-0" />
                <p className="text-[10px] text-red-700">{matcher.error}</p>
              </div>
            )}

            {matcher && (
              <p className="text-[10px] text-gray-600 leading-snug bg-indigo-50 border border-indigo-200 rounded p-2">
                {matcher.describe()}
              </p>
            )}

            <div className="flex items-center gap-2">
              <button
                type="button" onClick={analyse} disabled={running || !candles.length}
                className="flex items-center gap-1 px-2 py-1 text-[10px] rounded border border-gray-300 text-gray-600 hover:bg-gray-100 disabled:opacity-50"
              >
                {running ? <Loader2 size={11} className="animate-spin" /> : <BarChart3 size={11} />}
                {running ? 'Analysing…' : 'Analyse my data'}
              </button>
              <p className="text-[9px] text-gray-400">
                {stats
                  ? `Typical ranges from ${stats.segments} segments over ${stats.sampledBars} bars — shown under each field.`
                  : 'Adds the real distribution under each field, so thresholds start near-neutral and get tightened.'}
              </p>
            </div>
          </div>
        )}
      </CardShell>

      {enabled && (
        <>
          {/* ── Window shape ─────────────────────────────────────────────── */}
          <CardShell title="Window shape" subtitle="Coarse gates on the whole window — cheap, and they reject most bars before the shape matcher runs.">
            <WindowClauseEditor
              clauses={cfg?.window ?? []}
              onChange={w => patch({ window: w })}
              actual={live?.agg}
            />
          </CardShell>

          {/* ── The ordered leg positions ─────────────────────────────────── */}
          <LegListEditor
            legs={cfg?.legs ?? []}
            onChange={l => patch({ legs: l })}
            spreads={stats?.lookup}
            availableLegs={live?.window.impulseIndices.length}
          />

          {/* ── Retrace gate ─────────────────────────────────────────────── */}
          <CardShell
            title="Retrace at the current bar"
            subtitle="How far into the whole recent structure price has come back — a different question from any single pullback's depth."
            action={
              <ToggleSwitch
                checked={retrace.enabled}
                onChange={v => patch({ retrace: { ...retrace, enabled: v } })}
                activeColor={meta.activeBg}
              />
            }
          >
            {retrace.enabled ? (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[9px] text-gray-500">over the newest</span>
                <input
                  type="number" min={RETRACE_WINDOW_MIN} max={RETRACE_WINDOW_MAX} step={1}
                  value={retrace.windowLegs}
                  onChange={e => patch({ retrace: { ...retrace, windowLegs: Number(e.target.value) } })}
                  className="w-12 px-1 py-0.5 text-[10px] border rounded text-center"
                />
                <span className="text-[9px] text-gray-500">segments, retraced at most</span>
                <input
                  type="number" min={0} max={RETRACE_MAX_PCT_CAP} step={1}
                  value={retrace.maxPct}
                  onChange={e => patch({ retrace: { ...retrace, maxPct: Number(e.target.value) } })}
                  className="w-12 px-1 py-0.5 text-[10px] border rounded text-center"
                />
                <span className="text-[9px] text-gray-500">%</span>
                <span className="text-[9px] text-gray-400 ml-auto" title={`Capped at ${RETRACE_MAX_PCT_CAP}% on load — a ceiling looser than that stops being a filter, and the cap cannot be raised by hand-editing a saved config.`}>
                  max {RETRACE_MAX_PCT_CAP}%
                </span>
              </div>
            ) : (
              <p className="text-[10px] text-gray-400">Off — entries are taken at any depth into the recent range.</p>
            )}
          </CardShell>

          {/* ── Why no match ─────────────────────────────────────────────── */}
          <CardShell
            title="At the current bar"
            subtitle="A spec that matches nothing is the normal starting point. This says which part rejected it."
            muted
          >
            {!verdicts || verdicts.length === 0 ? (
              <p className="text-[10px] text-gray-400">
                {matcher ? 'Nothing to evaluate — load candles and step to a bar.' : 'Nothing configured yet.'}
              </p>
            ) : (
              <div className="space-y-1">
                {verdicts.map((v, i) => (
                  <div key={i} className="flex items-start gap-1.5">
                    {v.pass
                      ? <CheckCircle2 size={11} className="text-green-600 mt-0.5 shrink-0" />
                      : <XCircle size={11} className="text-red-500 mt-0.5 shrink-0" />}
                    <p className="text-[10px] text-gray-600 leading-snug">
                      <span className="font-medium text-gray-500">{v.section}</span> — {v.detail}
                      {v.unknown > 0 && (
                        <span className="ml-1 text-amber-700" title="Conditions that could not be evaluated with the data at hand. These FAIL rather than passing, so a high count here means your data is incomplete, not that your spec is too tight.">
                          <AlertTriangle size={9} className="inline mb-0.5" /> {v.unknown} unevaluable
                        </span>
                      )}
                    </p>
                  </div>
                ))}
                {live && (
                  <p className="text-[9px] text-gray-400 pt-1">
                    Window: {live.window.features.length} segments
                    {live.window.features[0]?.isForming && ' · the newest is still forming, so its stats keep changing'}
                  </p>
                )}
              </div>
            )}
          </CardShell>
        </>
      )}
    </div>
  );
}
