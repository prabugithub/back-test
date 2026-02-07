import { useSessionStore } from '../stores/sessionStore';
import { parseColumnarData, resampleCandles, type ColumnarData } from '../utils/resampler';
import { useState } from 'react';

const TIMEFRAMES = [
    { value: '5', label: '5m' },
    { value: '15', label: '15m' },
    { value: '60', label: '1h' },
    { value: '1D', label: '1D' },
];

// Dynamic import for the large JSON file
const loadNiftyData = () => import('../assets/market-data/nifty5min_data.json');

export function TimeframeSwitcher() {
    const sessionConfig = useSessionStore((s) => s.sessionConfig);
    const loadCandles = useSessionStore((s) => s.loadCandles);
    const [isLoading, setIsLoading] = useState(false);

    const currentInterval = sessionConfig?.interval || '5';

    const handleTimeframeChange = async (newInterval: string) => {
        if (!sessionConfig) {
            console.warn('No session config available');
            return;
        }

        if (newInterval === currentInterval) return;

        setIsLoading(true);

        try {
            if (sessionConfig.dataSource === 'local') {
                // Save current state before switching
                const currentState = useSessionStore.getState();
                const savedTrades = [...currentState.trades];
                const savedPosition = currentState.position ? { ...currentState.position } : null;
                const currentCandle = currentState.candles[currentState.currentIndex];
                const currentTimestamp = currentCandle?.timestamp;

                // Reload and resample local data
                const module = await loadNiftyData();
                const rawData: any = module.default || module;

                if (!rawData || !rawData.t || !rawData.o || !rawData.h || !rawData.l || !rawData.c || !rawData.v) {
                    throw new Error('Invalid JSON data format');
                }

                let allCandles = parseColumnarData(rawData as ColumnarData);

                // Filter by date range
                if (sessionConfig.fromDate) {
                    const fromTs = new Date(sessionConfig.fromDate).getTime() / 1000;
                    allCandles = allCandles.filter(c => c.timestamp >= fromTs);
                }
                if (sessionConfig.toDate) {
                    const toTs = (new Date(sessionConfig.toDate).getTime() / 1000) + 86400;
                    allCandles = allCandles.filter(c => c.timestamp < toTs);
                }

                // Determine timeframe in minutes
                let timeframeMinutes = 5;
                if (newInterval === '5') timeframeMinutes = 5;
                if (newInterval === '15') timeframeMinutes = 15;
                if (newInterval === '60') timeframeMinutes = 60;
                if (newInterval === '1D') timeframeMinutes = 1440;

                const resampledCandles = timeframeMinutes === 5 ? allCandles : resampleCandles(allCandles, timeframeMinutes);

                if (resampledCandles.length > 0) {
                    const updatedConfig = { ...sessionConfig, interval: newInterval };

                    // Load candles (this will reset state)
                    loadCandles(resampledCandles, `NIFTY 50 (Local ${newInterval})`, updatedConfig);

                    // Restore state after a brief delay to ensure candles are loaded
                    setTimeout(() => {
                        const state = useSessionStore.getState();

                        // Find the closest candle index based on the saved timestamp
                        let newIndex = 0;
                        if (currentTimestamp) {
                            // Find the candle that is closest to or just before the current timestamp
                            newIndex = resampledCandles.findIndex(c => c.timestamp >= currentTimestamp);
                            if (newIndex === -1) {
                                // If no candle found after current time, use the last candle
                                newIndex = resampledCandles.length - 1;
                            } else if (newIndex > 0) {
                                // Use the candle just before or at the timestamp
                                newIndex = Math.max(0, newIndex - 1);
                            }
                        }

                        // Restore the session state
                        state.restoreSessionState(savedTrades, savedPosition, newIndex);
                    }, 50);
                }
            } else {
                // For API data source, we would need to re-fetch from the API
                // This is a placeholder - you may want to implement this differently
                console.warn('Timeframe switching for API data source not yet implemented');
            }
        } catch (error) {
            console.error('Failed to switch timeframe:', error);
        } finally {
            setIsLoading(false);
        }
    };

    // Only show if session is loaded and it's local data
    if (!sessionConfig || sessionConfig.dataSource !== 'local') {
        return null;
    }

    return (
        <div className="relative">
            <select
                value={currentInterval}
                onChange={(e) => handleTimeframeChange(e.target.value)}
                disabled={isLoading}
                className="px-3 py-1.5 pr-8 text-sm font-medium border rounded bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed appearance-none"
                style={{ minWidth: '70px' }}
            >
                {TIMEFRAMES.map((tf) => (
                    <option key={tf.value} value={tf.value}>
                        {tf.label}
                    </option>
                ))}
            </select>
            {/* Custom dropdown arrow */}
            <div className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-gray-500">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M3 5L6 8L9 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
            </div>
            {isLoading && (
                <div className="absolute -right-16 top-1/2 -translate-y-1/2">
                    <span className="text-xs text-gray-500">Loading...</span>
                </div>
            )}
        </div>
    );
}
