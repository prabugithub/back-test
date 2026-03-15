import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { InstrumentSelector } from './components/InstrumentSelector';
import { AdvancedChart } from './components/AdvancedChart';
import type { ChartCallbacks } from './components/AdvancedChart';
import { PlaybackControls } from './components/PlaybackControls';
import { ChartToolbar } from './components/ChartToolbar';
import type { DrawingTool, Indicator } from './components/ChartToolbar';

// import { SessionStats } from './components/SessionStats'; // Now in dialog
import { TradeHistoryDialog } from './components/TradeHistoryDialog';
import { PositionOverlay } from './components/PositionOverlay';
import { useSessionStore } from './stores/sessionStore';
import { useState } from 'react';
import { NotificationToast } from './components/NotificationToast';
import { TradeExitDialog } from './components/TradeExitDialog';
import { TradeJournalDialog } from './components/TradeJournalDialog';
import { BackupHistoryDialog } from './components/BackupHistoryDialog';
import { PromptDialog } from './components/PromptDialog';
import { TimeframeSwitcher } from './components/TimeframeSwitcher';
import { Save, FilePlus, RotateCcw } from 'lucide-react';

const queryClient = new QueryClient();

function App() {
  const candles = useSessionStore((s: any) => s.candles);
  const [isTradeHistoryOpen, setIsTradeHistoryOpen] = useState(false);
  const [isBackupHistoryOpen, setIsBackupHistoryOpen] = useState(false);
  const [isSnapshotPromptOpen, setIsSnapshotPromptOpen] = useState(false);
  const showSecondaryChart = useSessionStore((s: any) => s.showSecondaryChart);

  // Shared toolbar state from store
  const sharedActiveTool = useSessionStore((s: any) => s.sharedActiveTool) as DrawingTool;
  const setSharedActiveTool = useSessionStore((s: any) => s.setSharedActiveTool);
  const sharedActiveIndicators = useSessionStore((s: any) => s.sharedActiveIndicators) as Indicator[];
  const toggleSharedIndicator = useSessionStore((s: any) => s.toggleSharedIndicator);

  // Callbacks from the currently-active chart (the focused chart registers these)
  const [chartCallbacks, setChartCallbacks] = useState<ChartCallbacks>({});

  const hasData = candles.length > 0;

  const handleSaveSnapshot = (name: string) => {
    useSessionStore.getState().saveRemoteSnapshot(name);
  };

  /** Called by each chart when it becomes active — merges callbacks */
  const handleRegisterCallbacks = (cbs: ChartCallbacks) => {
    setChartCallbacks(cbs);
  };

  return (
    <QueryClientProvider client={queryClient}>
      <div className="h-screen w-screen bg-gray-100 flex overflow-hidden font-sans">
        <NotificationToast />
        <TradeExitDialog />
        <TradeJournalDialog />
        <BackupHistoryDialog
          isOpen={isBackupHistoryOpen}
          onClose={() => setIsBackupHistoryOpen(false)}
        />
        <PromptDialog
          isOpen={isSnapshotPromptOpen}
          onClose={() => setIsSnapshotPromptOpen(false)}
          onSubmit={handleSaveSnapshot}
          title="Save Snapshot"
          message="Enter a name for this snapshot to identify it later (e.g., 'Before News Event')."
          placeholder="Snapshot Name..."
          confirmText="Save Snapshot"
        />
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

              {/* ── Shared Chart Toolbar (applies to the active/focused chart) ── */}
              <div className="relative z-[100]">
                <ChartToolbar
                  activeTool={sharedActiveTool}
                  onToolChange={(tool) => setSharedActiveTool(tool)}
                  activeIndicators={sharedActiveIndicators}
                  onIndicatorToggle={(ind) => toggleSharedIndicator(ind as string)}
                  onClearDrawings={() => chartCallbacks.clearDrawings?.()}
                  onDeleteSelected={() => chartCallbacks.deleteSelected?.()}
                  onTakeScreenshot={() => chartCallbacks.takeScreenshot?.()}
                  onDownloadScreenshot={() => chartCallbacks.downloadScreenshot?.()}
                  isUploadingScreenshot={chartCallbacks.isUploadingScreenshot ?? false}
                  hasSelection={chartCallbacks.hasSelection ?? false}
                />
              </div>

              {/* Chart Area */}
              <div className={`flex-1 relative min-h-0 flex ${showSecondaryChart ? 'flex-row' : 'flex-col'}`}>
                <div className="flex-1 relative min-w-0">
                  <AdvancedChart
                    onRegisterCallbacks={handleRegisterCallbacks}
                  />
                  {!showSecondaryChart && (
                    <PositionOverlay onOpenDetail={() => setIsTradeHistoryOpen(true)} />
                  )}
                </div>

                {showSecondaryChart && (
                  <div className="w-[40%] relative min-w-0 border-l-2 border-gray-300">
                    <AdvancedChart
                      isSecondary
                      onRegisterCallbacks={handleRegisterCallbacks}
                    />
                    <PositionOverlay onOpenDetail={() => setIsTradeHistoryOpen(true)} />
                  </div>
                )}
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
                <TimeframeSwitcher />
                {/* Compact Stats or Buttons could go here */}
                <button
                  onClick={() => useSessionStore.getState().saveRemoteSession()}
                  className="p-1.5 text-blue-700 bg-blue-50 border border-blue-200 hover:bg-blue-100 rounded"
                  title="Save current session to Firebase (Auto-Backup)"
                >
                  <Save size={16} />
                </button>
                <button
                  onClick={() => setIsSnapshotPromptOpen(true)}
                  className="p-1.5 text-purple-700 bg-purple-50 border border-purple-200 hover:bg-purple-100 rounded"
                  title="Save Permanent Snapshot"
                >
                  <Save size={16} className="fill-purple-700" />
                </button>
                <button
                  onClick={() => setIsBackupHistoryOpen(true)}
                  className="p-1.5 text-amber-700 bg-amber-50 border border-amber-200 hover:bg-amber-100 rounded"
                  title="Restore from last Backups (History)"
                >
                  <RotateCcw size={16} />
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
