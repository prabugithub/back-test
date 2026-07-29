import { useMemo, useState } from 'react';
import { ChevronRight, ChevronDown, ClipboardList, FileJson, Printer, FileSpreadsheet, Trash2, Link as LinkIcon, Eye } from 'lucide-react';
import { useSessionStore } from '../stores/sessionStore';
import { formatCurrency, formatTimestamp, formatDDMMYYYY } from '../utils/formatters';
import { groupTradesIntoPositions, calculatePerformanceStats, exitReasonBadge } from '../utils/tradeAnalysis';
import { PageNavTabs, type ActivePage } from './PageNavTabs';

interface TradeHistoryDialogProps {
    isOpen: boolean;
    onNavigate: (page: ActivePage) => void;
}

export function TradeHistoryDialog({ isOpen, onNavigate }: TradeHistoryDialogProps) {
    const trades = useSessionStore((s) => s.trades);
    const instrument = useSessionStore((s) => s.instrument);
    const deleteTrade = useSessionStore((s) => s.deleteTrade);
    const deleteTrades = useSessionStore((s) => s.deleteTrades);
    const candles = useSessionStore((s) => s.candles);
    const scrollToTime = useSessionStore((s) => s.scrollToTime);
    const highlightCandle = useSessionStore((s) => s.highlightCandle);
    const [expandedPosId, setExpandedPosId] = useState<string | null>(null);

    // Group trades and calculate stats
    const positions = useMemo(() => groupTradesIntoPositions(trades), [trades]);
    const stats = useMemo(() => calculatePerformanceStats(positions), [positions]);

    const handleExportCSV = () => {
        if (trades.length === 0) return;

        let csvContent = `TRADING SESSION ANALYSIS - ${instrument}\n`;
        csvContent += `Generated,${new Date().toLocaleString()}\n`;
        csvContent += `Start Date,${trades.length > 0 ? formatTimestamp(trades[0].timestamp) : 'N/A'}\n\n`;

        csvContent += "PERFORMANCE SUMMARY\n";
        csvContent += `Total P&L,${stats.totalPnL.toFixed(2)}\n`;
        csvContent += `Win Rate,${stats.winRate.toFixed(1)}%\n`;
        csvContent += `Winning Trades,${stats.winningTrades}\n`;
        csvContent += `Losing Trades,${stats.losingTrades}\n`;
        csvContent += `Avg Win,${stats.avgWin.toFixed(2)}\n`;
        csvContent += `Avg Loss,${stats.avgLoss.toFixed(2)}\n`;
        csvContent += `Profit Factor,${stats.profitFactor.toFixed(2)}\n\n`;

        csvContent += "POSITION SUMMARY\n";
        csvContent += "ID,Direction,Entry Date/Time,Exit Date/Time,Entry Price,Exit Price,Qty,PnL,Duration (min),SL,Target,SL Hit,TP Hit,Trend Reversed,PnL at Reversal,Exit Reason,Category,LT Market,HT Market,Entry Pos,LLHH Pivot,Entry Sign,Align E(S),Align E(V),Align M(S),Align M(V),Notes,Screenshot (E),Screenshot (M)\n";
        positions.forEach(pos => {
            const entryExec = pos.executions.find(e => e.journal?.ltMarket);
            const entryJournal = entryExec?.journal;

            const exitExec = pos.executions.find(e => e.journal?.systemMoveAlign && e.exitReason !== 'MANUAL' && e.exitReason !== undefined)
                || pos.executions.find(e => e.journal?.systemMoveAlign);
            const exitJournal = exitExec?.journal;

            // Collect and concatenate all unique notes from all executions in this position
            const combinedNotes = Array.from(new Set(pos.executions
                .map(e => e.journal?.notes?.trim())
                .filter(note => note && note.length > 0)))
                .join(" | ");

            csvContent += `${pos.id},${pos.direction},${formatTimestamp(pos.entryTime)},${pos.exitTime ? formatTimestamp(pos.exitTime) : 'OPEN'},${pos.avgEntryPrice},${pos.avgExitPrice || ''},${pos.totalQuantity},${pos.realizedPnL.toFixed(2)},${pos.durationMinutes ? pos.durationMinutes.toFixed(1) : ''},${pos.stopLoss || ''},${pos.target || ''},${pos.slHit ? 'YES' : 'NO'},${pos.tpHit ? 'YES' : 'NO'},${pos.trendReversed ? 'YES' : 'NO'},${pos.trendReversedPnL?.toFixed(2) || ''},${pos.exitReason || ''},${entryJournal?.tradeCategory || ''},${entryJournal?.ltMarket || ''},${entryJournal?.htMarket || ''},${entryJournal?.entryPosition || ''},${entryJournal?.llhhPivot || ''},${entryJournal?.entrySign || ''},${entryJournal?.systemEntryAlign || ''},${entryJournal?.myViewEntryAlign || ''},${exitJournal?.systemMoveAlign || ''},${exitJournal?.myViewMoveAlign || ''},"${(combinedNotes || '').replace(/"/g, '""')}",${entryJournal?.screenshotUrl || ''},${exitJournal?.screenshotUrl || ''}\n`;
        });

        csvContent += "\nRAW TRADE EXECUTIONS\n";
        csvContent += "Timestamp,Type,Price,Quantity,Instrument,P&L,SL,Target,SL Hit,TP Hit,Trend Reversed,PnL at Reversal,Exit Reason,Category,LT Market,HT Market,Entry Position,LLHH Pivot,Entry Sign,Align-Entry(Sys),Align-Entry(View),Align-Move(Sys),Align-Move(View),Notes,Screenshot\n";
        trades.forEach(trade => {
            csvContent += `${formatTimestamp(trade.timestamp)},${trade.type},${trade.price},${trade.quantity},${trade.instrument},${(trade.pnl || 0).toFixed(2)},${trade.stopLoss || ''},${trade.target || ''},${trade.slHit ? 'YES' : 'NO'},${trade.tpHit ? 'YES' : 'NO'},${trade.trendReversed ? 'YES' : 'NO'},${trade.trendReversedPnL?.toFixed(2) || ''},${trade.exitReason || ''},${trade.journal?.tradeCategory || ''},${trade.journal?.ltMarket || ''},${trade.journal?.htMarket || ''},${trade.journal?.entryPosition || ''},${trade.journal?.llhhPivot || ''},${trade.journal?.entrySign || ''},${trade.journal?.systemEntryAlign || ''},${trade.journal?.myViewEntryAlign || ''},${trade.journal?.systemMoveAlign || ''},${trade.journal?.myViewMoveAlign || ''},"${(trade.journal?.notes || '').replace(/"/g, '""')}",${trade.journal?.screenshotUrl || ''}\n`;
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
            trades: trades.map(t => ({ ...t, formattedDate: formatDDMMYYYY(t.timestamp) }))
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

    const handleJumpToTrade = (e: React.MouseEvent, timestamp: number) => {
        e.stopPropagation();
        // pos.entryTime / exec.timestamp come out of groupTradesIntoPositions already
        // normalized to milliseconds (tradeAnalysis.ts's normalizeTs), but candle
        // timestamps are Unix seconds (lightweight-charts UTCTimestamp) — convert back
        // before comparing, or every lookup below silently falls through to the last candle.
        const targetTs = timestamp > 1e11 ? Math.floor(timestamp / 1000) : timestamp;
        // The trade timestamp might be slightly ahead or behind candle timestamps due to formatting
        // We find the candle that is closest to this timestamp (at or before)
        const index = candles.findIndex(c => c.timestamp === targetTs);
        if (index !== -1) {
            // Pan the chart to this candle without touching currentIndex — jumping to an
            // entry must not rewind playback and hide every candle revealed after it.
            scrollToTime(candles[index].timestamp);
            highlightCandle(candles[index].timestamp);
            onNavigate('chart'); // Switch to the chart page to show it
        } else {
            // Find the closest candle if exact match not found
            let closestIndex = -1;
            for (let i = 0; i < candles.length; i++) {
                if (candles[i].timestamp <= targetTs) {
                    closestIndex = i;
                } else {
                    break;
                }
            }
            if (closestIndex !== -1) {
                scrollToTime(candles[closestIndex].timestamp);
                highlightCandle(candles[closestIndex].timestamp);
                onNavigate('chart');
            }
        }
    };

    const handleDeletePosition = (e: React.MouseEvent, pos: any) => {
        e.stopPropagation();
        if (confirm(`Delete entire ${pos.status} ${pos.direction} position and all its ${pos.executions.length} trades?`)) {
            const ids = pos.executions.map((ex: any) => ex.id);
            deleteTrades(ids);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="absolute inset-0 z-[105] bg-slate-50 flex flex-col overflow-hidden font-sans">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-slate-200 shrink-0">
                <div className="flex items-center gap-4">
                    <PageNavTabs active="tradeLog" onNavigate={onNavigate} />
                    <div className="w-px h-6 bg-slate-200 hidden md:block" />
                    <div className="bg-blue-600 p-2 rounded-xl text-white shadow-lg shadow-blue-200 hidden md:block">
                        <ClipboardList size={20} />
                    </div>
                    <div className="hidden md:block">
                        <h2 className="text-xl font-bold text-slate-800 tracking-tight">Trade Log &amp; Analysis</h2>
                        <p className="text-slate-500 text-xs font-medium">Positions and executions for the current session</p>
                    </div>
                </div>
                <div className="flex gap-2">
                    <button
                        onClick={handleExportCSV}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 bg-green-50 text-green-700 border border-green-200 text-xs font-semibold rounded-lg hover:bg-green-100 transition-colors"
                        title="Export as CSV"
                    >
                        <FileSpreadsheet size={14} />
                        CSV
                    </button>
                    <button
                        onClick={handleExportJSON}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-50 text-slate-700 border border-slate-200 text-xs font-semibold rounded-lg hover:bg-slate-100 transition-colors"
                        title="Export as JSON"
                    >
                        <FileJson size={14} />
                        JSON
                    </button>
                    <button
                        onClick={handlePrint}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 bg-white text-slate-700 border border-slate-200 text-xs font-semibold rounded-lg hover:bg-slate-50 transition-colors"
                        title="Print Report"
                    >
                        <Printer size={14} />
                        Print
                    </button>
                </div>
            </div>

            {/* content */}
            <div className="flex-1 flex flex-col overflow-auto p-6">

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
                    <div className="bg-white rounded-lg shadow-sm border flex-1 overflow-auto">
                        <table className="w-full text-sm text-left border-collapse" style={{ minWidth: '1100px' }}>
                            <thead className="bg-gray-50 text-gray-600 font-semibold border-b sticky top-0 z-10">
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
                                    <th className="px-4 py-3 text-center">Trend Rev</th>
                                    <th className="px-4 py-3 text-right">PnL @ Rev</th>
                                    <th className="px-4 py-3 text-right">P&L</th>
                                    <th className="px-4 py-3 text-right">Duration</th>
                                    <th className="px-4 py-3 text-center w-8">View</th>
                                    <th className="px-4 py-3 text-center w-10"></th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {positions.length === 0 ? (
                                    <tr>
                                        <td colSpan={13} className="px-4 py-8 text-center text-gray-500">
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
                                                        {pos.exitReason && pos.exitReason !== 'MANUAL' && (
                                                            <span className={`ml-1 px-1 py-0.5 rounded text-[8px] font-bold ${exitReasonBadge(pos.exitReason).cls}`}>
                                                                {exitReasonBadge(pos.exitReason).label}{(pos.exitReason === 'TP' || pos.exitReason === 'SL') ? ' HIT' : ''}
                                                            </span>
                                                        )}
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
                                                    <td className="px-4 py-3 text-center">
                                                        {pos.trendReversed ? (
                                                            <span className="px-1.5 py-0.5 rounded text-[10px] bg-orange-100 text-orange-700 font-bold uppercase">Rev</span>
                                                        ) : (
                                                            <span className="text-gray-300">-</span>
                                                        )}
                                                    </td>
                                                    <td className={`px-4 py-3 text-right font-mono text-[10px] ${pos.trendReversedPnL !== undefined ? (pos.trendReversedPnL >= 0 ? 'text-green-600' : 'text-red-500') : 'text-gray-400'}`}>
                                                        {pos.trendReversedPnL !== undefined ? formatCurrency(pos.trendReversedPnL) : '-'}
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
                                                            onClick={(e) => handleJumpToTrade(e, pos.entryTime)}
                                                            className="p-1.5 text-blue-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                                                            title="Jump to entry on chart"
                                                        >
                                                            <Eye size={16} />
                                                        </button>
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
                                                    <tr className="bg-gray-50 border-b">
                                                        <td colSpan={13} className="px-4 py-3 pl-12">
                                                            <div className="border rounded bg-white overflow-hidden text-xs">
                                                                <table className="w-full">
                                                                    <thead className="bg-gray-100 text-gray-500">
                                                                        <tr>
                                                                            <th className="px-3 py-2 text-left">Exec Date/Time</th>
                                                                            <th className="px-3 py-2 text-left">Type</th>
                                                                            <th className="px-3 py-2 text-right">Price</th>
                                                                            <th className="px-3 py-2 text-right">Qty</th>
                                                                            <th className="px-3 py-2 text-right">Info</th>
                                                                            <th className="px-3 py-2 text-left">Category</th>
                                                                            <th className="px-3 py-2 text-left">LT/HT Market</th>
                                                                            <th className="px-3 py-2 text-left">Entry Pos/LLHH</th>
                                                                            <th className="px-3 py-2 text-left">Entry Sign</th>
                                                                            <th className="px-3 py-2 text-left">Align (Sys/View)</th>
                                                                            <th className="px-3 py-2 text-left max-w-[100px]">Notes</th>
                                                                            <th className="px-3 py-2 text-center">Img</th>
                                                                            <th className="px-3 py-2 text-center">Trend Rev</th>
                                                                            <th className="px-3 py-2 text-right">PnL @ Rev</th>
                                                                            <th className="px-3 py-2 text-right">Realized P&L</th>
                                                                            <th className="px-3 py-2 text-center w-8">View</th>
                                                                            <th className="px-3 py-2 text-center w-10"></th>
                                                                        </tr>
                                                                    </thead>
                                                                    <tbody className="divide-y divide-gray-100">
                                                                        {pos.executions.map((exec, idx) => (
                                                                            <tr key={exec.id || idx} className="hover:bg-gray-50/80 group">
                                                                                <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{formatTimestamp(exec.timestamp)}</td>
                                                                                <td className={`px-3 py-2 font-semibold ${exec.type === 'BUY' ? 'text-green-600' : 'text-red-600'}`}>
                                                                                    {exec.type}{exec.optionType ? ` ${exec.optionType}` : ''}
                                                                                </td>
                                                                                <td className="px-3 py-2 text-right font-mono text-[10px]">{formatCurrency(exec.price)}</td>
                                                                                <td className="px-3 py-2 text-right font-mono text-[10px]">{exec.quantity}</td>
                                                                                <td className="px-3 py-2 text-right">
                                                                                    {exec.exitReason && exec.exitReason !== 'MANUAL' && (
                                                                                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${exitReasonBadge(exec.exitReason).cls}`}>
                                                                                            {exitReasonBadge(exec.exitReason).label}
                                                                                        </span>
                                                                                    )}
                                                                                </td>
                                                                                <td className="px-3 py-2 text-left text-[10px]">
                                                                                    {exec.journal ? (
                                                                                        <span className={`font-bold ${exec.journal.tradeCategory === 'System' ? 'text-blue-600' : 'text-purple-600'}`}>
                                                                                            {exec.journal.tradeCategory}
                                                                                        </span>
                                                                                    ) : '-'}
                                                                                </td>
                                                                                <td className="px-3 py-2 text-left text-[10px] text-gray-500">
                                                                                    {exec.journal ? (
                                                                                        <div>
                                                                                            <div className="font-semibold text-gray-700">{exec.journal.ltMarket}</div>
                                                                                            <div className="text-gray-400 text-[9px]">{exec.journal.htMarket}</div>
                                                                                        </div>
                                                                                    ) : '-'}
                                                                                </td>
                                                                                <td className="px-3 py-2 text-left text-[10px] text-gray-500">
                                                                                    {exec.journal ? (
                                                                                        <div>
                                                                                            <div className="font-semibold text-gray-700">{exec.journal.entryPosition}</div>
                                                                                            <div className="text-gray-400 text-[9px]">{exec.journal.llhhPivot}</div>
                                                                                        </div>
                                                                                    ) : '-'}
                                                                                </td>
                                                                                <td className="px-3 py-2 text-left text-[10px] text-gray-500">
                                                                                    {exec.journal?.entrySign || '-'}
                                                                                </td>
                                                                                <td className="px-3 py-2 text-left text-[10px]">
                                                                                    {exec.journal ? (
                                                                                        <div className="flex flex-col gap-0.5">
                                                                                            <div className="flex gap-1 text-[9px]">
                                                                                                <span className="text-gray-400">E:</span>
                                                                                                <span className={`font-bold ${exec.journal.systemEntryAlign === 'Yes' ? 'text-green-600' : 'text-red-500'}`}>S:{exec.journal.systemEntryAlign?.[0]}</span>
                                                                                                <span className={`font-bold ${exec.journal.myViewEntryAlign === 'Yes' ? 'text-green-600' : 'text-red-500'}`}>V:{exec.journal.myViewEntryAlign?.[0]}</span>
                                                                                            </div>
                                                                                            <div className="flex gap-1 text-[9px]">
                                                                                                <span className="text-gray-400">M:</span>
                                                                                                <span className={`font-bold ${exec.journal.systemMoveAlign === 'Yes' ? 'text-green-600' : 'text-red-500'}`}>S:{exec.journal.systemMoveAlign?.[0]}</span>
                                                                                                <span className={`font-bold ${exec.journal.myViewMoveAlign === 'Yes' ? 'text-green-600' : 'text-red-500'}`}>V:{exec.journal.myViewMoveAlign?.[0]}</span>
                                                                                            </div>
                                                                                        </div>
                                                                                    ) : '-'}
                                                                                </td>
                                                                                <td className="px-3 py-2 text-left text-[10px] text-gray-500 truncate max-w-[100px]" title={exec.journal?.notes}>
                                                                                    {exec.journal?.notes || '-'}
                                                                                </td>
                                                                                <td className="px-3 py-2 text-center text-[10px]">
                                                                                    {exec.journal?.screenshotUrl ? (
                                                                                        <a
                                                                                            href={exec.journal.screenshotUrl}
                                                                                            target="_blank"
                                                                                            rel="noopener noreferrer"
                                                                                            className="text-blue-500 hover:text-blue-700 flex items-center justify-center p-1 hover:bg-blue-50 rounded transition-colors"
                                                                                            title="View screenshot"
                                                                                            onClick={(e) => e.stopPropagation()}
                                                                                        >
                                                                                            <LinkIcon size={14} />
                                                                                        </a>
                                                                                    ) : '-'}
                                                                                </td>
                                                                                <td className="px-3 py-2 text-center">
                                                                                    {exec.trendReversed ? (
                                                                                        <span className="px-1.5 py-0.5 rounded text-[9px] bg-orange-50 text-orange-600 font-bold uppercase">Rev</span>
                                                                                    ) : '-'}
                                                                                </td>
                                                                                <td className={`px-3 py-2 text-right font-mono text-[9px] ${exec.trendReversedPnL !== undefined ? (exec.trendReversedPnL >= 0 ? 'text-green-600' : 'text-red-500') : 'text-gray-400'}`}>
                                                                                    {exec.trendReversedPnL !== undefined ? formatCurrency(exec.trendReversedPnL) : '-'}
                                                                                </td>
                                                                                <td className="px-3 py-2 text-right font-mono text-gray-500 text-[10px]">
                                                                                    {exec.pnl ? formatCurrency(exec.pnl) : '-'}
                                                                                </td>
                                                                                <td className="px-3 py-2 text-center">
                                                                                    <button
                                                                                        onClick={(e) => handleJumpToTrade(e, exec.timestamp)}
                                                                                        className="p-1 text-blue-400 hover:text-blue-600 transition-colors"
                                                                                        title="Jump to this execution on chart"
                                                                                    >
                                                                                        <Eye size={14} />
                                                                                    </button>
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
    );
}


