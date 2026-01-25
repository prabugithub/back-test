import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { InstrumentSelector } from './components/InstrumentSelector';
import { AdvancedChart } from './components/AdvancedChart';
import { PlaybackControls } from './components/PlaybackControls';

// import { SessionStats } from './components/SessionStats'; // Now in dialog
import { TradeHistoryDialog } from './components/TradeHistoryDialog';
import { PositionOverlay } from './components/PositionOverlay';
import { useSessionStore } from './stores/sessionStore';
import { useState } from 'react';
import { NotificationToast } from './components/NotificationToast';
import { Save, FilePlus } from 'lucide-react';

const queryClient = new QueryClient();

function App() {
  const candles = useSessionStore((s: any) => s.candles);
  const [isTradeHistoryOpen, setIsTradeHistoryOpen] = useState(false);

  const hasData = candles.length > 0;

  return (
    <QueryClientProvider client={queryClient}>
      <div className="h-screen w-screen bg-gray-100 flex overflow-hidden font-sans">
        <NotificationToast />
        {/* Main Content Area */}
        <main className="flex-1 flex flex-col relative min-w-0">
          {!hasData ? (
            <div className="flex-1 overflow-y-auto p-4 md:p-8 bg-white flex flex-col items-center">
              <div className="max-w-2xl w-full my-auto">
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
                <PositionOverlay onOpenDetail={() => setIsTradeHistoryOpen(true)} />
              </div>

              {isTradeHistoryOpen && (
                <TradeHistoryDialog
                  isOpen={isTradeHistoryOpen}
                  onClose={() => setIsTradeHistoryOpen(false)}
                />
              )}
              {/* Controls Bar */}
              <div className="flex-none p-1 bg-white border-b z-10 flex flex-nowrap gap-2 items-center">
                <div className="flex-1 min-w-0">
                  <PlaybackControls onOpenHistory={() => setIsTradeHistoryOpen(true)} />
                </div>
                {/* Compact Stats or Buttons could go here */}
                <button
                  onClick={() => useSessionStore.getState().saveRemoteSession()}
                  className="p-1.5 text-blue-700 bg-blue-50 border border-blue-200 hover:bg-blue-100 rounded"
                  title="Save current session to Firebase"
                >
                  <Save size={16} />
                </button>
                <button
                  onClick={() => useSessionStore.getState().loadCandles([], '')}
                  className="p-1.5 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded border border-gray-300"
                  title="Load New Data / Reset"
                >
                  <FilePlus size={16} />
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
