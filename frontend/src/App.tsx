import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { InstrumentSelector } from './components/InstrumentSelector';
import { AdvancedChart } from './components/AdvancedChart';
import { PlaybackControls } from './components/PlaybackControls';

// import { SessionStats } from './components/SessionStats'; // Now in dialog
import { TradeHistoryDialog } from './components/TradeHistoryDialog';
import { PositionOverlay } from './components/PositionOverlay';
import { useSessionStore } from './stores/sessionStore';
import { useState } from 'react';

const queryClient = new QueryClient();

function App() {
  const candles = useSessionStore((s) => s.candles);
  const [isTradeHistoryOpen, setIsTradeHistoryOpen] = useState(false);

  const hasData = candles.length > 0;

  return (
    <QueryClientProvider client={queryClient}>
      <div className="h-screen w-screen bg-gray-100 flex overflow-hidden">
        {/* Main Content Area */}
        <main className="flex-1 flex flex-col relative min-w-0">
          {!hasData ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 bg-white">
              <div className="max-w-2xl w-full">
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
            </div>
          ) : (
            <div className="flex-1 flex flex-col relative h-full">
              {/* Chart Area */}
              <div className="flex-1 relative min-h-0">
                <AdvancedChart />
                <PositionOverlay />
              </div>

              {isTradeHistoryOpen && (
                <TradeHistoryDialog
                  isOpen={isTradeHistoryOpen}
                  onClose={() => setIsTradeHistoryOpen(false)}
                />
              )}
              {/* Controls Bar */}
              <div className="flex-none p-2 bg-white border-b z-10 flex gap-2 items-center">
                <div className="flex-1">
                  <PlaybackControls onOpenHistory={() => setIsTradeHistoryOpen(true)} />
                </div>
                {/* Compact Stats or Buttons could go here */}
                <button
                  onClick={() => useSessionStore.getState().loadCandles([], '')}
                  className="px-3 py-1 text-xs bg-gray-100 text-gray-600 hover:bg-gray-200 rounded"
                >
                  New Data
                </button>
              </div>
            </div>
          )}
        </main>


      </div>
    </QueryClientProvider>
  );
}

export default App;
