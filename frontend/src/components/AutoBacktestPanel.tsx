import { useMemo, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft, Zap, TrendingUp, TrendingDown, Minus, RefreshCw, BarChart2, Save, Trash2, FolderOpen,
  Settings2, Compass, LogIn, ShieldCheck, LogOut, ShieldAlert,
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
} from '../utils/autoBacktestEngine';
import { useFilterPreviewData, type PreviewFilterKey } from '../hooks/useFilterPreviewData';
import { FilterPreviewStrip } from './autobacktest-visuals/FilterPreviewStrip';
import { Chip } from './autobacktest-visuals/Chip';
import { ToggleSwitch } from './autobacktest-visuals/ToggleSwitch';
import { AccordionSection } from './autobacktest-visuals/AccordionSection';
import { StrategySummaryBar, countActiveConfirmationFilters } from './autobacktest-visuals/StrategySummaryBar';
import { SessionSettingsPanel } from './autobacktest-visuals/SessionSettingsPanel';
import {
  MarketStep, EntryStep, ConfirmationStep, ExitStep, RiskStep,
  type RegimeStepProps, type WorkflowStep, type StepDef,
} from './autobacktest-visuals/RegimeWorkflowSteps';

interface AutoBacktestPanelProps {
  onClose: () => void;
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
  { key: 'exit', label: 'Exit', icon: <LogOut size={14} /> },
  { key: 'risk', label: 'Risk', icon: <ShieldAlert size={14} /> },
];

// ─── Regime rules editor — thin step-content switcher ─────────────────────────

const STEP_COMPONENTS: Record<WorkflowStep, React.ComponentType<RegimeStepProps>> = {
  market: MarketStep,
  entry: EntryStep,
  confirmation: ConfirmationStep,
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
  activeStep: WorkflowStep;
  onStepChange: (step: WorkflowStep) => void;
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
            onToggle={() => onStepChange(step.key)}
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

export function AutoBacktestPanel({ onClose }: AutoBacktestPanelProps) {
  const config = useSessionStore(s => s.autoBacktestConfig);
  const lastSignalReason = useSessionStore(s => s.lastAutoSignalReason);
  const setAutoBacktestConfig = useSessionStore(s => s.setAutoBacktestConfig);
  const position = useSessionStore(s => s.position);
  const candles = useSessionStore(s => s.candles);
  const currentIndex = useSessionStore(s => s.currentIndex);
  const runBatchAutoBacktest = useSessionStore(s => s.runBatchAutoBacktest);
  const isBatchRunning = useSessionStore(s => s.isBatchBacktestRunning);
  const batchProgress = useSessionStore(s => s.batchBacktestProgress);
  const trades = useSessionStore(s => s.trades);

  const savedConfigs = useSessionStore(s => s.savedAutoBacktestConfigs);
  const activeConfigId = useSessionStore(s => s.activeAutoBacktestConfigId);
  const loadSavedAutoBacktestConfigsList = useSessionStore(s => s.loadSavedAutoBacktestConfigsList);
  const saveAutoBacktestConfigAs = useSessionStore(s => s.saveAutoBacktestConfigAs);
  const updateActiveAutoBacktestConfig = useSessionStore(s => s.updateActiveAutoBacktestConfig);
  const applySavedAutoBacktestConfig = useSessionStore(s => s.applySavedAutoBacktestConfig);
  const deleteSavedAutoBacktestConfig = useSessionStore(s => s.deleteSavedAutoBacktestConfig);

  const [activeRegime, setActiveRegime] = useState<RegimeKey>('uptrend');
  const [activeStep, setActiveStep] = useState<WorkflowStep>('market');
  const [showMetrics, setShowMetrics] = useState(false);
  const [selectedConfigId, setSelectedConfigId] = useState('');
  const [isSaveAsOpen, setIsSaveAsOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [isSessionSettingsOpen, setIsSessionSettingsOpen] = useState(false);
  const [hoveredFilterKey, setHoveredFilterKey] = useState<PreviewFilterKey | null>(null);

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
    () => getCurrentMarketState(candles, currentIndex),
    [candles, currentIndex]
  );

  const activeRules = config[activeRegime];
  const previewBars = useFilterPreviewData(candles, currentIndex, activeRules, config);
  const latestBar = previewBars[previewBars.length - 1];

  const updateGlobal = (patch: Partial<AutoBacktestConfig>) =>
    setAutoBacktestConfig({ ...config, ...patch });

  const updateRegime = (regime: RegimeKey) => (rules: RegimeRules) =>
    setAutoBacktestConfig({ ...config, [regime]: rules });

  const applyPreset = (name: string) => {
    const preset = AUTO_BT_PRESETS[name];
    if (!preset) return;
    setAutoBacktestConfig({
      ...defaultAutoBacktestConfig,
      ...preset,
      enabled: config.enabled,
      // Preserve session-level settings — presets only change regime rules
      tradeStartTime: config.tradeStartTime,
      tradeEndTime: config.tradeEndTime,
      useAutoQty: config.useAutoQty,
      riskPerTrade: config.riskPerTrade,
      minQuantity: config.minQuantity,
    });
  };

  const regimes: RegimeKey[] = ['uptrend', 'downtrend', 'range', 'reversal'];
  const confirmationCount = countActiveConfirmationFilters(activeRules);
  const stepsWithBadge: StepDef[] = WORKFLOW_STEPS.map(s =>
    s.key === 'confirmation' ? { ...s, badge: confirmationCount } : s
  );

  return createPortal(
    <div className="fixed inset-0 z-[110] bg-slate-50 flex flex-col overflow-hidden font-sans">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-slate-200 shrink-0">
        <div className="flex items-center gap-4">
          <button
            onClick={onClose}
            className="flex items-center gap-2 text-sm font-semibold text-slate-500 hover:text-slate-800 transition-colors"
          >
            <ArrowLeft size={18} />
            Back to Chart
          </button>
          <div className="w-px h-6 bg-slate-200" />
          <div className="bg-indigo-600 p-2 rounded-xl text-white shadow-lg shadow-indigo-200">
            <Zap size={20} />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-800 tracking-tight">Auto Backtesting Engine</h2>
            <p className="text-slate-500 text-xs font-medium">Configure regime rules and run instant batch backtests</p>
          </div>
        </div>

        {/* Enable + quick controls */}
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-1.5 cursor-pointer select-none">
            <input type="checkbox" checked={config.skipIfPositionOpen}
              onChange={e => updateGlobal({ skipIfPositionOpen: e.target.checked })}
              className="w-3.5 h-3.5" />
            <span className="text-xs text-slate-600 font-medium">Skip if open</span>
          </label>
          <button
            onClick={() => setIsSessionSettingsOpen(true)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 hover:border-slate-300 transition-all duration-150 active:scale-95"
          >
            <Settings2 size={14} />
            Session Settings
          </button>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <ToggleSwitch checked={config.enabled} onChange={v => updateGlobal({ enabled: v })} size="md" />
            <span className={`text-xs font-bold ${config.enabled ? 'text-indigo-700' : 'text-gray-400'}`}>
              {config.enabled ? 'Running' : 'Off'}
            </span>
          </label>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Sticky live preview + Strategy Summary — always visible while configuring */}
        <div className="shrink-0 border-b border-slate-200 bg-white px-4 py-2 space-y-1.5">
          <FilterPreviewStrip bars={previewBars} highlightFilterKey={hoveredFilterKey} height={90} />
          <StrategySummaryBar regime={activeRegime} rules={activeRules} onJumpToStep={setActiveStep} />
        </div>

        {/* Market state + presets + saved configs — config-level actions, not per-step */}
        <div className="shrink-0 border-b border-slate-200 bg-white px-4 py-2 @container">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">Market:</span>
              <Chip tone="neutral">LT {marketState.ltMarket}</Chip>
              <Chip tone={marketState.htMarket === 'Bull-Trend' ? 'green' : marketState.htMarket === 'Bear-Trend' ? 'red' : 'neutral'}>
                HT {marketState.htMarket}
              </Chip>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">Presets:</span>
              {Object.keys(AUTO_BT_PRESETS).map(name => (
                <button key={name} onClick={() => applyPreset(name)}
                  className="px-2 py-1 text-[10px] bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-lg hover:bg-indigo-100 font-medium transition-all duration-150 active:scale-95">
                  {name}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1.5 flex-1 min-w-[260px]">
              <select
                value={selectedConfigId}
                onChange={e => setSelectedConfigId(e.target.value)}
                className="flex-1 text-[11px] border border-gray-300 rounded-lg px-2 py-1 bg-white"
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
                className="px-2 py-1 text-[10px] bg-gray-50 text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-100 font-medium transition-all duration-150 active:scale-95"
              >
                Save As...
              </button>
            </div>
          </div>
        </div>

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

        {/* Regime tabs */}
        <div className="shrink-0 bg-white px-4 pt-2 pb-1.5 border-b border-slate-200">
          <div className="flex gap-1">
            {regimes.map(r => {
              const meta = REGIME_META[r];
              const isActive = activeRegime === r;
              const isCurrentMarket = marketState.regime === r;
              return (
                <button
                  key={r}
                  onClick={() => { setActiveRegime(r); setActiveStep('market'); }}
                  className={`flex-1 flex flex-col items-center gap-0.5 py-1.5 rounded-lg border text-[10px] font-medium transition-all duration-150 active:scale-[0.98] relative ${
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
        </div>

        {/* Scrollable accordion content — the only region that scrolls */}
        <div className="flex-1 overflow-y-auto p-4 @container">
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
                  <EntryMetricsDashboard trades={trades} />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Sticky Run Backtest panel — always visible regardless of scroll/step */}
        <div className="shrink-0 border-t border-slate-200 bg-white p-3 space-y-2">
          <div className={`rounded p-2 text-[11px] ${config.enabled ? 'bg-indigo-50 border border-indigo-200' : 'bg-gray-50 border border-gray-200'}`}>
            <span className="font-medium text-gray-600">Last signal: </span>
            {config.enabled ? (
              position ? (
                <span className="text-orange-600">Position open — waiting for exit</span>
              ) : lastSignalReason ? (
                <span className="text-indigo-700 break-all">{lastSignalReason}</span>
              ) : (
                <span className="text-gray-400">No signal yet — press Play to run</span>
              )
            ) : (
              <span className="text-gray-400">Enable to start scanning</span>
            )}
          </div>

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

          <button
            onClick={runBatchAutoBacktest}
            disabled={isBatchRunning || candles.length === 0 || !config.enabled}
            className="w-full py-2.5 px-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold rounded-lg flex items-center justify-center gap-2 transition-all duration-150 active:scale-[0.99] shadow-sm hover:shadow-md"
          >
            {isBatchRunning ? (
              <>
                <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                Running...
              </>
            ) : (
              <>
                <Zap size={13} />
                Run Full Backtest (instant)
              </>
            )}
          </button>
        </div>
      </div>

      <SessionSettingsPanel
        config={config}
        onChange={updateGlobal}
        isOpen={isSessionSettingsOpen}
        onClose={() => setIsSessionSettingsOpen(false)}
      />
    </div>,
    document.body
  );
}
