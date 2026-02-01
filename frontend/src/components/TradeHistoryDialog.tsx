import { useRef, useEffect, useMemo, useState } from 'react';
import { X, ChevronRight, ChevronDown, FileJson, Printer, FileSpreadsheet, Trash2 } from 'lucide-react';
import { useSessionStore } from '../stores/sessionStore';
import { formatCurrency, formatTimestamp } from '../utils/formatters';
import { groupTradesIntoPositions, calculatePerformanceStats } from '../utils/tradeAnalysis';

interface TradeHistoryDialogProps {
    isOpen: boolean;
    onClose: () => void;
}

export function TradeHistoryDialog({ isOpen, onClose }: TradeHistoryDialogProps) {
    const trades = useSessionStore((s) => s.trades);
    const instrument = useSessionStore((s) => s.instrument);
    const deleteTrade = useSessionStore((s) => s.deleteTrade);
    const deleteTrades = useSessionStore((s) => s.deleteTrades);
    const dialogRef = useRef<HTMLDivElement>(null);
    const [expandedPosId, setExpandedPosId] = useState<string | null>(null);

    // Drag state
    const [offset, setOffset] = useState<{ x: number, y: number } | null>(null);
    const isDragging = useRef(false);
    const dragStart = useRef({ x: 0, y: 0 });
    const startOffset = useRef({ x: 0, y: 0 });

    // Group trades and calculate stats
    const positions = useMemo(() => groupTradesIntoPositions(trades), [trades]);
    const stats = useMemo(() => calculatePerformanceStats(positions), [positions]);

    const handleExportCSV = () => {
        if (trades.length === 0) return;

        let csvContent = `TRADING SESSION ANALYSIS - ${instrument}\n`;
        csvContent += `Generated,${new Date().toLocaleString()}\n`;
        csvContent += `Start Date,${trades.length > 0 ? new Date(trades[0].timestamp * 1000).toLocaleString() : 'N/A'}\n\n`;

        csvContent += "PERFORMANCE SUMMARY\n";
        csvContent += `Total P&L,${stats.totalPnL.toFixed(2)}\n`;
        csvContent += `Win Rate,${stats.winRate.toFixed(1)}%\n`;
        csvContent += `Winning Trades,${stats.winningTrades}\n`;
        csvContent += `Losing Trades,${stats.losingTrades}\n`;
        csvContent += `Avg Win,${stats.avgWin.toFixed(2)}\n`;
        csvContent += `Avg Loss,${stats.avgLoss.toFixed(2)}\n`;
        csvContent += `Profit Factor,${stats.profitFactor.toFixed(2)}\n\n`;

        csvContent += "POSITION SUMMARY\n";
        csvContent += "ID,Direction,Entry Date/Time,Exit Date/Time,Entry Price,Exit Price,Qty,PnL,Duration (min)\n";
        positions.forEach(p => {
            csvContent += `${p.id},${p.direction},${formatTimestamp(p.entryTime)},${p.exitTime ? formatTimestamp(p.exitTime) : 'OPEN'},${p.avgEntryPrice},${p.avgExitPrice || ''},${p.totalQuantity},${p.realizedPnL.toFixed(2)},${p.durationMinutes ? p.durationMinutes.toFixed(1) : ''}\n`;
        });

        csvContent += "\nRAW TRADE EXECUTIONS\n";
        csvContent += "Timestamp,Type,Price,Quantity,Instrument,P&L\n";
        trades.forEach(trade => {
            csvContent += `${new Date(trade.timestamp * 1000).toISOString()},${trade.type},${trade.price},${trade.quantity},${trade.instrument},${(trade.pnl || 0).toFixed(2)}\n`;
        });

        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `active-analysis-${instrument}-${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleExportJSON = () => {
        if (trades.length === 0) return;

        const reportData = {
            metadata: {
                instrument: instrument,
                generatedAt: new Date().toISOString(),
                isLiveSession: true
            },
            performance: stats,
            positions: positions,
            trades: trades
        };

        const blob = new Blob([JSON.stringify(reportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `active-analysis-${instrument}-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const handlePrint = () => {
        window.print();
    };

    const handleDeleteTrade = (e: React.MouseEvent, tradeId: string) => {
        e.stopPropagation();
        if (confirm('Delete this trade? Position metrics will be recalculated.')) {
            deleteTrade(tradeId);
        }
    };

    const handleDeletePosition = (e: React.MouseEvent, pos: any) => {
        e.stopPropagation();
        if (confirm(`Delete entire ${pos.status} ${pos.direction} position and all its ${pos.executions.length} trades?`)) {
            const ids = pos.executions.map((ex: any) => ex.id);
            deleteTrades(ids);
        }
    };

    const handleMouseDown = (e: React.MouseEvent) => {
        // Only allow dragging from the header
        if ((e.target as HTMLElement).closest('.dialog-header')) {
            isDragging.current = true;
            dragStart.current = { x: e.clientX, y: e.clientY };

            const rect = dialogRef.current?.getBoundingClientRect();
            if (rect) {
                if (!offset) {
                    startOffset.current = { x: rect.left, y: rect.top };
                    setOffset({ x: rect.left, y: rect.top });
                } else {
                    startOffset.current = { x: offset.x, y: offset.y };
                }
            }
        }
    };

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isDragging.current) return;

            const dx = e.clientX - dragStart.current.x;
            const dy = e.clientY - dragStart.current.y;

            setOffset({
                x: startOffset.current.x + dx,
                y: startOffset.current.y + dy
            });
        };

        const handleMouseUp = () => {
            isDragging.current = false;
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, []);

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

    // Style object: use offset if dragged, otherwise centered
    const dialogStyle: React.CSSProperties = offset ? {
        left: `${offset.x}px`,
        top: `${offset.y}px`,
        position: 'fixed' as const,
        margin: 0,
        width: '1200px',
        maxWidth: '90vw',
        height: '85vh',
        maxHeight: '85vh'
    } : {
        width: '1200px',
        maxWidth: '90vw',
        height: '85vh',
        maxHeight: '85vh'
    };

    return (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black bg-opacity-60">
            <div
                ref={dialogRef}
                onMouseDown={handleMouseDown}
                className="bg-white rounded-lg shadow-2xl flex flex-col overflow-hidden border-2 border-gray-300"
                style={dialogStyle}
            >
                {/* Header */}
                <div className="dialog-header flex items-center justify-between px-4 py-3 border-b-2 border-gray-200 cursor-move select-none bg-gradient-to-r from-blue-50 to-indigo-50">
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                            <h2 className="text-lg font-bold text-gray-800">Trade Analysis</h2>
                        </div>
                        <div className="h-6 w-px bg-gray-300 mx-2 hidden md:block"></div>
                        <div className="flex gap-2" onMouseDown={(e) => e.stopPropagation()}>
                            <button
                                onClick={handleExportCSV}
                                className="flex items-center gap-1.5 px-2.5 py-1 bg-green-50 text-green-700 border border-green-200 text-xs font-semibold rounded hover:bg-green-100 transition-colors"
                                title="Export as CSV"
                            >
                                <FileSpreadsheet size={14} />
                                CSV
                            </button>
                            <button
                                onClick={handleExportJSON}
                                className="flex items-center gap-1.5 px-2.5 py-1 bg-gray-50 text-gray-700 border border-gray-200 text-xs font-semibold rounded hover:bg-gray-100 transition-colors"
                                title="Export as JSON"
                            >
                                <FileJson size={14} />
                                JSON
                            </button>
                            <button
                                onClick={handlePrint}
                                className="flex items-center gap-1.5 px-2.5 py-1 bg-white text-gray-700 border border-gray-200 text-xs font-semibold rounded hover:bg-gray-50 transition-colors"
                                title="Print Report"
                            >
                                <Printer size={14} />
                                Print
                            </button>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1.5 hover:bg-red-100 rounded-md text-gray-600 hover:text-red-600 transition-colors"
                        onMouseDown={(e) => e.stopPropagation()}
                    >
                        <X size={20} />
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
                                    <th className="px-4 py-3">Entry Date/Time</th>
                                    <th className="px-4 py-3">Direction</th>
                                    <th className="px-4 py-3 text-right">Qty</th>
                                    <th className="px-4 py-3 text-right">Avg Entry</th>
                                    <th className="px-4 py-3 text-right">Avg Exit</th>
                                    <th className="px-4 py-3 text-right">SL</th>
                                    <th className="px-4 py-3 text-right">Target</th>
                                    <th className="px-4 py-3 text-right">P&L</th>
                                    <th className="px-4 py-3 text-right">Duration</th>
                                    <th className="px-4 py-3 text-center w-10"></th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {positions.length === 0 ? (
                                    <tr>
                                        <td colSpan={11} className="px-4 py-8 text-center text-gray-500">
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
                                                    <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                                                        {formatTimestamp(pos.entryTime)}
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
                                                    <td className="px-4 py-3 text-right font-mono text-gray-400">
                                                        {pos.stopLoss ? formatCurrency(pos.stopLoss) : '-'}
                                                    </td>
                                                    <td className="px-4 py-3 text-right font-mono text-gray-400">
                                                        {pos.target ? formatCurrency(pos.target) : '-'}
                                                    </td>
                                                    <td className={`px-4 py-3 text-right font-bold font-mono ${pos.realizedPnL > 0 ? 'text-green-600' : pos.realizedPnL < 0 ? 'text-red-600' : 'text-gray-400'
                                                        }`}>
                                                        {formatCurrency(pos.realizedPnL)}
                                                    </td>
                                                    <td className="px-4 py-3 text-right text-gray-500">
                                                        {pos.status === 'CLOSED' ? `${pos.durationMinutes?.toFixed(1)}m` : '-'}
                                                    </td>
                                                    <td className="px-4 py-3 text-center">
                                                        <button
                                                            onClick={(e) => handleDeletePosition(e, pos)}
                                                            className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                                                            title="Delete entire position"
                                                        >
                                                            <Trash2 size={16} />
                                                        </button>
                                                    </td>
                                                </tr>
                                                {/* Expanded Executions Row */}
                                                {isExpanded && (
                                                    <tr className="bg-gray-50">
                                                        <td colSpan={12} className="px-4 py-3 pl-12"> {/* colSpan updated to 12 */}
                                                            <div className="border rounded bg-white overflow-hidden text-xs">
                                                                <table className="w-full">
                                                                    <thead className="bg-gray-100 text-gray-500">
                                                                        <tr>
                                                                            <th className="px-3 py-2 text-left">Exec Date/Time</th>
                                                                            <th className="px-3 py-2 text-left">Type</th>
                                                                            <th className="px-3 py-2 text-right">Price</th>
                                                                            <th className="px-3 py-2 text-right">Qty</th>
                                                                            <th className="px-3 py-2 text-right">Realized P&L</th>
                                                                            <th className="px-3 py-2 text-center w-10"></th>
                                                                        </tr>
                                                                    </thead>
                                                                    <tbody className="divide-y divide-gray-100">
                                                                        {pos.executions.map((exec, idx) => (
                                                                            <tr key={exec.id || idx} className="hover:bg-gray-50/80 group">
                                                                                <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{formatTimestamp(exec.timestamp)}</td>
                                                                                <td className={`px-3 py-2 font-semibold ${exec.type === 'BUY' ? 'text-green-600' : 'text-red-600'}`}>
                                                                                    {exec.type}
                                                                                </td>
                                                                                <td className="px-3 py-2 text-right font-mono">{formatCurrency(exec.price)}</td>
                                                                                <td className="px-3 py-2 text-right font-mono">{exec.quantity}</td>
                                                                                <td className="px-3 py-2 text-right font-mono text-gray-500">
                                                                                    {exec.pnl ? formatCurrency(exec.pnl) : '-'}
                                                                                </td>
                                                                                <td className="px-3 py-2 text-center">
                                                                                    <button
                                                                                        onClick={(e) => handleDeleteTrade(e, exec.id)}
                                                                                        className="p-1 text-red-400 hover:text-red-600 transition-colors"
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
