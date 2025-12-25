import { useRef, useEffect, useMemo, useState } from 'react';
import { X, ChevronRight, ChevronDown } from 'lucide-react';
import { useSessionStore } from '../stores/sessionStore';
import { formatCurrency, formatTime } from '../utils/formatters';
import { groupTradesIntoPositions, calculatePerformanceStats } from '../utils/tradeAnalysis';

interface TradeHistoryDialogProps {
    isOpen: boolean;
    onClose: () => void;
}

export function TradeHistoryDialog({ isOpen, onClose }: TradeHistoryDialogProps) {
    const trades = useSessionStore((s) => s.trades);
    const dialogRef = useRef<HTMLDivElement>(null);
    const [expandedPosId, setExpandedPosId] = useState<string | null>(null);

    // Group trades and calculate stats
    const positions = useMemo(() => groupTradesIntoPositions(trades), [trades]);
    const stats = useMemo(() => calculatePerformanceStats(positions), [positions]);

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (dialogRef.current && !dialogRef.current.contains(event.target as Node)) {
                onClose();
            }
        }
        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
            <div
                ref={dialogRef}
                className="bg-white rounded-lg shadow-xl w-full max-w-5xl max-h-[85vh] flex flex-col m-4"
            >
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b">
                    <h2 className="text-xl font-bold text-gray-800">Trade Analysis</h2>
                    <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded text-gray-500">
                        <X size={24} />
                    </button>
                </div>

                {/* content */}
                <div className="flex-1 overflow-auto bg-gray-50 p-6">

                    {/* Stats Summary Cards */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                        <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-100">
                            <div className="text-sm text-gray-500 mb-1">Total Net P&L</div>
                            <div className={`text-2xl font-bold ${stats.totalPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                {formatCurrency(stats.totalPnL)}
                            </div>
                            <div className="text-xs text-gray-400 mt-1">
                                {stats.totalTrades} Trades ({stats.winningTrades}W - {stats.losingTrades}L)
                            </div>
                        </div>

                        <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-100">
                            <div className="text-sm text-gray-500 mb-1">Win Rate</div>
                            <div className="text-2xl font-bold text-blue-600">
                                {stats.winRate.toFixed(1)}%
                            </div>
                            <div className="text-xs text-gray-400 mt-1">
                                PF: {stats.profitFactor.toFixed(2)}
                            </div>
                        </div>

                        <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-100">
                            <div className="text-sm text-gray-500 mb-1">Avg Win / Loss</div>
                            <div className="flex justify-between items-baseline">
                                <span className="text-green-600 font-semibold">{formatCurrency(stats.avgWin)}</span>
                                <span className="text-gray-300">/</span>
                                <span className="text-red-600 font-semibold">{formatCurrency(stats.avgLoss)}</span>
                            </div>
                        </div>

                        <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-100">
                            <div className="text-sm text-gray-500 mb-1">Longs vs Shorts</div>
                            <div className="space-y-1 text-sm">
                                <div className="flex justify-between">
                                    <span>Longs</span>
                                    <span className={stats.longs.pnl >= 0 ? 'text-green-600' : 'text-red-600'}>
                                        {formatCurrency(stats.longs.pnl)} ({stats.longs.count})
                                    </span>
                                </div>
                                <div className="flex justify-between">
                                    <span>Shorts</span>
                                    <span className={stats.shorts.pnl >= 0 ? 'text-green-600' : 'text-red-600'}>
                                        {formatCurrency(stats.shorts.pnl)} ({stats.shorts.count})
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Positions Table */}
                    <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
                        <table className="w-full text-sm text-left">
                            <thead className="bg-gray-50 text-gray-600 font-semibold border-b">
                                <tr>
                                    <th className="px-4 py-3 w-10"></th>
                                    <th className="px-4 py-3">Status</th>
                                    <th className="px-4 py-3">Entry Time</th>
                                    <th className="px-4 py-3">Direction</th>
                                    <th className="px-4 py-3 text-right">Qty</th>
                                    <th className="px-4 py-3 text-right">Avg Entry</th>
                                    <th className="px-4 py-3 text-right">Avg Exit</th>
                                    <th className="px-4 py-3 text-right">P&L</th>
                                    <th className="px-4 py-3 text-right">Duration</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {positions.length === 0 ? (
                                    <tr>
                                        <td colSpan={9} className="px-4 py-8 text-center text-gray-500">
                                            No positions recorded yet.
                                        </td>
                                    </tr>
                                ) : (
                                    positions.map((pos) => {
                                        const isExpanded = expandedPosId === pos.id;
                                        return (
                                            <>
                                                <tr
                                                    key={pos.id}
                                                    className="hover:bg-gray-50 cursor-pointer transition-colors"
                                                    onClick={() => setExpandedPosId(isExpanded ? null : pos.id)}
                                                >
                                                    <td className="px-4 py-3 text-gray-400">
                                                        {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${pos.status === 'OPEN' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
                                                            }`}>
                                                            {pos.status}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3 text-gray-600">
                                                        {formatTime(pos.entryTime)}
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <span className={`font-semibold ${pos.direction === 'LONG' ? 'text-green-600' : 'text-red-600'}`}>
                                                            {pos.direction}
                                                        </span>
                                                    </td>
                                                    <td className="px-4 py-3 text-right font-mono">
                                                        {pos.totalQuantity}
                                                    </td>
                                                    <td className="px-4 py-3 text-right font-mono text-gray-600">
                                                        {formatCurrency(pos.avgEntryPrice)}
                                                    </td>
                                                    <td className="px-4 py-3 text-right font-mono text-gray-600">
                                                        {pos.avgExitPrice ? formatCurrency(pos.avgExitPrice) : '-'}
                                                    </td>
                                                    <td className={`px-4 py-3 text-right font-bold font-mono ${pos.realizedPnL > 0 ? 'text-green-600' : pos.realizedPnL < 0 ? 'text-red-600' : 'text-gray-400'
                                                        }`}>
                                                        {formatCurrency(pos.realizedPnL)}
                                                    </td>
                                                    <td className="px-4 py-3 text-right text-gray-500">
                                                        {pos.durationMinutes ? `${pos.durationMinutes.toFixed(1)}m` : '-'}
                                                    </td>
                                                </tr>
                                                {/* Expanded Executions Row */}
                                                {isExpanded && (
                                                    <tr className="bg-gray-50">
                                                        <td colSpan={9} className="px-4 py-3 pl-12">
                                                            <div className="border rounded bg-white overflow-hidden text-xs">
                                                                <table className="w-full">
                                                                    <thead className="bg-gray-100 text-gray-500">
                                                                        <tr>
                                                                            <th className="px-3 py-2 text-left">Exec Time</th>
                                                                            <th className="px-3 py-2 text-left">Type</th>
                                                                            <th className="px-3 py-2 text-right">Price</th>
                                                                            <th className="px-3 py-2 text-right">Qty</th>
                                                                            <th className="px-3 py-2 text-right">Realized P&L</th>
                                                                        </tr>
                                                                    </thead>
                                                                    <tbody className="divide-y divide-gray-100">
                                                                        {pos.executions.map((exec, idx) => (
                                                                            <tr key={exec.id || idx}>
                                                                                <td className="px-3 py-2 text-gray-600">{formatTime(exec.timestamp)}</td>
                                                                                <td className={`px-3 py-2 font-semibold ${exec.type === 'BUY' ? 'text-green-600' : 'text-red-600'}`}>
                                                                                    {exec.type}
                                                                                </td>
                                                                                <td className="px-3 py-2 text-right font-mono">{formatCurrency(exec.price)}</td>
                                                                                <td className="px-3 py-2 text-right font-mono">{exec.quantity}</td>
                                                                                <td className="px-3 py-2 text-right font-mono text-gray-500">
                                                                                    {exec.pnl ? formatCurrency(exec.pnl) : '-'}
                                                                                </td>
                                                                            </tr>
                                                                        ))}
                                                                    </tbody>
                                                                </table>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                )}
                                            </>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>

                </div>
            </div>
        </div>
    );
}
