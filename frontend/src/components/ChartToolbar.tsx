import { useState } from 'react';
import {
  TrendingUp,
  Minus,
  Square,
  Target,
  Activity,
  ChevronDown,
  Circle,
  MousePointer
} from 'lucide-react';

export type DrawingTool = 'none' | 'select' | 'trendline' | 'horizontal' | 'rectangle' | 'fibonacci' | 'riskReward';
export type Indicator = 'none' | 'sma20' | 'sma50' | 'ema20' | 'ema50';

interface ChartToolbarProps {
  activeTool: DrawingTool;
  onToolChange: (tool: DrawingTool) => void;
  activeIndicators: Indicator[];
  onIndicatorToggle: (indicator: Indicator) => void;
  onClearDrawings: () => void;
  onDeleteSelected: () => void;
  hasSelection: boolean;
}

export function ChartToolbar({
  activeTool,
  onToolChange,
  activeIndicators,
  onIndicatorToggle,
  onClearDrawings,
  onDeleteSelected,
  hasSelection,
}: ChartToolbarProps) {
  const [showIndicators, setShowIndicators] = useState(false);

  const tools: Array<{ id: DrawingTool; icon: any; label: string }> = [
    { id: 'select', icon: MousePointer, label: 'Select' },
    { id: 'trendline', icon: TrendingUp, label: 'Trend Line' },
    { id: 'horizontal', icon: Minus, label: 'Horizontal Line' },
    { id: 'rectangle', icon: Square, label: 'Rectangle' },
    { id: 'fibonacci', icon: Circle, label: 'Fibonacci' },
    { id: 'riskReward', icon: Target, label: 'Risk/Reward' },
  ];

  const indicators: Array<{ id: Indicator; label: string; color: string }> = [
    { id: 'sma20', label: 'SMA 20', color: '#2962FF' },
    { id: 'sma50', label: 'SMA 50', color: '#FF6D00' },
    { id: 'ema20', label: 'EMA 20', color: '#00897B' },
    { id: 'ema50', label: 'EMA 50', color: '#D81B60' },
  ];

  return (
    <div className="bg-white border-b p-3 flex items-center gap-2 flex-wrap">
      {/* Drawing Tools */}
      <div className="flex items-center gap-1 border-r pr-3">
        <span className="text-xs font-medium text-gray-600 mr-2">Drawing Tools:</span>
        {tools.map((tool) => {
          const Icon = tool.icon;
          const isActive = activeTool === tool.id;
          return (
            <button
              key={tool.id}
              onClick={() => onToolChange(isActive ? 'none' : tool.id)}
              className={`p-2 rounded hover:bg-gray-100 transition-colors ${
                isActive ? 'bg-blue-100 text-blue-600' : 'text-gray-700'
              }`}
              title={tool.label}
            >
              <Icon size={18} />
            </button>
          );
        })}
        <button
          onClick={onDeleteSelected}
          disabled={!hasSelection}
          className={`ml-2 px-3 py-1 text-xs rounded ${
            hasSelection
              ? 'bg-orange-50 text-orange-600 hover:bg-orange-100'
              : 'bg-gray-50 text-gray-400 cursor-not-allowed'
          }`}
          title={hasSelection ? 'Delete selected drawing (Delete/Backspace)' : 'No drawing selected'}
        >
          Delete Selected
        </button>
        <button
          onClick={onClearDrawings}
          className="px-3 py-1 text-xs bg-red-50 text-red-600 rounded hover:bg-red-100"
        >
          Clear All
        </button>
      </div>

      {/* Indicators */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-gray-600">Indicators:</span>
        <div className="relative">
          <button
            onClick={() => setShowIndicators(!showIndicators)}
            className="flex items-center gap-1 px-3 py-1.5 bg-gray-100 rounded hover:bg-gray-200 text-sm"
          >
            <Activity size={16} />
            {activeIndicators.filter(i => i !== 'none').length > 0 && (
              <span className="text-xs font-semibold text-blue-600">
                ({activeIndicators.filter(i => i !== 'none').length})
              </span>
            )}
            <ChevronDown size={14} />
          </button>

          {showIndicators && (
            <div className="absolute top-full left-0 mt-1 bg-white border rounded-lg shadow-lg p-2 z-10 min-w-[150px]">
              {indicators.map((indicator) => {
                const isActive = activeIndicators.includes(indicator.id);
                return (
                  <label
                    key={indicator.id}
                    className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-50 rounded cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={isActive}
                      onChange={() => onIndicatorToggle(indicator.id)}
                      className="rounded"
                    />
                    <span
                      className="w-3 h-3 rounded"
                      style={{ backgroundColor: indicator.color }}
                    />
                    <span className="text-sm">{indicator.label}</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Info */}
      <div className="ml-auto text-xs text-gray-500">
        {activeTool === 'select' && (
          <span className="text-blue-600 font-medium">
            Click on a drawing to select it
          </span>
        )}
        {activeTool !== 'none' && activeTool !== 'select' && (
          <span className="text-blue-600 font-medium">
            Click on chart to draw {tools.find(t => t.id === activeTool)?.label}
          </span>
        )}
      </div>
    </div>
  );
}
