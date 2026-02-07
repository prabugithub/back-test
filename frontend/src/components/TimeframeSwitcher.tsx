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

                    // Find the closest candle index based on the saved timestamp BEFORE loading
                    let newIndex = 0;
                    if (currentTimestamp) {
                        console.log('[TimeframeSwitcher] Current timestamp:', currentTimestamp, 'Date:', new Date(currentTimestamp * 1000).toISOString());
                        console.log('[TimeframeSwitcher] Resampled candles count:', resampledCandles.length);
                        console.log('[TimeframeSwitcher] First candle:', resampledCandles[0]?.timestamp, new Date(resampledCandles[0]?.timestamp * 1000).toISOString());
                        console.log('[TimeframeSwitcher] Last candle:', resampledCandles[resampledCandles.length - 1]?.timestamp, new Date(resampledCandles[resampledCandles.length - 1]?.timestamp * 1000).toISOString());

                        // Special case: if current timestamp is before the first candle (e.g., daily at 00:00 but 5m starts at 09:15)
                        // Find the first candle on the same day instead of going to index 0
                        if (currentTimestamp < resampledCandles[0].timestamp) {
                            // Get the date of the current timestamp
                            const currentDate = new Date(currentTimestamp * 1000);
                            const currentDay = currentDate.getUTCDate();
                            const currentMonth = currentDate.getUTCMonth();
                            const currentYear = currentDate.getUTCFullYear();

                            // Find the first candle on the same day
                            newIndex = resampledCandles.findIndex(c => {
                                const candleDate = new Date(c.timestamp * 1000);
                                return candleDate.getUTCDate() === currentDay &&
                                    candleDate.getUTCMonth() === currentMonth &&
                                    candleDate.getUTCFullYear() === currentYear;
                            });

                            if (newIndex === -1) {
                                // If no candle found on the same day, use the first candle
                                newIndex = 0;
                            }
                            console.log('[TimeframeSwitcher] Timestamp before first candle, found same-day index:', newIndex);
                        } else {
                            // Normal case: find the candle that is closest to or just before the current timestamp
                            newIndex = resampledCandles.findIndex(c => c.timestamp >= currentTimestamp);
                            console.log('[TimeframeSwitcher] Found index (>=):', newIndex);

                            if (newIndex === -1) {
                                // If no candle found after current time, use the last candle
                                newIndex = resampledCandles.length - 1;
                                console.log('[TimeframeSwitcher] No candle found, using last:', newIndex);
                            } else if (newIndex > 0) {
                                // Check if we found an exact match or a later candle
                                const foundCandle = resampledCandles[newIndex];
                                console.log('[TimeframeSwitcher] Found candle timestamp:', foundCandle.timestamp, 'Target:', currentTimestamp, 'Match:', foundCandle.timestamp === currentTimestamp);

                                if (foundCandle.timestamp === currentTimestamp) {
                                    // Exact match - use this candle
                                    console.log('[TimeframeSwitcher] Exact timestamp match, using found candle:', newIndex);
                                } else {
                                    // Found a later candle - check if target is a daily candle (00:00:00)
                                    const targetDate = new Date(currentTimestamp * 1000);
                                    const isTargetDailyCandle = targetDate.getUTCHours() === 0 &&
                                        targetDate.getUTCMinutes() === 0 &&
                                        targetDate.getUTCSeconds() === 0;

                                    // Also check if target is at market open (e.g., 09:00, 09:15)
                                    const targetHour = targetDate.getUTCHours();
                                    const targetMinute = targetDate.getUTCMinutes();
                                    const isNearMarketOpen = (targetHour === 9 && targetMinute <= 30) || (targetHour === 3 && targetMinute <= 30); // 09:00-09:30 or 03:00-03:30 UTC

                                    if (isTargetDailyCandle || isNearMarketOpen) {
                                        // Target is a daily candle or near market open, find first candle of that day
                                        const targetDay = targetDate.getUTCDate();
                                        const targetMonth = targetDate.getUTCMonth();
                                        const targetYear = targetDate.getUTCFullYear();

                                        // Search for the first candle on the target day
                                        const sameDayIndex = resampledCandles.findIndex(c => {
                                            const candleDate = new Date(c.timestamp * 1000);
                                            return candleDate.getUTCDate() === targetDay &&
                                                candleDate.getUTCMonth() === targetMonth &&
                                                candleDate.getUTCFullYear() === targetYear;
                                        });

                                        if (sameDayIndex !== -1) {
                                            newIndex = sameDayIndex;
                                            console.log('[TimeframeSwitcher] Daily/market-open candle detected, using first candle of same day:', newIndex);
                                        } else {
                                            // Fallback to previous candle
                                            newIndex = Math.max(0, newIndex - 1);
                                            console.log('[TimeframeSwitcher] No same-day candle found, using previous:', newIndex);
                                        }
                                    } else {
                                        // Normal case: use the previous candle
                                        newIndex = Math.max(0, newIndex - 1);
                                        console.log('[TimeframeSwitcher] Adjusted to previous candle:', newIndex);
                                    }
                                }
                            }
                        }

                        console.log('[TimeframeSwitcher] Final newIndex:', newIndex, 'Candle timestamp:', resampledCandles[newIndex]?.timestamp, new Date(resampledCandles[newIndex]?.timestamp * 1000).toISOString());
                    }

                    // Load candles (this will reset state)
                    loadCandles(resampledCandles, `NIFTY 50 (Local ${newInterval})`, updatedConfig);

                    // Immediately restore the session state (synchronously)
                    // Use the saved variables, not fetching from store again
                    console.log('[TimeframeSwitcher] Restoring state - Trades:', savedTrades.length, 'Position:', savedPosition, 'Index:', newIndex);
                    useSessionStore.getState().restoreSessionState(savedTrades, savedPosition, newIndex);
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
