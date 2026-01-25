import { useState, useEffect } from 'react';
import { Play, Pause, ChevronLeft, ChevronRight, FastForward, CalendarClock, Settings, X, Calendar } from 'lucide-react';
import { addDays, format } from 'date-fns';
import { useSessionStore } from '../stores/sessionStore';
import { useNotificationStore } from '../stores/notificationStore';
import { formatTimestamp } from '../utils/formatters';
import { parseColumnarData, resampleCandles, type ColumnarData } from '../utils/resampler';
import { calculatePivotPoints } from '../utils/indicators';

import { fetchCandles } from '../services/api';

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
  const [jumpToDate, setJumpToDate] = useState('2021-02-01');

  const [settingsJumpDate, setSettingsJumpDate] = useState('');

  // Data loading settings (initially sync with session)
  const [timeframe, setTimeframe] = useState('5');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [isReloading, setIsReloading] = useState(false);

  const resetSession = useSessionStore((s) => s.resetSession);
  const sessionConfig = useSessionStore((s) => s.sessionConfig);

  // Sync settings with session config when it changes or when opening settings
  useEffect(() => {
    if (showSettings && sessionConfig) {
      if (sessionConfig.interval) setTimeframe(sessionConfig.interval);
      if (sessionConfig.fromDate) setFromDate(sessionConfig.fromDate);
      if (sessionConfig.toDate) setToDate(sessionConfig.toDate);
      setSettingsJumpDate(''); // Reset jump date when opening settings
    }
  }, [showSettings, sessionConfig]);

  // Helper: Perform the actual data loading (reusable)
  const performDataReload = async (startStr: string, endStr: string, newTimeframe: string, targetDateStr?: string) => {
    const config = useSessionStore.getState().sessionConfig;
    if (!config) {
      useNotificationStore.getState().notify('No active session config found.', 'error');
      return;
    }

    setIsReloading(true);
    try {
      // API Data Source
      if (config.dataSource === 'api') {
        const response = await fetchCandles({
          securityId: config.securityId,
          exchangeSegment: config.exchangeSegment,
          instrument: config.instrumentType,
          interval: newTimeframe,
          fromDate: startStr,
          toDate: endStr,
        });

        if (response.success && response.data.length > 0) {
          const newConfig = {
            ...config,
            interval: newTimeframe,
            fromDate: startStr,
            toDate: endStr
          };
          loadCandles(response.data, `${config.securityId}-${config.exchangeSegment}`, newConfig);
          useNotificationStore.getState().notify('Data reloaded successfully (API)!', 'success');
        } else {
          throw new Error((response as any).message || 'No data received from API');
        }
      }
      // Local Data Source
      else {
        const module = await loadNiftyData();
        const rawData: any = module.default || module;

        if (!rawData || !rawData.t || !rawData.o || !rawData.h || !rawData.l || !rawData.c || !rawData.v) {
          throw new Error('Invalid JSON data format');
        }

        let allCandles = parseColumnarData(rawData as ColumnarData);

        // Filter by date range
        if (startStr) {
          const fromTs = new Date(startStr).getTime() / 1000;
          allCandles = allCandles.filter(c => c.timestamp >= fromTs);
        }
        if (endStr) {
          const toTs = (new Date(endStr).getTime() / 1000) + 86400;
          allCandles = allCandles.filter(c => c.timestamp < toTs);
        }

        // Resample
        let tfMinutes = 5;
        if (newTimeframe === '1') tfMinutes = 1;
        if (newTimeframe === '5') tfMinutes = 5;
        if (newTimeframe === '15') tfMinutes = 15;
        if (newTimeframe === '30') tfMinutes = 30;
        if (newTimeframe === '60') tfMinutes = 60;
        if (newTimeframe === '240') tfMinutes = 240;
        if (newTimeframe === '1440' || newTimeframe === '1D') tfMinutes = 1440;

        const resampledCandles = resampleCandles(allCandles, tfMinutes);

        if (resampledCandles.length === 0) {
          throw new Error('No candles found for the selected range/timeframe');
        }

        const newConfig = {
          ...config,
          interval: newTimeframe,
          fromDate: startStr,
          toDate: endStr
        };

        loadCandles(resampledCandles, `NIFTY50 (Local ${newTimeframe}m)`, newConfig);
        useNotificationStore.getState().notify('Data reloaded successfully (Local)!', 'success');
      }

      // Update local state to match the executed reload
      setFromDate(startStr);
      setToDate(endStr);
      setTimeframe(newTimeframe);
      setShowSettings(false); // Close settings if open

      // Attempt jump if target date provided
      if (targetDateStr) {
        const candles = useSessionStore.getState().candles;
        const targetTs = new Date(targetDateStr).getTime() / 1000;

        let foundIndex = -1;
        for (let i = 0; i < candles.length; i++) {
          if (candles[i].timestamp >= targetTs) {
            foundIndex = i;
            break;
          }
        }

        if (foundIndex !== -1) {
          setCurrentIndex(foundIndex);
          useNotificationStore.getState().notify(`Jumped to ${targetDateStr}`, 'info');
        }
      }

    } catch (error: any) {
      console.error('Failed to reload data:', error);
      useNotificationStore.getState().notify(`Failed to reload data: ${error.message}`, 'error');
    } finally {
      setIsReloading(false);
    }
  };

  // Handle data reload with new timeframe/dates
  const handleReloadData = () => performDataReload(fromDate, toDate, timeframe, settingsJumpDate);

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

    // Create date at 00:00:00 of that day (Local/Device time usually preferred for input[type=date])
    // But since input[type=date] is YYYY-MM-DD, new Date(str) is UTC. 
    // We want the start of that day.
    const targetDate = new Date(jumpToDate);
    const targetTimestamp = targetDate.getTime() / 1000;

    // Find the first candle that is ON or AFTER this timestamp
    let targetIndex = -1;

    // Binary search or simple loop - simple loop is fine for < 10k items usually, but let's optimize slightly
    // logic: find first c where c.timestamp >= targetTimestamp

    for (let i = 0; i < candles.length; i++) {
      if (candles[i].timestamp >= targetTimestamp) {
        targetIndex = i;
        break;
      }
    }

    if (targetIndex !== -1) {
      setCurrentIndex(targetIndex);
      useNotificationStore.getState().notify(`Jumped to ${jumpToDate}`, 'info');
    } else {
      // If target is beyond the last candle, jump to end
      if (targetTimestamp > candles[candles.length - 1].timestamp) {
        setCurrentIndex(candles.length - 1);
        useNotificationStore.getState().notify('Date is beyond available data. Jumped to end.', 'warning');
      } else {
        // Date is before start? Jump to start
        setCurrentIndex(0);
        useNotificationStore.getState().notify('Date is before available data. Jumped to start.', 'warning');
      }
    }

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
      <div className="flex flex-nowrap items-center justify-between w-full h-full px-1 gap-x-2 py-1 overflow-x-auto scrollbar-hide">
        {/* Left: Playback Controls */}
        <div className="flex items-center gap-0.5 flex-none">
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
          <div className="flex items-center gap-0.5 ml-1 border-l pl-1">
            <button
              onClick={() => jump(100)}
              className="px-1 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded flex items-center justify-center w-6"
              title="+100 Bars"
            >
              <FastForward size={12} />
            </button>
            <button
              onClick={() => handleTimeJump(1)}
              className="px-1 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded flex items-center justify-center w-6"
              title="+1 Day"
            >
              <CalendarClock size={12} />
            </button>
            <button
              onClick={() => setShowDatePicker(true)}
              className="px-1 py-1 text-xs bg-blue-100 hover:bg-blue-200 text-blue-700 rounded flex items-center justify-center w-6"
              title="Jump to Date"
            >
              <Calendar size={12} />
            </button>

            {/* Custom Jump */}
            <div className="flex items-center gap-0.5 ml-0.5 border-l pl-0.5">
              <input
                type="number"
                value={customJump}
                onChange={(e) => setCustomJump(e.target.value)}
                className="w-8 px-0.5 py-0.5 border rounded text-center text-[10px]"
                placeholder="N"
              />
              <button
                onClick={() => jump(Number(customJump))}
                className="px-1 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 rounded hover:bg-blue-100 text-[10px] font-bold"
              >
                Go
              </button>
            </div>
          </div>
        </div>

        {/* Center: Progress / Date Info */}
        <div className="flex flex-col items-center justify-center text-xs text-gray-600 flex-1 px-2 min-w-[120px]">
          <div className="font-medium text-gray-900 text-sm whitespace-nowrap">
            {currentCandle ? formatTimestamp(currentCandle.timestamp) : '--'}
          </div>
          <div className="w-full max-w-[12rem] bg-gray-200 rounded-full h-1.5 mt-1 mb-0.5 overflow-hidden">
            <div
              className="bg-blue-500 h-full transition-all duration-200"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Right: Quick Actions (Buy/Sell & Reset) */}
        <div className="flex items-center gap-1 flex-none">
          {/* Mini Trading Buttons */}
          <div className="flex items-center gap-1">
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
                <button
                  onClick={() => setTradeQuantity(calcQty)}
                  className="flex items-center gap-1 px-1.5 py-0.5 bg-yellow-50 border border-yellow-200 hover:bg-yellow-100 hover:border-yellow-300 rounded text-[10px] text-yellow-800 whitespace-nowrap transition-colors cursor-pointer group"
                  title={`Click to set Quantity: ${calcQty} (Risk: 10k)`}
                >
                  <span className="font-bold">{recentPivot.type === 'bullish' ? 'L' : 'S'}</span>
                  <span className="border-l border-yellow-300 pl-1 group-hover:border-yellow-400">{pointsAtRisk}</span>
                  <span className="ml-0.5 font-bold text-yellow-700 bg-yellow-200 px-1 rounded-sm group-hover:bg-yellow-300">Q:{calcQty}</span>
                </button>
              );
            })()}

            <input
              type="number"
              min="1"
              value={tradeQuantity}
              onChange={(e) => setTradeQuantity(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-10 px-0.5 py-1 border rounded text-center text-xs font-medium"
              title="Trade Quantity"
            />
            <div className="flex items-center gap-0.5">
              <button
                onClick={() => executeTrade('BUY', tradeQuantity)}
                disabled={!currentCandle}
                className="px-2 py-1 bg-green-600 text-white rounded text-xs font-bold hover:bg-green-700 disabled:opacity-50"
                title={`Buy ${tradeQuantity}`}
              >
                B
              </button>
              <button
                onClick={() => executeTrade('SELL', tradeQuantity)}
                disabled={!currentCandle}
                className="px-2 py-1 bg-red-600 text-white rounded text-xs font-bold hover:bg-red-700 disabled:opacity-50"
                title={`Sell ${tradeQuantity}`}
              >
                S
              </button>
            </div>
          </div>

          <div className="w-px bg-gray-300 mx-1 h-6"></div>

          <button
            onClick={onOpenHistory}
            className="p-1.5 text-blue-700 bg-blue-50 hover:bg-blue-100 rounded border border-blue-200"
            title="Analysis / Trade History"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>
          </button>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="p-1.5 text-gray-700 bg-gray-50 hover:bg-gray-100 rounded border border-gray-200"
            title="Data Settings"
          >
            <Settings size={16} />
          </button>
          <button
            onClick={resetSession}
            className="p-1.5 text-red-600 bg-red-50 hover:bg-red-100 rounded border border-red-200"
            title="Reset Session"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path></svg>
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

            {/* Quick Range / Jump To Date */}
            <div className="pt-2 border-t mt-2">
              <label className="block text-xs font-medium text-blue-700 mb-1 flex items-center gap-1">
                <Calendar size={12} />
                Jump To Date (Initial View)
              </label>
              <input
                type="date"
                value={settingsJumpDate}
                onChange={(e) => setSettingsJumpDate(e.target.value)}
                className="w-full px-2 py-1.5 text-sm border border-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-blue-50"
                placeholder="Select date to jump to..."
              />
              <p className="text-[10px] text-gray-500 mt-1">
                Loads full data range, but starts playback at this date.
              </p>
            </div>

            <div className="border-t my-2"></div>

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
