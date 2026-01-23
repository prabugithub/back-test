import { useState } from 'react';
import {
  TrendingUp,
  Minus,
  Square,
  Target,
  Activity,
  ChevronDown,
  Circle,
  MousePointer,
  Pen,
  Camera,
  Type,
  MessageSquare
} from 'lucide-react';

export type DrawingTool = 'none' | 'select' | 'trendline' | 'horizontal' | 'rectangle' | 'fibonacci' | 'riskReward' | 'freehand' | 'text' | 'callout';
export type Indicator = 'none' | 'sma21' | 'sma60' | 'ema21' | 'ema60' | 'pivotPoints';

interface ChartToolbarProps {
  activeTool: DrawingTool;
  onToolChange: (tool: DrawingTool) => void;
  activeIndicators: Indicator[];
  onIndicatorToggle: (indicator: Indicator) => void;
  onClearDrawings: () => void;
  onDeleteSelected: () => void;
  onTakeScreenshot: () => void;
  hasSelection: boolean;
}

export function ChartToolbar({
  activeTool,
  onToolChange,
  activeIndicators,
  onIndicatorToggle,
  onClearDrawings,
  onDeleteSelected,
  onTakeScreenshot,
  hasSelection,
}: ChartToolbarProps) {
  const [showIndicators, setShowIndicators] = useState(false);

  const tools: Array<{ id: DrawingTool; icon: any; label: string; shortcut: string }> = [
    { id: 'select', icon: MousePointer, label: 'Select', shortcut: 'V or 1' },
    { id: 'freehand', icon: Pen, label: 'Free Draw', shortcut: '2' },
    { id: 'trendline', icon: TrendingUp, label: 'Trend Line', shortcut: '3' },
    { id: 'horizontal', icon: Minus, label: 'Horizontal Line', shortcut: '4' },
    { id: 'rectangle', icon: Square, label: 'Rectangle', shortcut: '5' },
    { id: 'fibonacci', icon: Circle, label: 'Fibonacci', shortcut: '6' },
    { id: 'riskReward', icon: Target, label: 'Risk/Reward', shortcut: '7' },
    { id: 'text', icon: Type, label: 'Text', shortcut: '8' },
    { id: 'callout', icon: MessageSquare, label: 'Callout', shortcut: '9' },
  ];

  const indicators: Array<{ id: Indicator; label: string; color: string }> = [
    { id: 'sma21', label: 'SMA 21', color: '#2962FF' },
    { id: 'sma60', label: 'SMA 60', color: '#FF6D00' },
    { id: 'ema21', label: 'EMA 21', color: '#00897B' },
    { id: 'ema60', label: 'EMA 60', color: '#D81B60' },
    { id: 'pivotPoints', label: 'Pivot Points', color: '#6A1B9A' },
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
              className={`p-2 rounded hover:bg-gray-100 transition-colors ${isActive ? 'bg-blue-100 text-blue-600' : 'text-gray-700'
                }`}
              title={`${tool.label} (${tool.shortcut})`}
            >
              <Icon size={18} />
            </button>
          );
        })}
        <button
          onClick={onDeleteSelected}
          disabled={!hasSelection}
          className={`ml-2 px-3 py-1 text-xs rounded ${hasSelection
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

      {/* Screenshot Button */}
      <div className="flex items-center gap-1 border-r pr-3">
        <button
          onClick={onTakeScreenshot}
          className="p-2 rounded hover:bg-gray-100 transition-colors text-gray-700"
          title="Take Chart Screenshot"
        >
          <Camera size={18} />
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
