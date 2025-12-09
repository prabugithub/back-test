import { useEffect } from 'react';
import { Play, Pause, ChevronLeft, ChevronRight } from 'lucide-react';
import { useSessionStore } from '../stores/sessionStore';
import { formatTimestamp } from '../utils/formatters';

export function PlaybackControls() {
  const {
    isPlaying,
    speed,
    currentIndex,
    candles,
    play,
    pause,
    step,
    setSpeed,
  } = useSessionStore();

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

  return (
    <div className="bg-white border rounded-lg p-4 shadow-sm">
      <div className="flex items-center gap-4 mb-4">
        {/* Step backward */}
        <button
          onClick={() => step('backward')}
          disabled={currentIndex === 0}
          className="p-2 rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
          title="Step backward (←)"
        >
          <ChevronLeft size={24} />
        </button>

        {/* Play/Pause */}
        <button
          onClick={isPlaying ? pause : play}
          disabled={currentIndex >= candles.length - 1}
          className="p-3 rounded-full bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          title="Play/Pause (Space)"
        >
          {isPlaying ? <Pause size={24} /> : <Play size={24} />}
        </button>

        {/* Step forward */}
        <button
          onClick={() => step('forward')}
          disabled={currentIndex >= candles.length - 1}
          className="p-2 rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
          title="Step forward (→)"
        >
          <ChevronRight size={24} />
        </button>

        {/* Speed control */}
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-700">Speed:</label>
          <select
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
            className="px-3 py-1 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value={0.5}>0.5x</option>
            <option value={1}>1x</option>
            <option value={2}>2x</option>
            <option value={5}>5x</option>
            <option value={10}>10x</option>
          </select>
        </div>

        {/* Current time */}
        <div className="ml-auto text-sm text-gray-600">
          {currentCandle ? formatTimestamp(currentCandle.timestamp) : '--'}
        </div>
      </div>

      {/* Progress bar */}
      <div className="space-y-1">
        <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
          <div
            className="bg-blue-600 h-2 transition-all duration-200"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-gray-500">
          <span>
            Candle {currentIndex + 1} / {candles.length}
          </span>
          <span>{progress.toFixed(1)}%</span>
        </div>
      </div>
    </div>
  );
}
