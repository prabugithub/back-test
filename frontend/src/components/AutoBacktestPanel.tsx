import { useMemo, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  Zap, TrendingUp, TrendingDown, Minus, RefreshCw, BarChart2, Save, Trash2, FolderOpen,
  Settings2, Compass, LogIn, ShieldCheck, LogOut, ShieldAlert, Download, Calendar, X, Waves, Receipt,
} from 'lucide-react';
import { useSessionStore } from '../stores/sessionStore';
import { EntryMetricsDashboard } from './EntryMetricsDashboard';
import { PromptDialog } from './PromptDialog';
import { ConfirmDialog } from './ConfirmDialog';
import {
  type AutoBacktestConfig,
  type RegimeRules,
  type RegimeKey,
  defaultAutoBacktestConfig,
  AUTO_BT_PRESETS,
  REGIME_LABELS,
  getCurrentMarketState,
  resolveMinPivotGapBars,
  countActiveExitMechanisms,
} from '../utils/autoBacktestEngine';
import { useFilterPreviewData, type PreviewFilterKey } from '../hooks/useFilterPreviewData';
import { FilterPreviewStrip } from './autobacktest-visuals/FilterPreviewStrip';
import { HookDebugToggle } from './autobacktest-visuals/HookDebugToggle';
import { Chip } from './autobacktest-visuals/Chip';
import { ToggleSwitch } from './autobacktest-visuals/ToggleSwitch';
import { AccordionSection } from './autobacktest-visuals/AccordionSection';
import { StrategySummaryBar, countActiveConfirmationFilters, countLegPatternSlots } from './autobacktest-visuals/StrategySummaryBar';
import { LegPatternStep } from './autobacktest-visuals/legpattern/LegPatternStep';
import { SessionSettingsPanel } from './autobacktest-visuals/SessionSettingsPanel';
import {
  MarketStep, EntryStep, ConfirmationStep, ExitStep, RiskStep,
  type RegimeStepProps, type WorkflowStep, type StepDef,
} from './autobacktest-visuals/RegimeWorkflowSteps';
import { PageNavTabs, type ActivePage } from './PageNavTabs';
import { ChargesSettingsPanel } from './ChargesSettingsPanel';
import { useChargesStore } from '../stores/chargesStore';
import { computePositionsCharges } from '../utils/charges';
import { groupTradesIntoPositions } from '../utils/tradeAnalysis';
import { formatCurrency } from '../utils/formatters';

/** Tracks a CSS media query, so the panel renders exactly one of its two layouts. */
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

interface AutoBacktestPanelProps {
  onNavigate: (page: ActivePage) => void;
  /** Renders into a portal on document.body, so a hiding wrapper around <AutoBacktestPanel/>
   * in the caller's tree has no effect — visibility must be controlled via this prop instead. */
  hidden?: boolean;
}

// ─── Regime tab icons & colors ────────────────────────────────────────────────

const REGIME_META: Record<RegimeKey, { icon: React.ReactNode; color: string; bg: string; border: string; activeBg: string }> = {
  uptrend: {
    icon: <TrendingUp size={13} />,
    color: 'text-green-700',
    bg: 'bg-green-50',
    border: 'border-green-200',
    activeBg: 'bg-green-600',
  },
  downtrend: {
    icon: <TrendingDown size={13} />,
    color: 'text-red-700',
    bg: 'bg-red-50',
    border: 'border-red-200',
    activeBg: 'bg-red-600',
  },
  range: {
    icon: <Minus size={13} />,
    color: 'text-amber-700',
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    activeBg: 'bg-amber-500',
  },
  reversal: {
    icon: <RefreshCw size={13} />,
    color: 'text-purple-700',
    bg: 'bg-purple-50',
    border: 'border-purple-200',
    activeBg: 'bg-purple-600',
  },
};

const WORKFLOW_STEPS: StepDef[] = [
  { key: 'market', label: 'Market', icon: <Compass size={14} /> },
  { key: 'entry', label: 'Entry', icon: <LogIn size={14} /> },
  { key: 'confirmation', label: 'Confirmation', icon: <ShieldCheck size={14} /> },
  { key: 'pattern', label: 'Leg Pattern', icon: <Waves size={14} /> },
  { key: 'exit', label: 'Exit', icon: <LogOut size={14} /> },
  { key: 'risk', label: 'Risk', icon: <ShieldAlert size={14} /> },
];

// ─── Regime rules editor — thin step-content switcher ─────────────────────────

const STEP_COMPONENTS: Record<WorkflowStep, React.ComponentType<RegimeStepProps>> = {
  market: MarketStep,
  entry: EntryStep,
  confirmation: ConfirmationStep,
  pattern: LegPatternStep,
  exit: ExitStep,
  risk: RiskStep,
};

interface RegimeEditorProps {
  regime: RegimeKey;
  rules: RegimeRules;
  onChange: (rules: RegimeRules) => void;
  latestBar: RegimeStepProps['latestBar'];
  onHoverFilterKey: (key: PreviewFilterKey | null) => void;
  steps: StepDef[];
  /** null = every section collapsed. */
  activeStep: WorkflowStep | null;
  onStepChange: (step: WorkflowStep | null) => void;
  accentBg: string;
  accentColor: string;
  config: AutoBacktestConfig;
  onOpenSessionSettings: () => void;
}

function RegimeEditor({
  regime, rules, onChange, latestBar, onHoverFilterKey, steps, activeStep, onStepChange, accentBg, accentColor, config, onOpenSessionSettings,
}: RegimeEditorProps) {
  const meta = REGIME_META[regime];
  const up = (patch: Partial<RegimeRules>) => onChange({ ...rules, ...patch });
  const [showGuide, setShowGuide] = useState(false);
  const isShort = rules.direction === 'SHORT_ONLY';
  const isBoth = rules.direction === 'BOTH';

  const stepProps: RegimeStepProps = {
    rules, up, meta, latestBar, isShort, isBoth, onHoverFilterKey, showGuide, setShowGuide, config, onOpenSessionSettings,
  };

  return (
    <div className="space-y-2">
      {steps.map(step => {
        const isExpanded = step.key === activeStep;
        const StepComponent = STEP_COMPONENTS[step.key];
        return (
          <AccordionSection
            key={step.key}
            step={step}
            isExpanded={isExpanded}
            onToggle={() => onStepChange(isExpanded ? null : step.key)}
            accentBg={accentBg}
            accentColor={accentColor}
          >
            {isExpanded && <StepComponent {...stepProps} />}
          </AccordionSection>
        );
      })}
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export function AutoBacktestPanel({ onNavigate, hidden }: AutoBacktestPanelProps) {
  const config = useSessionStore(s => s.autoBacktestConfig);
  const lastSignalReason = useSessionStore(s => s.lastAutoSignalReason);
  const setAutoBacktestConfig = useSessionStore(s => s.setAutoBacktestConfig);
  const position = useSessionStore(s => s.position);
  const candles = useSessionStore(s => s.candles);
  const currentIndex = useSessionStore(s => s.currentIndex);
  const runBatchAutoBacktest = useSessionStore(s => s.runBatchAutoBacktest);
  const isBatchRunning = useSessionStore(s => s.isBatchBacktestRunning);
  const hookDebugMode = useSessionStore(s => s.hookDebugMode);
  const batchProgress = useSessionStore(s => s.batchBacktestProgress);
  const trades = useSessionStore(s => s.trades);
  const sessionConfig = useSessionStore(s => s.sessionConfig);
  const reloadCandlesWithRange = useSessionStore(s => s.reloadCandlesWithRange);

  const savedConfigs = useSessionStore(s => s.savedAutoBacktestConfigs);
  const activeConfigId = useSessionStore(s => s.activeAutoBacktestConfigId);
  const activeConfigName = useSessionStore(s => s.activeAutoBacktestConfigName);
  const loadSavedAutoBacktestConfigsList = useSessionStore(s => s.loadSavedAutoBacktestConfigsList);
  const saveAutoBacktestConfigAs = useSessionStore(s => s.saveAutoBacktestConfigAs);
  const updateActiveAutoBacktestConfig = useSessionStore(s => s.updateActiveAutoBacktestConfig);
  const applySavedAutoBacktestConfig = useSessionStore(s => s.applySavedAutoBacktestConfig);
  const deleteSavedAutoBacktestConfig = useSessionStore(s => s.deleteSavedAutoBacktestConfig);

  const [activeRegime, setActiveRegime] = useState<RegimeKey>('uptrend');
  const [activeStep, setActiveStep] = useState<WorkflowStep | null>('market');
  const [showMetrics, setShowMetrics] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showConfigs, setShowConfigs] = useState(false);
  const isWide = useMediaQuery('(min-width: 1024px)');
  const [selectedConfigId, setSelectedConfigId] = useState('');
  const [isSaveAsOpen, setIsSaveAsOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [isSessionSettingsOpen, setIsSessionSettingsOpen] = useState(false);
  const [isChargesPanelOpen, setIsChargesPanelOpen] = useState(false);
  const showCharges = useChargesStore(s => s.showCharges);
  const setShowCharges = useChargesStore(s => s.setShowCharges);
  const chargesConfig = useChargesStore(s => s.config);

  // Gross / charges / net over CLOSED positions of the current run — display-time
  // overlay only; the batch result and stored trade P&L stay gross.
  const chargesSummary = useMemo(() => {
    if (!showCharges || trades.length === 0) return null;
    const closed = groupTradesIntoPositions(trades).filter(p => p.status === 'CLOSED');
    const { totals } = computePositionsCharges(closed, chargesConfig);
    const gross = closed.reduce((sum, p) => sum + p.realizedPnL, 0);
    return { gross, totals, net: gross - totals.total };
  }, [showCharges, trades, chargesConfig]);
  const [hoveredFilterKey, setHoveredFilterKey] = useState<PreviewFilterKey | null>(null);

  // Date range control — lets the date span be changed without leaving this page
  // (previously required going back to the chart page's Data Settings panel).
  const [showDateRange, setShowDateRange] = useState(false);
  const [rangeFromDate, setRangeFromDate] = useState('');
  const [rangeToDate, setRangeToDate] = useState('');
  const [rangeSelectedYear, setRangeSelectedYear] = useState(''); // '' = custom range
  const [isRangeReloading, setIsRangeReloading] = useState(false);

  const rangeYearOptions = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const years: number[] = [];
    for (let y = currentYear; y >= 2015; y--) years.push(y);
    return years;
  }, []);

  // Sync draft range with session config whenever the popover opens
  useEffect(() => {
    if (showDateRange && sessionConfig) {
      setRangeFromDate(sessionConfig.fromDate || '');
      setRangeToDate(sessionConfig.toDate || '');
      setRangeSelectedYear('');
    }
  }, [showDateRange, sessionConfig]);

  const handleRangeYearSelect = (year: string) => {
    setRangeSelectedYear(year);
    if (year) {
      const currentYear = new Date().getFullYear();
      setRangeFromDate(`${year}-01-01`);
      // Cap "to date" at today for the current year so we don't request future data
      setRangeToDate(Number(year) === currentYear ? new Date().toISOString().split('T')[0] : `${year}-12-31`);
    }
  };

  const handleLoadDateRange = async () => {
    if (!sessionConfig) return;
    setIsRangeReloading(true);
    const success = await reloadCandlesWithRange(rangeFromDate, rangeToDate, sessionConfig.interval);
    setIsRangeReloading(false);
    if (success) setShowDateRange(false);
  };

  useEffect(() => {
    loadSavedAutoBacktestConfigsList();
  }, []);

  // Keep the dropdown selection in sync with whichever saved config is active
  // (e.g. right after Save As, or after Load)
  useEffect(() => {
    if (activeConfigId) setSelectedConfigId(activeConfigId);
  }, [activeConfigId]);

  // Live market state
  const marketState = useMemo(
    () => getCurrentMarketState(candles, currentIndex, resolveMinPivotGapBars(config), config),
    [candles, currentIndex, config]
  );

  const activeRules = config[activeRegime];
  const previewBars = useFilterPreviewData(candles, currentIndex, activeRules, config, activeRegime);
  const latestBar = previewBars[previewBars.length - 1];

  const updateGlobal = (patch: Partial<AutoBacktestConfig>) =>
    setAutoBacktestConfig({ ...config, ...patch });

  const updateRegime = (regime: RegimeKey) => (rules: RegimeRules) =>
    setAutoBacktestConfig({ ...config, [regime]: rules });

  const applyPreset = (name: string) => {
    const preset = AUTO_BT_PRESETS[name];
    if (!preset) return;
    const next: AutoBacktestConfig = {
      ...defaultAutoBacktestConfig,
      ...preset,
      enabled: config.enabled,
      // Preserve session-level settings — presets only change regime rules
      tradeStartTime: config.tradeStartTime,
      tradeEndTime: config.tradeEndTime,
      useAutoQty: config.useAutoQty,
      riskPerTrade: config.riskPerTrade,
      minQuantity: config.minQuantity,
      maxQuantity: config.maxQuantity,
      lotSize: config.lotSize,
    };
    // Carry the custom entry AND exit hooks across. No preset defines either, so spreading
    // defaultAutoBacktestConfig would silently switch a configured hook off — the run would
    // then quietly go back to the built-in chain with no indication the strategy had been
    // dropped. Presets describe filter thresholds; they have no opinion on your hooks.
    for (const k of ['uptrend', 'downtrend', 'range', 'reversal'] as RegimeKey[]) {
      next[k] = {
        ...next[k],
        entryHookId: config[k].entryHookId,
        entryHookMode: config[k].entryHookMode,
        exitHookId: config[k].exitHookId,
        exitHookMode: config[k].exitHookMode,
      };
    }
    setAutoBacktestConfig(next);
  };

  const handleExportConfig = () => {
    const exportPayload = {
      name: activeConfigName || 'unsaved-auto-bt-config',
      exportedAt: new Date().toISOString(),
      config,
    };
    const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName = (activeConfigName || 'unsaved').replace(/[^a-zA-Z0-9-_]/g, '_');
    a.download = `autobt-config-${safeName}-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const regimes: RegimeKey[] = ['uptrend', 'downtrend', 'range', 'reversal'];
  const confirmationCount = countActiveConfirmationFilters(activeRules);
  const exitMechanismCount = countActiveExitMechanisms(activeRules);
  const patternSlotCount = countLegPatternSlots(activeRules);
  const stepsWithBadge: StepDef[] = WORKFLOW_STEPS.map(s =>
    s.key === 'confirmation' ? { ...s, badge: confirmationCount }
      : s.key === 'exit' ? { ...s, badge: exitMechanismCount }
      : s.key === 'pattern' ? { ...s, badge: patternSlotCount }
      : s
  );

  // ── Layout building blocks ─────────────────────────────────────────────────
  // Each block is defined once and placed by one of two layouts: a side rail at ≥ lg
  // (settings get the full height on the right) or a compact stacked layout below lg.
  const regimeTabs = (inline: boolean) => (
    <div className={inline ? 'flex gap-1' : 'grid grid-cols-2 gap-1'}>
      {regimes.map(r => {
        const meta = REGIME_META[r];
        const isActive = activeRegime === r;
        const isCurrentMarket = marketState.regime === r;
        return (
          <button
            key={r}
            // Keep the open section (or all-collapsed) when switching regimes
            onClick={() => setActiveRegime(r)}
            className={`flex-1 flex items-center rounded-lg border text-[10px] font-medium transition-all duration-150 active:scale-[0.98] relative ${
              inline ? 'flex-row justify-center gap-1 py-1' : 'flex-col gap-0.5 py-1.5'
            } ${
              isActive
                ? `${meta.activeBg} text-white border-transparent shadow-sm`
                : `${meta.bg} ${meta.color} ${meta.border} hover:brightness-95`
            }`}
          >
            {meta.icon}
            <span>{REGIME_LABELS[r]}</span>
            {isCurrentMarket && (
              <div className={`absolute -top-1 -right-1 w-2 h-2 rounded-full border border-white ${isActive ? 'bg-white' : meta.activeBg}`} title="Current market" />
            )}
            {config[r].enabled && (
              <div className={`absolute bottom-0.5 right-1 w-1 h-1 rounded-full ${isActive ? 'bg-white/70' : meta.activeBg}`} />
            )}
          </button>
        );
      })}
    </div>
  );

  const marketChips = (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">Market:</span>
      <Chip tone="neutral">LT {marketState.ltMarket}</Chip>
      <Chip tone={marketState.htMarket === 'Bull-Trend' ? 'green' : marketState.htMarket === 'Bear-Trend' ? 'red' : 'neutral'}>
        HT {marketState.htMarket}
      </Chip>
    </div>
  );

  const presetButtons = (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">Presets:</span>
      {Object.keys(AUTO_BT_PRESETS).map(name => (
        <button key={name} onClick={() => applyPreset(name)}
          className="px-2 py-1 text-[10px] bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-lg hover:bg-indigo-100 font-medium transition-all duration-150 active:scale-95">
          {name}
        </button>
      ))}
    </div>
  );

  // The select takes the row and the buttons wrap under it when the space is narrow (the rail).
  const savedConfigControls = (
    <div className="flex flex-wrap items-center gap-1.5">
      <select
        value={selectedConfigId}
        onChange={e => setSelectedConfigId(e.target.value)}
        className="flex-1 min-w-[180px] text-[11px] border border-gray-300 rounded-lg px-2 py-1 bg-white"
      >
        <option value="">
          {savedConfigs.length === 0 ? 'No saved configurations' : 'Select a saved configuration...'}
        </option>
        {savedConfigs.map(c => (
          <option key={c.id} value={c.id}>
            {c.name}{c.id === activeConfigId ? ' (active)' : ''}
          </option>
        ))}
      </select>
      <button
        onClick={() => selectedConfigId && applySavedAutoBacktestConfig(selectedConfigId)}
        disabled={!selectedConfigId}
        title="Load selected configuration"
        className="px-2 py-1 text-[10px] bg-blue-50 text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-100 font-medium disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1 transition-all duration-150 active:scale-95"
      >
        <FolderOpen size={12} /> Load
      </button>
      <button
        onClick={() => selectedConfigId && setIsDeleteConfirmOpen(true)}
        disabled={!selectedConfigId}
        title="Delete selected configuration"
        className="px-2 py-1 text-[10px] bg-red-50 text-red-700 border border-red-200 rounded-lg hover:bg-red-100 font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-150 active:scale-95"
      >
        <Trash2 size={12} />
      </button>
      <button
        onClick={() => updateActiveAutoBacktestConfig()}
        disabled={!activeConfigId}
        title={activeConfigId ? 'Overwrite the active saved configuration' : 'Load or Save As a configuration first'}
        className="px-2 py-1 text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg hover:bg-emerald-100 font-medium disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1 transition-all duration-150 active:scale-95"
      >
        <Save size={12} /> Save
      </button>
      <button
        onClick={() => setIsSaveAsOpen(true)}
        className="px-2 py-1 text-[10px] bg-gray-50 text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-100 font-medium transition-all duration-150 active:scale-95 whitespace-nowrap"
      >
        Save As...
      </button>
      <button
        onClick={handleExportConfig}
        title="Export current auto-backtest settings as JSON"
        className="px-2 py-1 text-[10px] bg-green-50 text-green-700 border border-green-200 rounded-lg hover:bg-green-100 font-medium flex items-center gap-1 transition-all duration-150 active:scale-95"
      >
        <Download size={12} /> Export
      </button>
    </div>
  );

  const previewAndSummary = (
    <div className="shrink-0 border-b border-slate-200 bg-white px-4 py-2 space-y-1.5">
      <button
        onClick={() => setShowPreview(v => !v)}
        className="w-full flex items-center justify-between text-[10px] font-semibold text-gray-500 hover:text-gray-700 transition-colors"
      >
        <span className="flex items-center gap-1.5 uppercase tracking-wide">
          <BarChart2 size={11} />
          Live Preview Chart
        </span>
        <span className="text-[10px] text-gray-400">{showPreview ? '▲ Hide' : '▼ Show'}</span>
      </button>
      {showPreview && (
        <FilterPreviewStrip bars={previewBars} highlightFilterKey={hoveredFilterKey} height={90} />
      )}
      <StrategySummaryBar regime={activeRegime} rules={activeRules} onJumpToStep={setActiveStep} />
    </div>
  );

  const editorContent = (
    <>
      <RegimeEditor
        regime={activeRegime}
        rules={activeRules}
        onChange={updateRegime(activeRegime)}
        latestBar={latestBar}
        onHoverFilterKey={setHoveredFilterKey}
        steps={stepsWithBadge}
        activeStep={activeStep}
        onStepChange={setActiveStep}
        accentBg={REGIME_META[activeRegime].activeBg}
        accentColor={REGIME_META[activeRegime].color}
        config={config}
        onOpenSessionSettings={() => setIsSessionSettingsOpen(true)}
      />

      {/* Entry Metrics Dashboard — shown when batch trades with journal data exist */}
      {trades.some(t => t.journal?.ltMarket) && (
        <div className="mt-3 border border-indigo-100 rounded-lg overflow-hidden">
          <button
            onClick={() => setShowMetrics(v => !v)}
            className="w-full flex items-center justify-between px-3 py-2 bg-indigo-50 hover:bg-indigo-100 text-[11px] font-semibold text-indigo-700 transition-colors"
          >
            <span className="flex items-center gap-1.5">
              <BarChart2 size={12} />
              Entry Position Metrics
            </span>
            <span className="text-[10px] text-indigo-400">{showMetrics ? '▲' : '▼'}</span>
          </button>
          {showMetrics && (
            <div className="px-3 pb-3">
              <EntryMetricsDashboard trades={trades} chargesConfig={showCharges ? chargesConfig : undefined} />
            </div>
          )}
        </div>
      )}
    </>
  );

  const lastSignalText = !config.enabled ? 'Enable to start scanning'
    : position ? 'Position open — waiting for exit'
    : lastSignalReason || 'No signal yet — press Play to run';
  const lastSignalTone = !config.enabled ? 'text-gray-400'
    : position ? 'text-orange-600'
    : lastSignalReason ? 'text-indigo-700' : 'text-gray-400';

  // inline = one-row footer of the stacked layout; otherwise the rail's vertical footer.
  const runPanel = (inline: boolean) => {
    const runButton = (
      <button
        onClick={runBatchAutoBacktest}
        disabled={isBatchRunning || candles.length === 0 || !config.enabled}
        className={`${inline ? 'shrink-0 px-4' : 'w-full px-3'} py-2.5 ${hookDebugMode ? 'bg-amber-600 hover:bg-amber-700' : 'bg-indigo-600 hover:bg-indigo-700'} disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold rounded-lg flex items-center justify-center gap-2 transition-all duration-150 active:scale-[0.99] shadow-sm hover:shadow-md whitespace-nowrap`}
      >
        {isBatchRunning ? (
          <>
            <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
            </svg>
            {hookDebugMode ? 'Running on main thread…' : 'Running...'}
          </>
        ) : (
          <>
            <Zap size={13} />
            {hookDebugMode ? 'Run Full Backtest (main thread)' : 'Run Full Backtest (instant)'}
          </>
        )}
      </button>
    );
    const lastSignal = (
      <div
        title={inline ? lastSignalText : undefined}
        className={`rounded p-2 text-[11px] ${inline ? 'flex-1 min-w-[160px] truncate' : ''} ${config.enabled ? 'bg-indigo-50 border border-indigo-200' : 'bg-gray-50 border border-gray-200'}`}
      >
        <span className="font-medium text-gray-600">Last signal: </span>
        <span className={`${lastSignalTone} ${inline ? '' : '[overflow-wrap:anywhere]'}`}>{lastSignalText}</span>
      </div>
    );
    return (
      <>
        {!inline && lastSignal}

        {trades.length > 0 && !isBatchRunning && (
          <div className={`rounded p-2 text-[11px] flex items-center gap-2 ${chargesSummary ? 'bg-amber-50 border border-amber-200' : 'bg-gray-50 border border-gray-200'}`}>
            <Receipt size={12} className="text-amber-600 shrink-0" />
            {chargesSummary ? (
              <span className="flex-1 min-w-0 text-gray-600" title={`Brokerage ${chargesSummary.totals.brokerage.toFixed(2)} | STT ${chargesSummary.totals.stt.toFixed(2)} | Exch ${chargesSummary.totals.exchange.toFixed(2)} | GST ${chargesSummary.totals.gst.toFixed(2)} | Stamp ${chargesSummary.totals.stamp.toFixed(2)} | SEBI+IPFT ${(chargesSummary.totals.sebi + chargesSummary.totals.ipft).toFixed(2)} | Turnover ${formatCurrency(chargesSummary.totals.turnover)} (${chargesSummary.totals.orders} orders)`}>
                Gross <b className={chargesSummary.gross >= 0 ? 'text-green-600' : 'text-red-600'}>{formatCurrency(chargesSummary.gross)}</b>
                {' · '}Charges <b className="text-amber-600">{formatCurrency(chargesSummary.totals.total)}</b>
                {' · '}Net <b className={chargesSummary.net >= 0 ? 'text-green-600' : 'text-red-600'}>{formatCurrency(chargesSummary.net)}</b>
                {inline && (
                  <span className="text-gray-400">{' · '}Turnover {formatCurrency(chargesSummary.totals.turnover)} ({chargesSummary.totals.orders} orders)</span>
                )}
              </span>
            ) : (
              <span className="flex-1 text-gray-400">Charges hidden — P&amp;L shown gross</span>
            )}
            <button
              onClick={() => setShowCharges(!showCharges)}
              className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold text-amber-700 hover:bg-amber-100"
            >
              {showCharges ? 'Hide' : 'Show charges'}
            </button>
            <button
              onClick={() => setIsChargesPanelOpen(true)}
              className="shrink-0 p-0.5 rounded text-amber-700 hover:bg-amber-100"
              title="Edit charge rates"
            >
              <Settings2 size={12} />
            </button>
          </div>
        )}

        {isBatchRunning && (
          <div>
            <div className="flex justify-between text-[10px] text-gray-500 mb-1">
              <span>Processing candles…</span>
              <span>{batchProgress}%</span>
            </div>
            <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-500 rounded-full transition-all duration-150"
                style={{ width: `${batchProgress}%` }}
              />
            </div>
          </div>
        )}

        {inline ? (
          <div className="flex flex-wrap items-center gap-2">
            {lastSignal}
            <div className="w-52 shrink-0"><HookDebugToggle compact /></div>
            {runButton}
          </div>
        ) : (
          <>
            <HookDebugToggle compact />
            {runButton}
          </>
        )}
      </>
    );
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[110] bg-slate-50 flex flex-col overflow-hidden font-sans"
      style={{ display: hidden ? 'none' : undefined }}
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3 py-2 lg:px-6 lg:py-3 short:py-1.5 bg-white border-b border-slate-200 shrink-0">
        <div className="flex items-center gap-4 min-w-0">
          <PageNavTabs active="backtest" onNavigate={onNavigate} />
          <div className="w-px h-6 bg-slate-200 hidden 2xl:block" />
          <div className="bg-indigo-600 p-2 rounded-xl text-white shadow-lg shadow-indigo-200 hidden 2xl:block">
            <Zap size={20} />
          </div>
          <div className="hidden 2xl:block">
            <h2 className="text-xl font-bold text-slate-800 tracking-tight">Auto Backtesting Engine</h2>
            <p className="text-slate-500 text-xs font-medium">Configure regime rules and run instant batch backtests</p>
          </div>

          {/* Date Range — change the loaded data span without leaving this page */}
          <div className="relative">
            <button
              onClick={() => setShowDateRange(v => !v)}
              disabled={!sessionConfig}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 hover:border-slate-300 transition-all duration-150 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
              title="Change the loaded date range"
            >
              <Calendar size={14} />
              {sessionConfig?.fromDate && sessionConfig?.toDate
                ? `${sessionConfig.fromDate} → ${sessionConfig.toDate}`
                : 'Date Range'}
            </button>

            {showDateRange && (
              <div className="absolute top-full left-0 mt-2 bg-white border-2 border-gray-300 rounded-lg shadow-2xl p-4 z-[120] min-w-[280px]">
                <div className="flex items-center justify-between mb-3 pb-2 border-b">
                  <h3 className="font-bold text-sm text-gray-800">Date Range</h3>
                  <button onClick={() => setShowDateRange(false)} className="text-gray-400 hover:text-gray-600">
                    <X size={16} />
                  </button>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">Year</label>
                    <select
                      value={rangeSelectedYear}
                      onChange={(e) => handleRangeYearSelect(e.target.value)}
                      className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">Custom Range</option>
                      {rangeYearOptions.map((y) => (
                        <option key={y} value={y}>{y}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">From Date</label>
                    <input
                      type="date"
                      value={rangeFromDate}
                      onChange={(e) => { setRangeFromDate(e.target.value); setRangeSelectedYear(''); }}
                      className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">To Date</label>
                    <input
                      type="date"
                      value={rangeToDate}
                      onChange={(e) => { setRangeToDate(e.target.value); setRangeSelectedYear(''); }}
                      className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <button
                    onClick={handleLoadDateRange}
                    disabled={isRangeReloading || !rangeFromDate || !rangeToDate}
                    className="w-full px-3 py-2 bg-blue-600 text-white rounded font-medium text-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isRangeReloading ? 'Loading...' : 'Load Data'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Enable + quick controls */}
        <div className="flex items-center gap-3 lg:gap-4">
          <label className="flex items-center gap-1.5 cursor-pointer select-none whitespace-nowrap">
            <input type="checkbox" checked={config.skipIfPositionOpen}
              onChange={e => updateGlobal({ skipIfPositionOpen: e.target.checked })}
              className="w-3.5 h-3.5" />
            <span className="text-xs text-slate-600 font-medium">Skip if open</span>
          </label>
          <button
            onClick={() => setIsSessionSettingsOpen(true)}
            title="Session Settings"
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 hover:border-slate-300 transition-all duration-150 active:scale-95 whitespace-nowrap"
          >
            <Settings2 size={14} />
            <span className="hidden xl:inline">Session Settings</span>
          </button>
          <label className="flex items-center gap-2 cursor-pointer select-none whitespace-nowrap">
            <ToggleSwitch checked={config.enabled} onChange={v => updateGlobal({ enabled: v })} size="md" />
            <span className={`text-xs font-bold ${config.enabled ? 'text-indigo-700' : 'text-gray-400'}`}>
              {config.enabled ? 'Running' : 'Off'}
            </span>
          </label>
        </div>
      </div>

      {/* Main Content */}
      {isWide ? (
        // ≥ lg: left rail (regimes, configs, presets, Run) + full-height settings on the right
        <div className="flex-1 flex flex-row overflow-hidden">
          <aside className="w-64 xl:w-72 shrink-0 flex flex-col border-r border-slate-200 bg-white">
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              {regimeTabs(false)}
              {marketChips}
              <div className="space-y-1.5">
                <div className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">Configuration</div>
                {savedConfigControls}
              </div>
              {presetButtons}
            </div>
            {/* Run panel — pinned to the rail bottom, always reachable */}
            <div className="shrink-0 border-t border-slate-200 p-3 space-y-2">
              {runPanel(false)}
            </div>
          </aside>
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
            {previewAndSummary}
            {/* Scrollable accordion content */}
            <div className="flex-1 overflow-y-auto p-4 @container">
              {editorContent}
            </div>
          </div>
        </div>
      ) : (
        // < lg: compact stacked layout; the whole body scrolls so a short screen never squeezes the editor
        <div className="flex-1 flex flex-col overflow-y-auto">
          {previewAndSummary}
          <div className="shrink-0 border-b border-slate-200 bg-white px-4 py-2 space-y-2">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              {marketChips}
              <button
                onClick={() => setShowConfigs(v => !v)}
                className="ml-auto px-2 py-1 text-[10px] bg-gray-50 text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-100 font-medium whitespace-nowrap"
              >
                Configs{activeConfigName ? `: ${activeConfigName}` : ''} {showConfigs ? '▲' : '▼'}
              </button>
            </div>
            {showConfigs && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                {presetButtons}
                <div className="flex-1 min-w-[260px]">{savedConfigControls}</div>
              </div>
            )}
          </div>

          {/* Regime tabs */}
          <div className="shrink-0 bg-white px-4 py-1.5 border-b border-slate-200">
            {regimeTabs(true)}
          </div>

          <div className="flex-1 min-h-[60vh] p-4 @container">
            {editorContent}
          </div>

          {/* Run bar — sticky so it stays reachable while the page scrolls */}
          <div className="sticky bottom-0 shrink-0 border-t border-slate-200 bg-white p-2 space-y-2">
            {runPanel(true)}
          </div>
        </div>
      )}

      <PromptDialog
        isOpen={isSaveAsOpen}
        onClose={() => setIsSaveAsOpen(false)}
        onSubmit={(name) => saveAutoBacktestConfigAs(name)}
        title="Save Auto-Backtest Configuration"
        message="Enter a name for this configuration setup so you can load it again later."
        placeholder="Configuration Name..."
        confirmText="Save"
      />
      <ConfirmDialog
        isOpen={isDeleteConfirmOpen}
        onClose={() => setIsDeleteConfirmOpen(false)}
        onConfirm={() => {
          deleteSavedAutoBacktestConfig(selectedConfigId);
          setSelectedConfigId('');
        }}
        title="Delete Configuration"
        message={`Delete "${savedConfigs.find(c => c.id === selectedConfigId)?.name ?? ''}"? This cannot be undone.`}
        confirmText="Delete"
        isDestructive
      />

      <SessionSettingsPanel
        config={config}
        onChange={updateGlobal}
        isOpen={isSessionSettingsOpen}
        onClose={() => setIsSessionSettingsOpen(false)}
        onOpenCharges={() => setIsChargesPanelOpen(true)}
      />
      <ChargesSettingsPanel isOpen={isChargesPanelOpen} onClose={() => setIsChargesPanelOpen(false)} />
    </div>,
    document.body
  );
}
