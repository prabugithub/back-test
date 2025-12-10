import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { InstrumentSelector } from './components/InstrumentSelector';
import { AdvancedChart } from './components/AdvancedChart';
import { PlaybackControls } from './components/PlaybackControls';
import { TradingPanel } from './components/TradingPanel';
import { SessionStats } from './components/SessionStats';
import { useSessionStore } from './stores/sessionStore';

const queryClient = new QueryClient();

function App() {
  const candles = useSessionStore((s) => s.candles);
  const resetSession = useSessionStore((s) => s.resetSession);

  const hasData = candles.length > 0;

  return (
    <QueryClientProvider client={queryClient}>
      <div className="min-h-screen bg-gray-100">
        {/* Header */}
        <header className="bg-white shadow-sm">
          <div className="max-w-7xl mx-auto px-4 py-4">
            <div className="flex items-center justify-between">
              <h1 className="text-2xl font-bold text-gray-900">
                Manual Backtesting System
              </h1>
              {hasData && (
                <button
                  onClick={resetSession}
                  className="px-4 py-2 text-sm bg-gray-200 hover:bg-gray-300 rounded transition-colors"
                >
                  Reset Session
                </button>
              )}
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="max-w-7xl mx-auto px-4 py-6">
          {!hasData ? (
            /* Data Loading View */
            <div className="max-w-2xl mx-auto">
              <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <h2 className="font-semibold text-blue-900 mb-2">
                  Welcome to Manual Backtesting
                </h2>
                <p className="text-blue-800 text-sm">
                  Load historical candle data to start backtesting. Enter the security ID,
                  select the timeframe, and date range below.
                </p>
              </div>
              <InstrumentSelector />
            </div>
          ) : (
            /* Backtesting View */
            <div className="space-y-6">
              {/* Chart Section */}
              <div className="bg-white rounded-lg shadow-sm overflow-hidden">
                <AdvancedChart />
              </div>

              {/* Controls */}
              <PlaybackControls />

              {/* Trading and Stats Grid */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Trading Panel */}
                <div className="md:col-span-1">
                  <TradingPanel />
                </div>

                {/* Session Stats */}
                <div className="md:col-span-2">
                  <SessionStats />
                </div>
              </div>

              {/* Load New Data Button */}
              <div className="text-center">
                <button
                  onClick={() => useSessionStore.getState().loadCandles([], '')}
                  className="px-6 py-2 text-sm bg-gray-200 hover:bg-gray-300 rounded transition-colors"
                >
                  Load Different Data
                </button>
              </div>
            </div>
          )}
        </main>

        {/* Footer */}
        <footer className="mt-12 py-6 text-center text-sm text-gray-600">
          <p>Manual Backtesting System - MVP v1.0</p>
          <p className="mt-1">
            Use keyboard shortcuts: Space (Play/Pause), ← → (Step)
          </p>
        </footer>
      </div>
    </QueryClientProvider>
  );
}

export default App;
