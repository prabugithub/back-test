import { useState, useMemo } from 'react';
import { X, Trash2, TrendingUp, TrendingDown, DollarSign, Target, Calendar, BarChart3, FileJson, Printer, FileSpreadsheet } from 'lucide-react';
import { getStoredSessions, deleteTradeSession, updateTradeSession, type TradeSession } from '../utils/tradeStorage';
import { formatCurrency, formatTimestamp } from '../utils/formatters';
import { groupTradesIntoPositions, calculatePerformanceStats, recalculateTradesPnL } from '../utils/tradeAnalysis';

interface TradeReportDialogProps {
    isOpen: boolean;
    onClose: () => void;
}

export function TradeReportDialog({ isOpen, onClose }: TradeReportDialogProps) {
    const [sessions, setSessions] = useState<TradeSession[]>(() => getStoredSessions());
    const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

    const selectedSession = useMemo(() => {
        return sessions.find(s => s.id === selectedSessionId) || null;
    }, [sessions, selectedSessionId]);

    const selectedSessionStats = useMemo(() => {
        if (!selectedSession) return null;
        const positions = groupTradesIntoPositions(selectedSession.trades);
        return calculatePerformanceStats(positions);
    }, [selectedSession]);

    const handleDeleteSession = (sessionId: string) => {
        if (confirm('Are you sure you want to delete this session?')) {
            deleteTradeSession(sessionId);
            setSessions(getStoredSessions());
            if (selectedSessionId === sessionId) {
                setSelectedSessionId(null);
            }
        }
    };

    const handleDeleteTrade = (tradeId: string) => {
        if (!selectedSession || !selectedSessionStats) return;

        if (confirm('Delete this trade from history? Metrics will be recalculated.')) {
            const newTradesList = selectedSession.trades.filter(t => t.id !== tradeId);

            if (newTradesList.length === 0) {
                handleDeleteSession(selectedSession.id);
                return;
            }

            // Recalculate P&L and stats
            const { processedTrades, totalRealizedPnL } = recalculateTradesPnL(newTradesList);
            const newPositions = groupTradesIntoPositions(processedTrades);
            const newStats = calculatePerformanceStats(newPositions);

            const updatedSession: TradeSession = {
                ...selectedSession,
                trades: processedTrades,
                totalPnL: totalRealizedPnL,
                winRate: newStats.winRate,
                totalTrades: processedTrades.length,
                startDate: processedTrades[0].timestamp,
                endDate: processedTrades[processedTrades.length - 1].timestamp
            };

            updateTradeSession(updatedSession);
            setSessions(getStoredSessions());
        }
    };

    const handleDeletePosition = (positionId: string) => {
        if (!selectedSession || !selectedSessionStats) return;

        const positions = groupTradesIntoPositions(selectedSession.trades);
        const positionToDelete = positions.find(p => p.id === positionId);

        if (!positionToDelete) return;

        if (confirm(`Delete entire ${positionToDelete.status} ${positionToDelete.direction} position and its ${positionToDelete.executions.length} trades?`)) {
            const executionIds = positionToDelete.executions.map(ex => ex.id);
            const newTradesList = selectedSession.trades.filter(t => !executionIds.includes(t.id));

            if (newTradesList.length === 0) {
                handleDeleteSession(selectedSession.id);
                return;
            }

            const { processedTrades, totalRealizedPnL } = recalculateTradesPnL(newTradesList);
            const newPositions = groupTradesIntoPositions(processedTrades);
            const newStats = calculatePerformanceStats(newPositions);

            const updatedSession: TradeSession = {
                ...selectedSession,
                trades: processedTrades,
                totalPnL: totalRealizedPnL,
                winRate: newStats.winRate,
                totalTrades: processedTrades.length,
                startDate: processedTrades[0].timestamp,
                endDate: processedTrades[processedTrades.length - 1].timestamp
            };

            updateTradeSession(updatedSession);
            setSessions(getStoredSessions());
        }
    };

    const handleExportCSV = () => {
        if (!selectedSession || !selectedSessionStats) return;

        const positions = groupTradesIntoPositions(selectedSession.trades);

        let csvContent = `TRADING SESSION REPORT - ${selectedSession.instrument}\n`;
        csvContent += `Generated,${new Date().toLocaleString()}\n`;
        csvContent += `Start Date,${new Date(selectedSession.startDate).toLocaleString()}\n\n`;

        csvContent += "PERFORMANCE SUMMARY\n";
        csvContent += `Total P&L,${selectedSessionStats.totalPnL.toFixed(2)}\n`;
        csvContent += `Win Rate,${selectedSessionStats.winRate.toFixed(1)}%\n`;
        csvContent += `Winning Trades,${selectedSessionStats.winningTrades}\n`;
        csvContent += `Losing Trades,${selectedSessionStats.losingTrades}\n`;
        csvContent += `Avg Win,${selectedSessionStats.avgWin.toFixed(2)}\n`;
        csvContent += `Avg Loss,${selectedSessionStats.avgLoss.toFixed(2)}\n`;
        csvContent += `Profit Factor,${selectedSessionStats.profitFactor.toFixed(2)}\n\n`;

        csvContent += "POSITION SUMMARY\n";
        csvContent += "ID,Direction,Entry Time,Exit Time,Entry Price,Exit Price,Qty,PnL,Duration (min)\n";
        positions.forEach(p => {
            csvContent += `${p.id},${p.direction},${formatTimestamp(p.entryTime)},${p.exitTime ? formatTimestamp(p.exitTime) : 'OPEN'},${p.avgEntryPrice},${p.avgExitPrice || ''},${p.totalQuantity},${p.realizedPnL.toFixed(2)},${p.durationMinutes ? p.durationMinutes.toFixed(1) : ''}\n`;
        });

        csvContent += "\nRAW TRADE EXECUTIONS\n";
        csvContent += "Timestamp,Type,Price,Quantity,Instrument,P&L\n";
        selectedSession.trades.forEach(trade => {
            csvContent += `${new Date(trade.timestamp).toISOString()},${trade.type},${trade.price},${trade.quantity},${trade.instrument},${(trade.pnl || 0).toFixed(2)}\n`;
        });

        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `trade-report-${selectedSession.instrument}-${new Date(selectedSession.startDate).toISOString().split('T')[0]}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleExportJSON = () => {
        if (!selectedSession || !selectedSessionStats) return;

        const positions = groupTradesIntoPositions(selectedSession.trades);
        const reportData = {
            metadata: {
                instrument: selectedSession.instrument,
                startDate: selectedSession.startDate,
                generatedAt: new Date().toISOString(),
            },
            performance: selectedSessionStats,
            positions: positions,
            trades: selectedSession.trades
        };

        const blob = new Blob([JSON.stringify(reportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `trade-report-${selectedSession.instrument}-${new Date(selectedSession.startDate).toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const handlePrint = () => {
        window.print();
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[2000]">
            <div className="bg-white rounded-lg shadow-2xl w-[95%] max-w-6xl h-[90vh] flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-t-lg">
                    <div className="flex items-center gap-3">
                        <BarChart3 size={24} />
                        <h2 className="text-xl font-bold">Trade Report & History</h2>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1 hover:bg-white/20 rounded transition-colors"
                    >
                        <X size={24} />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 flex overflow-hidden">
                    {/* Sessions List */}
                    <div className="w-80 border-r flex flex-col bg-gray-50">
                        <div className="p-4 border-b bg-white">
                            <div className="flex items-center justify-between mb-2">
                                <h3 className="font-semibold text-gray-700">Saved Sessions</h3>
                                <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full font-medium">
                                    {sessions.length}
                                </span>
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto p-2">
                            {sessions.length === 0 ? (
                                <div className="text-center text-gray-500 text-sm mt-8 px-4">
                                    <BarChart3 size={48} className="mx-auto mb-3 opacity-30" />
                                    <p>No saved sessions yet.</p>
                                    <p className="mt-2 text-xs">Complete a trading session and save it to see reports here.</p>
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    {sessions.map((session) => (
                                        <div
                                            key={session.id}
                                            className={`p-3 rounded-lg border-2 cursor-pointer transition-all ${selectedSessionId === session.id
                                                ? 'bg-blue-50 border-blue-300 shadow-md'
                                                : 'bg-white border-gray-200 hover:border-blue-200 hover:shadow'
                                                }`}
                                            onClick={() => setSelectedSessionId(session.id)}
                                        >
                                            <div className="flex items-start justify-between mb-2">
                                                <div className="flex-1">
                                                    <div className="font-semibold text-gray-800 text-sm">
                                                        {session.instrument}
                                                    </div>
                                                    <div className="text-xs text-gray-500 mt-1">
                                                        {new Date(session.startDate).toLocaleDateString()}
                                                    </div>
                                                </div>
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleDeleteSession(session.id);
                                                    }}
                                                    className="p-1 hover:bg-red-100 rounded text-red-500 transition-colors"
                                                    title="Delete session"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>

                                            <div className="flex items-center justify-between text-xs">
                                                <span className="text-gray-600">{session.totalTrades} trades</span>
                                                <span className={`font-semibold ${session.totalPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                                    {session.totalPnL >= 0 ? '+' : ''}{formatCurrency(session.totalPnL)}
                                                </span>
                                            </div>

                                            <div className="mt-2 pt-2 border-t border-gray-200">
                                                <div className="flex items-center justify-between text-xs">
                                                    <span className="text-gray-500">Win Rate</span>
                                                    <span className={`font-medium ${session.winRate >= 50 ? 'text-green-600' : 'text-orange-600'}`}>
                                                        {session.winRate.toFixed(1)}%
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Session Details */}
                    <div className="flex-1 flex flex-col overflow-hidden">
                        {!selectedSession ? (
                            <div className="flex-1 flex items-center justify-center text-gray-400">
                                <div className="text-center">
                                    <Target size={64} className="mx-auto mb-4 opacity-20" />
                                    <p className="text-lg">Select a session to view details</p>
                                </div>
                            </div>
                        ) : (
                            <>
                                {/* Session Header */}
                                <div className="p-6 border-b bg-gradient-to-r from-gray-50 to-white">
                                    <div className="flex items-start justify-between mb-4">
                                        <div>
                                            <h3 className="text-2xl font-bold text-gray-800 mb-1">
                                                {selectedSession.instrument}
                                            </h3>
                                            <div className="flex items-center gap-4 text-sm text-gray-600">
                                                <div className="flex items-center gap-1">
                                                    <Calendar size={14} />
                                                    <span>{new Date(selectedSession.startDate).toLocaleDateString()}</span>
                                                </div>
                                                <span>•</span>
                                                <span>{selectedSession.totalTrades} trades</span>
                                            </div>
                                        </div>
                                        <div className="flex gap-2">
                                            <button
                                                onClick={handleExportCSV}
                                                className="flex items-center gap-2 px-3 py-1.5 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 transition-colors"
                                                title="Export as CSV"
                                            >
                                                <FileSpreadsheet size={16} />
                                                CSV
                                            </button>
                                            <button
                                                onClick={handleExportJSON}
                                                className="flex items-center gap-2 px-3 py-1.5 bg-gray-700 text-white text-sm rounded-lg hover:bg-gray-800 transition-colors"
                                                title="Export as JSON"
                                            >
                                                <FileJson size={16} />
                                                JSON
                                            </button>
                                            <button
                                                onClick={handlePrint}
                                                className="flex items-center gap-2 px-3 py-1.5 border-2 border-gray-300 text-gray-700 text-sm rounded-lg hover:bg-gray-100 transition-colors"
                                                title="Print Report"
                                            >
                                                <Printer size={16} />
                                                Print
                                            </button>
                                        </div>
                                    </div>

                                    {/* Performance Summary Cards */}
                                    {selectedSessionStats && (
                                        <div className="grid grid-cols-4 gap-4">
                                            <div className="bg-white rounded-lg p-4 border-2 border-gray-200 shadow-sm">
                                                <div className="flex items-center gap-2 text-gray-600 text-sm mb-1">
                                                    <DollarSign size={16} />
                                                    <span>Total P&L</span>
                                                </div>
                                                <div className={`text-2xl font-bold ${selectedSessionStats.totalPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                                    {selectedSessionStats.totalPnL >= 0 ? '+' : ''}{formatCurrency(selectedSessionStats.totalPnL)}
                                                </div>
                                            </div>

                                            <div className="bg-white rounded-lg p-4 border-2 border-gray-200 shadow-sm">
                                                <div className="flex items-center gap-2 text-gray-600 text-sm mb-1">
                                                    <Target size={16} />
                                                    <span>Win Rate</span>
                                                </div>
                                                <div className={`text-2xl font-bold ${selectedSessionStats.winRate >= 50 ? 'text-green-600' : 'text-orange-600'}`}>
                                                    {selectedSessionStats.winRate.toFixed(1)}%
                                                </div>
                                                <div className="text-xs text-gray-500 mt-1">
                                                    {selectedSessionStats.winningTrades}W / {selectedSessionStats.losingTrades}L
                                                </div>
                                            </div>

                                            <div className="bg-white rounded-lg p-4 border-2 border-gray-200 shadow-sm">
                                                <div className="flex items-center gap-2 text-gray-600 text-sm mb-1">
                                                    <TrendingUp size={16} />
                                                    <span>Avg Win</span>
                                                </div>
                                                <div className="text-2xl font-bold text-green-600">
                                                    {formatCurrency(selectedSessionStats.avgWin)}
                                                </div>
                                            </div>

                                            <div className="bg-white rounded-lg p-4 border-2 border-gray-200 shadow-sm">
                                                <div className="flex items-center gap-2 text-gray-600 text-sm mb-1">
                                                    <TrendingDown size={16} />
                                                    <span>Avg Loss</span>
                                                </div>
                                                <div className="text-2xl font-bold text-red-600">
                                                    {formatCurrency(selectedSessionStats.avgLoss)}
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                <div className="flex-1 overflow-auto p-6 space-y-8">
                                    {/* Positions Table */}
                                    <div>
                                        <h4 className="font-semibold text-gray-700 mb-3">Positions Summary</h4>
                                        <div className="overflow-x-auto bg-white rounded-lg border shadow-sm">
                                            <table className="w-full text-sm text-left">
                                                <thead className="bg-gray-50 text-gray-600 font-semibold border-b">
                                                    <tr>
                                                        <th className="px-4 py-3">Status</th>
                                                        <th className="px-4 py-3">Direction</th>
                                                        <th className="px-4 py-3">Entry Time</th>
                                                        <th className="px-4 py-3 text-right">Qty</th>
                                                        <th className="px-4 py-3 text-right">Avg Price</th>
                                                        <th className="px-4 py-3 text-right">P&L</th>
                                                        <th className="px-4 py-3 text-center w-10"></th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-gray-100">
                                                    {groupTradesIntoPositions(selectedSession.trades).map((pos) => (
                                                        <tr key={pos.id} className="hover:bg-gray-50 transition-colors">
                                                            <td className="px-4 py-3">
                                                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${pos.status === 'OPEN' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                                                                    {pos.status}
                                                                </span>
                                                            </td>
                                                            <td className="px-4 py-3">
                                                                <span className={`font-semibold ${pos.direction === 'LONG' ? 'text-green-600' : 'text-red-600'}`}>
                                                                    {pos.direction}
                                                                </span>
                                                            </td>
                                                            <td className="px-4 py-3 text-gray-500">
                                                                {formatTimestamp(pos.entryTime)}
                                                            </td>
                                                            <td className="px-4 py-3 text-right font-mono">
                                                                {pos.totalQuantity}
                                                            </td>
                                                            <td className="px-4 py-3 text-right font-mono">
                                                                {formatCurrency(pos.avgEntryPrice)}
                                                            </td>
                                                            <td className={`px-4 py-3 text-right font-bold ${pos.realizedPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                                                {pos.realizedPnL >= 0 ? '+' : ''}{formatCurrency(pos.realizedPnL)}
                                                            </td>
                                                            <td className="px-4 py-3 text-center">
                                                                <button
                                                                    onClick={() => handleDeletePosition(pos.id)}
                                                                    className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                                                                    title="Delete entire position"
                                                                >
                                                                    <Trash2 size={16} />
                                                                </button>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>

                                    {/* Trades Table */}
                                    <div>
                                        <h4 className="font-semibold text-gray-700 mb-3">Raw Executions</h4>
                                        <div className="overflow-x-auto">
                                            <table className="w-full text-sm">
                                                <thead className="bg-gray-100 sticky top-0">
                                                    <tr>
                                                        <th className="text-left p-3 font-semibold text-gray-700">Date/Time</th>
                                                        <th className="text-left p-3 font-semibold text-gray-700">Type</th>
                                                        <th className="text-right p-3 font-semibold text-gray-700">Price</th>
                                                        <th className="text-right p-3 font-semibold text-gray-700">Quantity</th>
                                                        <th className="text-right p-3 font-semibold text-gray-700">P&L</th>
                                                        <th className="text-center p-3 font-semibold text-gray-700 w-10"></th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-gray-100">
                                                    {selectedSession.trades.map((trade, index) => (
                                                        <tr
                                                            key={trade.id || index}
                                                            className={`border-b hover:bg-gray-50 transition-colors group ${index % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'
                                                                }`}
                                                        >
                                                            <td className="p-3 text-gray-600 whitespace-nowrap">
                                                                {formatTimestamp(trade.timestamp)}
                                                            </td>
                                                            <td className="p-3">
                                                                <span className={`px-2 py-1 rounded text-xs font-semibold ${trade.type === 'BUY'
                                                                    ? 'bg-green-100 text-green-700'
                                                                    : 'bg-red-100 text-red-700'
                                                                    }`}>
                                                                    {trade.type}
                                                                </span>
                                                            </td>
                                                            <td className="p-3 text-right font-mono text-gray-700">
                                                                {formatCurrency(trade.price)}
                                                            </td>
                                                            <td className="p-3 text-right text-gray-700">
                                                                {trade.quantity}
                                                            </td>
                                                            <td className="p-3 text-right font-semibold">
                                                                {trade.pnl !== undefined ? (
                                                                    <span className={trade.pnl >= 0 ? 'text-green-600' : 'text-red-600'}>
                                                                        {trade.pnl >= 0 ? '+' : ''}{formatCurrency(trade.pnl)}
                                                                    </span>
                                                                ) : (
                                                                    <span className="text-gray-400">-</span>
                                                                )}
                                                            </td>
                                                            <td className="p-3 text-center">
                                                                <button
                                                                    onClick={() => handleDeleteTrade(trade.id)}
                                                                    className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded transition-all transition-colors"
                                                                    title="Delete trade"
                                                                >
                                                                    <Trash2 size={16} />
                                                                </button>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
