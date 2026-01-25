import { useState, useEffect } from 'react';
import { Play, Pause, ChevronLeft, ChevronRight, FastForward, CalendarClock, Settings, X, Calendar } from 'lucide-react';
import { useSessionStore } from '../stores/sessionStore';
import { useNotificationStore } from '../stores/notificationStore';
import { formatTimestamp } from '../utils/formatters';
import { parseColumnarData, resampleCandles, type ColumnarData } from '../utils/resampler';
import { calculatePivotPoints } from '../utils/indicators';

// Dynamic import for local data
const loadNiftyData = () => import('../assets/market-data/nifty50.json');

export function PlaybackControls({ onOpenHistory }: { onOpenHistory?: () => void }) {
  const {
    isPlaying,
    speed,
    currentIndex,
    candles,
    play,
    pause,
    step,
    setSpeed,
    setCurrentIndex,
    jump,
    executeTrade,
    loadCandles,
  } = useSessionStore();

  const [customJump, setCustomJump] = useState('10');
  const [tradeQuantity, setTradeQuantity] = useState(65);
  const [showSettings, setShowSettings] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [jumpToDate, setJumpToDate] = useState('');

  // Data loading settings
  const [timeframe, setTimeframe] = useState('5');
  const [fromDate, setFromDate] = useState('2024-01-01');
  const [toDate, setToDate] = useState('2024-01-31');
  const [isReloading, setIsReloading] = useState(false);

  const resetSession = useSessionStore((s) => s.resetSession);

  // Handle data reload with new timeframe/dates
  const handleReloadData = async () => {
    setIsReloading(true);
    try {
      // For now, we'll use local data. You can add API support later
      const module = await loadNiftyData();
      const rawData: any = module.default || module;

      if (!rawData || !rawData.t || !rawData.o || !rawData.h || !rawData.l || !rawData.c || !rawData.v) {
        throw new Error('Invalid JSON data format');
      }

      let allCandles = parseColumnarData(rawData as ColumnarData);

      // Filter by date range
      if (fromDate) {
        const fromTs = new Date(fromDate).getTime() / 1000;
        allCandles = allCandles.filter(c => c.timestamp >= fromTs);
      }
      if (toDate) {
        const toTs = (new Date(toDate).getTime() / 1000) + 86400;
        allCandles = allCandles.filter(c => c.timestamp < toTs);
      }

      // Resample to selected timeframe
      const resampledCandles = resampleCandles(allCandles, parseInt(timeframe));

      loadCandles(resampledCandles, `NIFTY50-${timeframe}min`);
      setShowSettings(false);
      useNotificationStore.getState().notify('Data loaded successfully!', 'success');
    } catch (error) {
      console.error('Failed to reload data:', error);
      useNotificationStore.getState().notify('Failed to reload data. Please try again.', 'error');
    } finally {
      setIsReloading(false);
    }
  };


  // Helper to jump by time
  const handleTimeJump = (days: number) => {
    if (candles.length === 0) return;
    const current = candles[currentIndex];
    if (!current) return;

    const targetTime = current.timestamp + (days * 24 * 60 * 60);

    // Find next candle with timestamp >= targetTime
    let nextIndex = candles.findIndex((c, i) => i > currentIndex && c.timestamp >= targetTime);

    if (nextIndex === -1) {
      // If not found, maybe valid but past end? or just go to end
      if (candles[candles.length - 1].timestamp < targetTime) {
        nextIndex = candles.length - 1;
      } else {
        return; // Should not happen if sorted
      }
    }

    setCurrentIndex(nextIndex);
  };

  // Helper to jump to a specific date
  const handleJumpToDate = () => {
    if (!jumpToDate || candles.length === 0) return;

    const targetDate = new Date(jumpToDate);
    const targetTimestamp = targetDate.getTime() / 1000;

    // Find the closest candle to the target date
    let closestIndex = 0;
    let minDiff = Math.abs(candles[0].timestamp - targetTimestamp);

    for (let i = 1; i < candles.length; i++) {
      const diff = Math.abs(candles[i].timestamp - targetTimestamp);
      if (diff < minDiff) {
        minDiff = diff;
        closestIndex = i;
      }
      // If we've passed the target date, we can stop searching
      if (candles[i].timestamp > targetTimestamp) {
        break;
      }
    }

    setCurrentIndex(closestIndex);
    setShowDatePicker(false);
  };

  // Use selector to get current candle
  const currentCandle = useSessionStore((s) => s.candles[s.currentIndex] || null);

  // Auto-advance candles when playing
  useEffect(() => {
    if (!isPlaying) return;

    const interval = setInterval(() => {
      if (currentIndex < candles.length - 1) {
        step('forward');
      } else {
        pause();
      }
    }, 1000 / speed);

    return () => clearInterval(interval);
  }, [isPlaying, speed, currentIndex, candles.length, step, pause]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input field
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        return;
      }

      if (e.code === 'Space') {
        e.preventDefault();
        if (isPlaying) {
          pause();
        } else {
          play();
        }
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        step('forward');
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        step('backward');
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [isPlaying, play, pause, step]);

  const progress = candles.length > 0 ? (currentIndex / (candles.length - 1)) * 100 : 0;

  return (
    <div className="relative">
      <div className="flex flex-wrap items-center justify-between w-full h-full px-2 gap-y-2 gap-x-4 py-1">
        {/* Left: Playback Controls */}
        <div className="flex items-center gap-1 flex-wrap">
          <button
            onClick={() => step('backward')}
            disabled={currentIndex === 0}
            className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-30"
            title="Step backward"
          >
            <ChevronLeft size={20} />
          </button>

          <button
            onClick={isPlaying ? pause : play}
            disabled={currentIndex >= candles.length - 1}
            className="p-2 rounded-full bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 mx-1"
            title="Play/Pause (Space)"
          >
            {isPlaying ? <Pause size={20} /> : <Play size={20} />}
          </button>

          <button
            onClick={() => step('forward')}
            disabled={currentIndex >= candles.length - 1}
            className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-30"
            title="Step forward"
          >
            <ChevronRight size={20} />
          </button>

          {/* Speed Selector */}
          <select
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
            className="ml-2 px-1 py-1 text-xs border rounded bg-gray-50 focus:outline-none"
            title="Playback Speed"
          >
            <option value={0.5}>0.5x</option>
            <option value={1}>1x</option>
            <option value={2}>2x</option>
            <option value={5}>5x</option>
            <option value={10}>10x</option>
          </select>

          {/* Jump Controls (Mini) */}
          <div className="flex items-center gap-1 ml-2 border-l pl-2">
            <button
              onClick={() => jump(100)}
              className="px-1.5 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded flex gap-0.5 items-center"
              title="+100 Bars"
            >
              <FastForward size={12} /> 100
            </button>
            <button
              onClick={() => handleTimeJump(1)}
              className="px-1.5 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded flex gap-0.5 items-center"
              title="+1 Day"
            >
              <CalendarClock size={12} /> 1D
            </button>
            <button
              onClick={() => setShowDatePicker(true)}
              className="px-1.5 py-1 text-xs bg-blue-100 hover:bg-blue-200 text-blue-700 rounded flex gap-0.5 items-center"
              title="Jump to Date"
            >
              <Calendar size={12} /> Date
            </button>

            {/* Custom Jump */}
            <div className="flex items-center gap-1 ml-1 pl-1 border-l">
              <input
                type="number"
                value={customJump}
                onChange={(e) => setCustomJump(e.target.value)}
                className="w-10 px-1 py-1 border rounded text-center text-xs"
                placeholder="N"
              />
              <button
                onClick={() => jump(Number(customJump))}
                className="px-1.5 py-1 bg-blue-50 text-blue-700 border border-blue-200 rounded hover:bg-blue-100 text-xs font-semibold"
              >
                Go
              </button>
            </div>
          </div>
        </div>

        {/* Center: Progress / Date Info */}
        <div className="flex flex-col items-center justify-center text-xs text-gray-600">
          <div className="font-medium text-gray-900 text-sm">
            {currentCandle ? formatTimestamp(currentCandle.timestamp) : '--'}
          </div>
          <div className="w-full max-w-[16rem] bg-gray-200 rounded-full h-1.5 mt-1 mb-0.5 overflow-hidden">
            <div
              className="bg-blue-500 h-full transition-all duration-200"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="text-[10px] text-gray-400">
            {currentIndex + 1} / {candles.length} Candles
          </div>
        </div>

        {/* Right: Quick Actions (Buy/Sell & Reset) */}
        <div className="flex items-center gap-2 flex-wrap justify-center">
          {/* Mini Trading Buttons */}
          <div className="flex items-center gap-2">
            {/* Recent Pivot SL Info */}
            {(() => {
              const pivots = calculatePivotPoints(candles.slice(0, currentIndex + 1));
              const recentPivot = pivots.length > 0 ? pivots[pivots.length - 1] : null;
              if (!recentPivot) return null;

              const pointsAtRisk = recentPivot.slDistance;
              // Example risk: 10,000 INR
              const riskAmount = 10000;
              const calcQty = Math.floor(riskAmount / pointsAtRisk);

              return (
                <div className="flex items-center gap-2 px-2 py-1 bg-yellow-50 border border-yellow-200 rounded text-[10px] text-yellow-800">
                  <span className="font-bold">{recentPivot.type === 'bullish' ? 'LONG' : 'SHORT'}</span>
                  <span className="border-l border-yellow-300 pl-2">Gap: {pointsAtRisk}</span>
                  <button
                    onClick={() => setTradeQuantity(calcQty)}
                    className="ml-1 px-1.5 py-0.5 bg-yellow-600 text-white rounded hover:bg-yellow-700 font-bold"
                    title="Calculate Qty for 10k Risk"
                  >
                    Set Qty ({calcQty})
                  </button>
                </div>
              );
            })()}

            <input
              type="number"
              min="1"
              value={tradeQuantity}
              onChange={(e) => setTradeQuantity(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-12 px-1 py-1 border rounded text-center text-xs font-medium"
              title="Trade Quantity"
            />
            <div className="flex items-center gap-1">
              <button
                onClick={() => executeTrade('BUY', tradeQuantity)}
                disabled={!currentCandle}
                className="px-3 py-1 bg-green-600 text-white rounded text-xs font-bold hover:bg-green-700 disabled:opacity-50"
                title={`Buy ${tradeQuantity}`}
              >
                BUY
              </button>
              <button
                onClick={() => executeTrade('SELL', tradeQuantity)}
                disabled={!currentCandle}
                className="px-3 py-1 bg-red-600 text-white rounded text-xs font-bold hover:bg-red-700 disabled:opacity-50"
                title={`Sell ${tradeQuantity}`}
              >
                SELL
              </button>
            </div>
          </div>

          <button
            onClick={onOpenHistory}
            className="px-3 py-1.5 text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded border border-blue-200"
            title="View Trade History & Performance"
          >
            Analysis
          </button>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-50 hover:bg-gray-100 rounded border border-gray-200"
            title="Data Settings"
          >
            <Settings size={14} className="inline" />
          </button>
          <button
            onClick={resetSession}
            className="px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded border border-red-200"
          >
            Reset
          </button>
        </div>
      </div>

      {/* Settings Panel */}
      {showSettings && (
        <div className="absolute bottom-full right-0 mb-2 bg-white border-2 border-gray-300 rounded-lg shadow-2xl p-4 z-50 min-w-[320px]">
          <div className="flex items-center justify-between mb-3 pb-2 border-b">
            <h3 className="font-bold text-sm text-gray-800">Data Settings</h3>
            <button
              onClick={() => setShowSettings(false)}
              className="text-gray-400 hover:text-gray-600"
            >
              <X size={16} />
            </button>
          </div>

          <div className="space-y-3">
            {/* Timeframe Selection */}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Timeframe
              </label>
              <select
                value={timeframe}
                onChange={(e) => setTimeframe(e.target.value)}
                className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="1">1 Minute</option>
                <option value="5">5 Minutes</option>
                <option value="15">15 Minutes</option>
                <option value="30">30 Minutes</option>
                <option value="60">1 Hour</option>
                <option value="240">4 Hours</option>
                <option value="1440">1 Day</option>
              </select>
            </div>

            {/* Date Range */}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                From Date
              </label>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                To Date
              </label>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Apply Button */}
            <button
              onClick={handleReloadData}
              disabled={isReloading}
              className="w-full px-3 py-2 bg-blue-600 text-white rounded font-medium text-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isReloading ? 'Loading...' : 'Apply Changes'}
            </button>
          </div>
        </div>
      )}

      {/* Date Picker Modal */}
      {showDatePicker && (
        <div className="absolute bottom-full right-0 mb-2 bg-white border-2 border-blue-300 rounded-lg shadow-2xl p-4 z-50 min-w-[320px]">
          <div className="flex items-center justify-between mb-3 pb-2 border-b">
            <h3 className="font-bold text-sm text-gray-800 flex items-center gap-2">
              <Calendar size={16} className="text-blue-600" />
              Jump to Date
            </h3>
            <button
              onClick={() => setShowDatePicker(false)}
              className="text-gray-400 hover:text-gray-600"
            >
              <X size={16} />
            </button>
          </div>

          <div className="space-y-3">
            {/* Date Range Info */}
            {candles.length > 0 && (
              <div className="text-xs text-gray-600 bg-gray-50 p-2 rounded">
                <div className="flex justify-between">
                  <span className="font-medium">Available Range:</span>
                </div>
                <div className="mt-1">
                  <div>From: {formatTimestamp(candles[0].timestamp)}</div>
                  <div>To: {formatTimestamp(candles[candles.length - 1].timestamp)}</div>
                </div>
              </div>
            )}

            {/* Date Input */}
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Select Date
              </label>
              <input
                type="date"
                value={jumpToDate}
                onChange={(e) => setJumpToDate(e.target.value)}
                min={candles.length > 0 ? new Date(candles[0].timestamp * 1000).toISOString().split('T')[0] : undefined}
                max={candles.length > 0 ? new Date(candles[candles.length - 1].timestamp * 1000).toISOString().split('T')[0] : undefined}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Action Buttons */}
            <div className="flex gap-2">
              <button
                onClick={() => setShowDatePicker(false)}
                className="flex-1 px-3 py-2 bg-gray-100 text-gray-700 rounded font-medium text-sm hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={handleJumpToDate}
                disabled={!jumpToDate}
                className="flex-1 px-3 py-2 bg-blue-600 text-white rounded font-medium text-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Jump to Date
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
