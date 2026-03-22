import { useState } from 'react';
import { useSessionStore } from '../stores/sessionStore';
import { groupTradesIntoPositions } from '../utils/tradeAnalysis';
import { backtestOptions } from '../services/api';
import { formatCurrency } from '../utils/formatters';
import { useNotificationStore } from '../stores/notificationStore';

export function OptionBacktestModal({ 
  isOpen, 
  onClose, 
  customPositions, 
  customInstrument 
}: { 
  isOpen: boolean, 
  onClose: () => void,
  customPositions?: any[],
  customInstrument?: string
}) {
    const sessionTrades = useSessionStore((s) => s.trades);
    const sessionInstrument = useSessionStore((s) => s.instrument);
    const [isLoading, setIsLoading] = useState(false);
    const [results, setResults] = useState<any>(null);
    const [offsetSell, setOffsetSell] = useState(2);
    const [offsetBuy, setOffsetBuy] = useState(4);
    const notify = useNotificationStore((s) => s.notify);

    const handleRunBacktest = async () => {
        const finalInstrument = customInstrument || sessionInstrument;
        const finalPositions = customPositions || groupTradesIntoPositions(sessionTrades);

        if (finalPositions.length === 0) {
            notify('No trades to backtest', 'warning');
            return;
        }

        setIsLoading(true);
        try {
            // Backend expects original order (entry time ascending)
            // If they come from groupTradesIntoPositions, they are already sorted by entry time
            const originalOrderPositions = [...finalPositions];
            
            const data = await backtestOptions({
                spotTrades: originalOrderPositions,
                offsetSell,
                offsetBuy,
                instrument: finalInstrument.includes('NIFTY') ? 'NIFTY' : 'NIFTY' // Defaulting to NIFTY
            });
            setResults(data);
            notify('Option backtest completed!', 'success');
        } catch (error: any) {
            console.error(error);
            notify(`Failed to run option backtest: ${error.message}`, 'error');
        } finally {
            setIsLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 overflow-auto p-4">
            <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col">
                <div className="p-6 border-b flex justify-between items-center bg-gradient-to-r from-blue-600 to-indigo-700 text-white rounded-t-xl">
                    <h2 className="text-xl font-bold">Option Spread Backtest (Dhan API)</h2>
                    <button onClick={onClose} className="text-white hover:text-gray-200 text-2xl">&times;</button>
                </div>

                <div className="p-6 overflow-y-auto flex-1">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                        <div className="space-y-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
                            <h3 className="font-semibold text-gray-800 border-b pb-2">Backtest Configuration</h3>
                            <div className="space-y-3">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Sell Strike Offset (OTM)</label>
                                    <input 
                                        type="number" 
                                        value={offsetSell} 
                                        onChange={(e) => setOffsetSell(Number(e.target.value))}
                                        className="w-full border rounded px-3 py-2"
                                        placeholder="e.g. 2 for 200 pts OTM"
                                    />
                                    <p className="text-xs text-gray-500 mt-1">Number of 50-pt strikes away from ATM</p>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Buy Strike Offset (Hedge)</label>
                                    <input 
                                        type="number" 
                                        value={offsetBuy} 
                                        onChange={(e) => setOffsetBuy(Number(e.target.value))}
                                        className="w-full border rounded px-3 py-2"
                                        placeholder="e.g. 4 for 400 pts OTM"
                                    />
                                    <p className="text-xs text-gray-500 mt-1">Must be further from ATM than Sell strike</p>
                                </div>
                                <button
                                    onClick={handleRunBacktest}
                                    disabled={isLoading}
                                    className={`w-full py-3 px-4 rounded-lg font-bold text-white transition-all shadow-md ${
                                        isLoading ? 'bg-gray-400' : 'bg-gradient-to-r from-green-500 to-emerald-600 hover:scale-[1.02] active:scale-[0.98]'
                                    }`}
                                >
                                    {isLoading ? 'Fetching Data...' : 'Run Analysis (5-Year Data)'}
                                </button>
                            </div>
                        </div>

                        {results && (
                            <div className="space-y-4 p-4 bg-indigo-50 rounded-lg border border-indigo-100">
                                <h3 className="font-semibold text-indigo-900 border-b border-indigo-200 pb-2">Results Summary</h3>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="bg-white p-3 rounded shadow-sm">
                                        <p className="text-xs text-gray-500 uppercase tracking-wider">Spot P&L</p>
                                        <p className={`text-lg font-bold ${results.summary.spotTotalPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                            {formatCurrency(results.summary.spotTotalPnL)}
                                        </p>
                                    </div>
                                    <div className="bg-white p-3 rounded shadow-sm">
                                        <p className="text-xs text-gray-500 uppercase tracking-wider">Option P&L</p>
                                        <p className={`text-lg font-bold ${results.summary.totalRealizedPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                            {formatCurrency(results.summary.totalRealizedPnL)}
                                        </p>
                                    </div>
                                    <div className="bg-white p-3 rounded shadow-sm">
                                        <p className="text-xs text-gray-500 uppercase tracking-wider">Alt P&L (Win %)</p>
                                        <p className="text-lg font-bold text-blue-600">{results.summary.winRate.toFixed(1)}%</p>
                                    </div>
                                    <div className="bg-white p-3 rounded shadow-sm">
                                        <p className="text-xs text-gray-500 uppercase tracking-wider">Trades Count</p>
                                        <p className="text-lg font-bold text-gray-800">{results.summary.totalTrades}</p>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    {results && (
                        <div className="mt-6">
                            <h3 className="font-bold text-gray-800 mb-4 border-b pb-2">Trade Details</h3>
                            <div className="overflow-x-auto">
                                <table className="min-w-full text-sm divide-y divide-gray-200">
                                    <thead className="bg-gray-50 text-gray-600 font-medium">
                                        <tr>
                                            <th className="px-4 py-3 text-left">Trade</th>
                                            <th className="px-4 py-3 text-left">Strategy</th>
                                            <th className="px-4 py-3 text-right">Spot P&L</th>
                                            <th className="px-4 py-3 text-right">Option P&L</th>
                                            <th className="px-4 py-3 text-left">Sell Leg</th>
                                            <th className="px-4 py-3 text-left">Buy Leg</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                        {results.trades.map((t: any, idx: number) => (
                                            <tr key={idx} className="hover:bg-gray-50 transition-colors">
                                                <td className="px-4 py-3">
                                                    <div className="font-medium text-gray-900">{t.direction}</div>
                                                    <div className="text-xs text-gray-500">{new Date(t.entryTime).toLocaleDateString()}</div>
                                                </td>
                                                <td className="px-4 py-3">
                                                    {t.optionResults ? (
                                                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700 border border-blue-100 uppercase">
                                                            {t.optionResults.optionType === 'PUT' ? 'Bull Put' : 'Bear Call'}
                                                        </span>
                                                    ) : '-'}
                                                </td>
                                                <td className={`px-4 py-3 text-right font-medium ${t.realizedPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                                    {formatCurrency(t.realizedPnL)}
                                                </td>
                                                <td className={`px-4 py-3 text-right font-bold ${t.optionResults?.totalPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                                    {t.optionResults ? formatCurrency(t.optionResults.totalPnL) : (t.error || '-')}
                                                </td>
                                                <td className="px-4 py-3 text-xs text-gray-600">
                                                    {t.optionResults ? (
                                                        <div>
                                                            <div className="font-medium">{t.optionResults.sellStrike}</div>
                                                            <div>{t.optionResults.l1Entry.toFixed(2)} → {t.optionResults.l1Exit.toFixed(2)}</div>
                                                        </div>
                                                    ) : '-'}
                                                </td>
                                                <td className="px-4 py-3 text-xs text-gray-600">
                                                    {t.optionResults ? (
                                                        <div>
                                                            <div className="font-medium">{t.optionResults.buyStrike}</div>
                                                            <div>{t.optionResults.l2Entry.toFixed(2)} → {t.optionResults.l2Exit.toFixed(2)}</div>
                                                        </div>
                                                    ) : '-'}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>

                <div className="p-6 border-t bg-gray-50 flex justify-end rounded-b-xl">
                    <button
                        onClick={onClose}
                        className="px-6 py-2 bg-white border border-gray-300 rounded-lg text-gray-700 font-semibold hover:bg-gray-50 transition-colors"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
}
