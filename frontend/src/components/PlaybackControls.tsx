import { useState, useEffect } from 'react';
import { Play, Pause, ChevronLeft, ChevronRight, FastForward, CalendarClock } from 'lucide-react';
import { useSessionStore } from '../stores/sessionStore';
import { formatTimestamp } from '../utils/formatters';

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
  } = useSessionStore();


  const [customJump, setCustomJump] = useState('10');
  const [tradeQuantity, setTradeQuantity] = useState(65);


  const resetSession = useSessionStore((s) => s.resetSession);

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

  // We will pass playback and trading controls to the parent or use a Portal, 
  // but based on the request, this component acts as the bottom toolbar content.
  // We'll expose a comprehensive toolbar UI.
  return (
    <div className="flex items-center justify-between w-full h-full px-2 gap-4">
      {/* Left: Playback Controls */}
      <div className="flex items-center gap-1">
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
        <div className="w-64 bg-gray-200 rounded-full h-1.5 mt-1 mb-0.5 overflow-hidden">
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
      <div className="flex items-center gap-4">
        {/* Mini Trading Buttons */}
        <div className="flex items-center gap-2">
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
          onClick={resetSession}
          className="px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded border border-red-200"
        >
          Reset
        </button>
      </div>
    </div>
  );
}
