import type { RegimeKey, RegimeRules } from '../../utils/autoBacktestEngine';
import { Chip, type ChipTone } from './Chip';
import type { WorkflowStep } from './RegimeWorkflowSteps';

interface StrategySummaryBarProps {
  regime: RegimeKey;
  rules: RegimeRules;
  onJumpToStep?: (step: WorkflowStep) => void;
}

// Mirrors the label-branching logic already used inline for the MA Filter ModePickerControl
// in AutoBacktestPanel.tsx — copied here verbatim, not altered, so wording stays identical.
function formatMaFilterLabel(rules: RegimeRules): string | null {
  const isShort = rules.direction === 'SHORT_ONLY';
  const isBoth = rules.direction === 'BOTH';
  switch (rules.maFilter) {
    case 'above_ema21':
      return isBoth ? 'MA: EMA21 side' : isShort ? 'MA: Below EMA21' : 'MA: Above EMA21';
    case 'on_or_above_ema21':
      return isBoth ? 'MA: EMA21 touch' : isShort ? 'MA: On/Below EMA21' : 'MA: On/Above EMA21';
    case 'above_ema60':
      return isBoth ? 'MA: EMA60 side' : isShort ? 'MA: Below EMA60' : 'MA: Above EMA60';
    default:
      return null;
  }
}

function isActive(mode: string | undefined, offValue = 'none'): boolean {
  return mode !== undefined && mode !== offValue;
}

export function countActiveConfirmationFilters(rules: RegimeRules): number {
  let count = 0;
  if (isActive(rules.atrDepthFilter)) count++;
  if (isActive(rules.efficiencyRatioFilter)) count++;
  if (isActive(rules.barOverlapFilter)) count++;
  if (isActive(rules.barRangeFilter)) count++;
  if (isActive(rules.barBreakFilter)) count++;
  if (isActive(rules.ema21SlopeFilter)) count++;
  if (isActive(rules.ema50SlopeFilter)) count++;
  if (isActive(rules.ema20GapBarFilter)) count++;
  if (isActive(rules.ema20BiasFilter)) count++;
  if (isActive(rules.highSeqFilter, 'none')) count++;
  if (isActive(rules.lowSeqFilter, 'none')) count++;
  if (isActive(rules.pivotGapFilter)) count++;
  return count;
}

function formatSlLabel(rules: RegimeRules): string {
  if (rules.slMethod === 'atr') return `SL: ATR × ${rules.slAtrMultiplier}`;
  if (rules.slMethod === 'fixed') return `SL: Fixed ${rules.slFixedPoints}pts`;
  return 'SL: Pivot';
}

// Read-only, purely derived from the active regime's rules — no new store state.
export function StrategySummaryBar({ regime, rules, onJumpToStep }: StrategySummaryBarProps) {
  const jump = (step: WorkflowStep) => (onJumpToStep ? () => onJumpToStep(step) : undefined);

  if (!rules.enabled) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5">
        <Chip tone="gray-muted">{regime} regime disabled — rules configured but inactive</Chip>
      </div>
    );
  }

  const directionLabel = rules.direction === 'LONG_ONLY' ? 'Long only' : rules.direction === 'SHORT_ONLY' ? 'Short only' : 'Long + Short';
  const directionTone: ChipTone = rules.direction === 'LONG_ONLY' ? 'green' : rules.direction === 'SHORT_ONLY' ? 'red' : 'purple';

  const entryLabel =
    rules.entryMode === 'PIVOT' ? 'Entry: Pivot' : rules.entryMode === 'H_SIGNAL' ? 'Entry: H/L Signal' : `Entry: Confluence (${rules.confluenceLookback})`;

  const maLabel = formatMaFilterLabel(rules);
  const confirmationCount = countActiveConfirmationFilters(rules);

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-3 py-1.5">
      <Chip tone={directionTone} onClick={jump('market')}>
        {directionLabel}
      </Chip>
      <Chip tone="indigo" onClick={jump('entry')}>
        {entryLabel}
      </Chip>
      {maLabel && (
        <Chip tone="indigo" onClick={jump('entry')}>
          {maLabel}
        </Chip>
      )}
      <Chip tone={confirmationCount > 0 ? 'amber' : 'gray-muted'} onClick={jump('confirmation')}>
        {confirmationCount} confirmation filter{confirmationCount === 1 ? '' : 's'} active
      </Chip>
      <Chip tone="neutral" onClick={jump('risk')}>
        {formatSlLabel(rules)}
      </Chip>
      <Chip tone="neutral" onClick={jump('exit')}>
        RR: {rules.targetRR}×
      </Chip>
    </div>
  );
}
