import { useState, useRef, useEffect } from 'react';
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
  MessageSquare,
  Eye,
  EyeOff,
  Download,
  SeparatorHorizontal
} from 'lucide-react';
import { useSessionStore } from '../stores/sessionStore';
import { calculatePivotPoints } from '../utils/indicators';
import { analyzeMarketStructure } from '../utils/pivotAnalysis';
import { LayoutGrid } from 'lucide-react';


export type DrawingTool = 'none' | 'select' | 'trendline' | 'horizontal' | 'rectangle' | 'fibonacci' | 'riskReward' | 'freehand' | 'text' | 'callout' | 'channel';
export type Indicator = 'none' | 'sma21' | 'sma60' | 'ema21' | 'ema60' | 'pivotPoints' | 'alBrooks';

interface ChartToolbarProps {
  activeTool: DrawingTool;
  onToolChange: (tool: DrawingTool) => void;
  activeIndicators: Indicator[];
  onIndicatorToggle: (indicator: Indicator) => void;
  onClearDrawings: () => void;
  onDeleteSelected: () => void;
  onTakeScreenshot: () => void;
  onDownloadScreenshot: () => void;
  isUploadingScreenshot: boolean;
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
  onDownloadScreenshot,
  isUploadingScreenshot,
  hasSelection,
}: ChartToolbarProps) {
  const [showIndicators, setShowIndicators] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowIndicators(false);
      }
    }
    if (showIndicators) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showIndicators]);

  const activeChartId = useSessionStore((s) => s.activeChartId);
  const primaryShowMarkers = useSessionStore((s) => s.primaryShowMarkers);
  const secondaryShowMarkers = useSessionStore((s) => s.secondaryShowMarkers);
  const showMarkers = activeChartId === 'primary' ? primaryShowMarkers : secondaryShowMarkers;
  const toggleMarkers = useSessionStore((s) => s.toggleMarkers);
  const candles = useSessionStore((s) => s.candles);
  const currentIndex = useSessionStore((s) => s.currentIndex);
  const useAtrForSignals = useSessionStore((s) => s.useAtrForSignals);
  const toggleAtrForSignals = useSessionStore((s) => s.toggleAtrForSignals);
  const showPivotRR = useSessionStore((s) => s.showPivotRR);
  const togglePivotRR = useSessionStore((s) => s.togglePivotRR);

  // Calculate market structure for display
  const visibleCandles = candles.slice(0, currentIndex + 1);
  const pivots = visibleCandles.length >= 5 ? calculatePivotPoints(visibleCandles) : [];
  const { ltMarket, htMarket } = visibleCandles.length >= 25 ? analyzeMarketStructure(visibleCandles, pivots) : { ltMarket: 'Initializing...', htMarket: 'Initializing...' };

  const getStructureColor = (market: string) => {
    if (market.startsWith('Bull')) return 'text-green-600 bg-green-50 border-green-200';
    if (market.startsWith('Bear')) return 'text-red-600 bg-red-50 border-red-200';
    return 'text-gray-600 bg-gray-50 border-gray-200';
  };

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
    { id: 'channel', icon: SeparatorHorizontal, label: 'Parallel Channel', shortcut: '0' },
  ];

  const indicators: Array<{ id: Indicator; label: string; color: string }> = [
    { id: 'sma21', label: 'SMA 21', color: '#2962FF' },
    { id: 'sma60', label: 'SMA 60', color: '#FF6D00' },
    { id: 'ema21', label: 'EMA 21', color: '#00897B' },
    { id: 'ema60', label: 'EMA 60', color: '#D81B60' },
    { id: 'pivotPoints', label: 'Pivot Points', color: '#6A1B9A' },
    { id: 'alBrooks', label: 'Al Brooks H/L', color: '#00BCD4' },
  ];

  return (
    <div className="bg-white border-b px-3 py-1.5 flex items-center gap-2 flex-nowrap min-w-max">
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
          disabled={isUploadingScreenshot}
          data-screenshot-btn
          className={`p-2 rounded hover:bg-gray-100 transition-colors text-gray-700 ${isUploadingScreenshot ? 'animate-pulse opacity-50 cursor-wait' : ''
            }`}
          title={isUploadingScreenshot ? 'Uploading...' : 'Take Chart Screenshot (Upload)'}
        >
          <Camera size={18} />
        </button>
        <button
          onClick={onDownloadScreenshot}
          disabled={isUploadingScreenshot}
          className="p-2 rounded hover:bg-gray-100 transition-colors text-gray-700"
          title="Download Chart Screenshot Locally"
        >
          <Download size={18} />
        </button>
      </div>

      {/* Visibility Toggle */}
      <div className="flex items-center gap-1 border-r pr-3">
        <button
          onClick={() => toggleMarkers()}
          className={`p-2 rounded hover:bg-gray-100 transition-colors ${showMarkers ? 'text-blue-600 bg-blue-50' : 'text-gray-400'
            }`}
          title={showMarkers ? 'Hide Trading Activity Markers' : 'Show Trading Activity Markers'}
        >
          {showMarkers ? <Eye size={18} /> : <EyeOff size={18} />}
        </button>
      </div>

      {/* Indicators */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-gray-600">Indicators:</span>
        <div className="relative" ref={dropdownRef}>
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
            <div className="absolute top-full left-0 mt-1 bg-white border rounded-lg shadow-lg p-2 z-[100] min-w-[150px]">
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
              <div className="border-t my-1 h-px bg-gray-100" />
              <label className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-50 rounded cursor-pointer">
                <input
                  type="checkbox"
                  checked={useAtrForSignals}
                  onChange={toggleAtrForSignals}
                  className="rounded text-blue-600"
                />
                <span className="text-xs font-semibold text-gray-700">Use ATR Depth</span>
              </label>
              <label className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-50 rounded cursor-pointer">
                <input
                  type="checkbox"
                  checked={showPivotRR}
                  onChange={togglePivotRR}
                  className="rounded text-blue-600"
                />
                <span className="text-xs font-semibold text-gray-700">Auto Pivot RR</span>
              </label>
            </div>
          )}
        </div>
      </div>

      {/* Market Structure (Bubbles Only) */}
      <div className="hidden md:flex items-center gap-1.5 ml-auto border-l pl-3 border-gray-100 h-8">
        <div className={`px-2 py-0.5 rounded border text-[10px] font-bold flex items-center gap-1 ${getStructureColor(ltMarket)}`} title="LT Structure">
          <Activity size={10} />
          <span>LT: {ltMarket}</span>
        </div>
        <div className={`px-2 py-0.5 rounded border text-[10px] font-bold flex items-center gap-1 ${getStructureColor(htMarket)}`} title="HT Structure">
          <LayoutGrid size={10} />
          <span>HT: {htMarket}</span>
        </div>

        <div className="text-xs text-gray-500 min-w-[120px] text-right">
          {activeTool !== 'none' && activeTool !== 'select' && (
            <span className="text-blue-600 font-medium">
              Click on chart to draw {tools.find(t => t.id === activeTool)?.label}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
