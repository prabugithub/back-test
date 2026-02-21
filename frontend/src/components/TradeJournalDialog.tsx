import { useState, useEffect } from 'react';
import { useSessionStore } from '../stores/sessionStore';
import { Info, X, Check, Link as LinkIcon } from 'lucide-react';
import type { TradeJournal } from '../types';
import { analyzePivotForTrade } from '../utils/pivotAnalysis';
import { calculateAlBrooks } from '../utils/indicators';

export function TradeJournalDialog() {
    const pendingTradeRequest = useSessionStore((s) => s.pendingTradeRequest);
    const resolveTradeRequest = useSessionStore((s) => s.resolveTradeRequest);
    const position = useSessionStore((s) => s.position);
    const isExitTrade = pendingTradeRequest && position
        ? (position.quantity > 0 && pendingTradeRequest.type === 'SELL') ||
        (position.quantity < 0 && pendingTradeRequest.type === 'BUY')
        : false;

    const candles = useSessionStore((s) => s.candles);
    const currentIndex = useSessionStore((s) => s.currentIndex);

    const [journal, setJournal] = useState<TradeJournal>({
        ltMarket: 'Trend',
        htMarket: 'Trend',
        pivotPosition: 'gap',
        llhhPivot: 'HH-HL',
        entrySign: 'None',
        notes: '',
        systemEntryAlign: 'Yes',
        myViewEntryAlign: 'Yes',
        systemMoveAlign: 'Yes',
        myViewMoveAlign: 'Yes',
        tradeCategory: 'System',
        screenshotUrl: ''
    });

    const [exitReason, setExitReason] = useState<'MANUAL' | 'TIME_OVER'>('MANUAL');

    // Reset state when a new request comes in
    useEffect(() => {
        if (pendingTradeRequest) {
            // Automatically analyze pivot and market structure for entry trades
            let autoPivotPosition = 'gap';
            let autoLlhhPivot = 'HH-HL';
            let autoLtMarket = 'Range';
            let autoHtMarket = 'Range';

            // Automatically analyze Al Brooks signals for entrySign
            let autoEntrySign: string = 'None';
            if (!isExitTrade && candles.length > 0 && currentIndex >= 0) {
                // 1. Pivot & Market Analysis
                const pivotAnalysis = analyzePivotForTrade(candles, currentIndex, pendingTradeRequest.type);
                if (pivotAnalysis.pivotPosition) {
                    autoPivotPosition = pivotAnalysis.pivotPosition;
                }
                if (pivotAnalysis.llhhPivot) {
                    autoLlhhPivot = pivotAnalysis.llhhPivot;
                }
                if (pivotAnalysis.ltMarket) {
                    autoLtMarket = pivotAnalysis.ltMarket;
                }
                if (pivotAnalysis.htMarket) {
                    autoHtMarket = pivotAnalysis.htMarket;
                }

                // 2. Al Brooks Signal Analysis
                const visibleCandles = candles.slice(0, currentIndex + 1);
                const useAtrForSignals = useSessionStore.getState().useAtrForSignals;
                const alBrooksSignals = calculateAlBrooks(visibleCandles, useAtrForSignals, 1.0);

                // Check current and previous bar for signals
                const currentCandle = candles[currentIndex];
                const prevCandle = currentIndex > 0 ? candles[currentIndex - 1] : null;

                const currentSignal = alBrooksSignals.find(s => s.time === currentCandle.timestamp);
                const prevSignal = prevCandle ? alBrooksSignals.find(s => s.time === prevCandle.timestamp) : null;

                // Prioritize current bar, then previous
                const activeSignal = currentSignal || prevSignal;

                if (activeSignal) {
                    const signalName = activeSignal.signal; // H1, H2, H3, L1, L2, L3
                    const tradeType = pendingTradeRequest.type; // BUY or SELL

                    const isLong = tradeType === 'BUY';
                    const isH = signalName.startsWith('H');
                    const num = signalName.substring(1); // 1, 2, or 3

                    // Normal trend entries
                    if ((isLong && isH) || (!isLong && !isH)) {
                        autoEntrySign = `H${num}/L${num}`;
                    }
                    // Reverse entries
                    else {
                        autoEntrySign = `Reverse-H${num}/L${num}`;
                    }
                }
            }

            setJournal({
                ltMarket: autoLtMarket,
                htMarket: autoHtMarket,
                pivotPosition: autoPivotPosition,
                llhhPivot: autoLlhhPivot,
                entrySign: autoEntrySign,
                notes: '',
                systemEntryAlign: 'Yes',
                myViewEntryAlign: 'Yes',
                systemMoveAlign: 'Yes',
                myViewMoveAlign: 'Yes',
                tradeCategory: 'System',
                screenshotUrl: ''
            });
            setExitReason('MANUAL');
        }
    }, [pendingTradeRequest, isExitTrade, candles, currentIndex]);

    if (!pendingTradeRequest) return null;

    const handleConfirm = () => {
        resolveTradeRequest(journal, isExitTrade ? exitReason : 'MANUAL');
    };

    const handleCancel = () => {
        resolveTradeRequest(null);
    };

    const handleChange = (e: React.ChangeEvent<HTMLSelectElement | HTMLTextAreaElement | HTMLInputElement>) => {
        const { name, value } = e.target;
        setJournal((prev) => ({ ...prev, [name]: value as any }));
    };

    return (
        <div className="fixed inset-0 z-[3000] flex items-center justify-end p-4 pointer-events-none">
            <div className={`bg-white/95 backdrop-blur-md border-2 ${isExitTrade ? 'border-orange-500' : 'border-blue-500'} rounded-xl shadow-2xl w-[400px] overflow-hidden animate-in slide-in-from-right duration-300 pointer-events-auto`}>
                {/* Header */}
                <div className={`bg-gradient-to-r ${isExitTrade ? 'from-orange-600 to-red-600' : 'from-blue-600 to-indigo-600'} px-4 py-3 text-white flex justify-between items-center`}>
                    <div className="flex items-center gap-2">
                        <Info size={18} />
                        <h2 className="text-lg font-bold tracking-tight">
                            {isExitTrade ? 'Trade Exit Journal' : 'Trade Entry Journal'}
                        </h2>
                    </div>
                    <button
                        onClick={handleCancel}
                        className="p-1 hover:bg-white/20 rounded-full transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                <div className="p-4 max-h-[90vh] overflow-y-auto custom-scrollbar">
                    <div className="mb-4 bg-gray-50 p-2 rounded-lg border border-gray-100 flex justify-between items-center text-xs">
                        <div>
                            <span className="font-semibold text-gray-900 uppercase">Action: </span>
                            <span className={`font-bold ${pendingTradeRequest.type === 'BUY' ? 'text-green-600' : 'text-red-600'}`}>
                                {pendingTradeRequest.type} {pendingTradeRequest.quantity}
                            </span>
                        </div>
                    </div>

                    {!isExitTrade ? (

                        /* ENTRY FIELDS */
                        <div className="space-y-3">
                            <div>
                                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">LT Market Structure</label>
                                <select
                                    name="ltMarket"
                                    value={journal.ltMarket}
                                    onChange={handleChange}
                                    className="w-full bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-xs focus:ring-2 focus:ring-blue-500 outline-none"
                                >
                                    <option value="Bull-Trend">Bull Trend</option>
                                    <option value="Range">Range</option>
                                    <option value="Bear-Trend">Bear Trend</option>
                                    <option value="Bear-Reversal">Bear Reversal</option>
                                    <option value="Bull-Reversal">Bull Reversal</option>
                                    <option value="Bear-Trending-range">Bear Trending range</option>
                                    <option value="Bull-Trending-range">Bull Trending range</option>
                                </select>
                            </div>

                            <div>
                                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">HT Market Structure</label>
                                <select
                                    name="htMarket"
                                    value={journal.htMarket}
                                    onChange={handleChange}
                                    className="w-full bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-xs focus:ring-2 focus:ring-blue-500 outline-none"
                                >
                                    <option value="Bull-Trend">Bull Trend</option>
                                    <option value="Range">Range</option>
                                    <option value="Bear-Trend">Bear Trend</option>
                                    <option value="Bear-Reversal">Bear Reversal</option>
                                    <option value="Bull-Reversal">Bull Reversal</option>
                                    <option value="Bear-Trending-range">Bear Trending range</option>
                                    <option value="Bull-Trending-range">Bull Trending range</option>
                                </select>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">
                                        PivotPosition <span className="text-green-600 text-[8px]">●AUTO</span>
                                    </label>
                                    <select
                                        name="pivotPosition"
                                        value={journal.pivotPosition}
                                        onChange={handleChange}
                                        disabled
                                        className="w-full bg-gray-100 border border-gray-300 rounded-lg px-3 py-1.5 text-xs outline-none cursor-not-allowed opacity-75"
                                    >
                                        <option value="gap">Gap</option>
                                        <option value="on-MA">On-MA</option>
                                        <option value="gap-opposite">Gap-Opposite</option>
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">
                                        LLHH-Pivot <span className="text-green-600 text-[8px]">●AUTO</span>
                                    </label>
                                    <select
                                        name="llhhPivot"
                                        value={journal.llhhPivot}
                                        onChange={handleChange}
                                        disabled
                                        className="w-full bg-gray-100 border border-gray-300 rounded-lg px-3 py-1.5 text-xs outline-none cursor-not-allowed opacity-75"
                                    >
                                        <option value="HH-HL">HH-HL</option>
                                        <option value="HH-LL">HH-LL</option>
                                        <option value="LH-HL">LH-HL</option>
                                        <option value="LH-LL">LH-LL</option>
                                    </select>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Category</label>
                                    <select
                                        name="tradeCategory"
                                        value={journal.tradeCategory}
                                        onChange={handleChange}
                                        className="w-full bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-xs font-bold text-blue-700 focus:ring-2 focus:ring-blue-500 outline-none"
                                    >
                                        <option value="System">System</option>
                                        <option value="Discretionary">Discretionary</option>
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Entry-Sign</label>
                                    <select
                                        name="entrySign"
                                        value={journal.entrySign}
                                        onChange={handleChange}
                                        className="w-full bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-xs focus:ring-2 focus:ring-blue-500 outline-none"
                                    >
                                        <option value="None">None</option>
                                        <option value="H1/L1">H1/L1</option>
                                        <option value="H2/L2">H2/L2</option>
                                        <option value="H3/L3">H3/L3</option>
                                        <option value="Reverse-H1/L1">Reverse-H1/L1</option>
                                        <option value="Reverse-H2/L2">Reverse-H2/L2</option>
                                        <option value="Reverse-H3/L3">Reverse-H3/L3</option>
                                        <option value="BO">BO</option>
                                        <option value="BO-Fail">BO-Fail</option>
                                    </select>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3 bg-blue-50 p-2 rounded-lg border border-blue-100">
                                <div>
                                    <label className="block text-[10px] font-bold text-blue-800 tracking-wider mb-1 uppercase">Align E (Sys)</label>
                                    <select
                                        name="systemEntryAlign"
                                        value={journal.systemEntryAlign}
                                        onChange={handleChange}
                                        className="w-full bg-white border border-blue-200 rounded-lg px-2 py-1.5 text-xs outline-none"
                                    >
                                        <option value="Yes">Yes</option>
                                        <option value="No">No</option>
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-[10px] font-bold text-blue-800 tracking-wider mb-1 uppercase">Align E (View)</label>
                                    <select
                                        name="myViewEntryAlign"
                                        value={journal.myViewEntryAlign}
                                        onChange={handleChange}
                                        className="w-full bg-white border border-blue-200 rounded-lg px-2 py-1.5 text-xs outline-none"
                                    >
                                        <option value="Yes">Yes</option>
                                        <option value="No">No</option>
                                    </select>
                                </div>
                            </div>
                        </div>
                    ) : (
                        /* EXIT FIELDS */
                        <div className="space-y-4">
                            <div>
                                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Exit Reason</label>
                                <select
                                    value={exitReason}
                                    onChange={(e) => setExitReason(e.target.value as any)}
                                    className="w-full bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-xs focus:ring-2 focus:ring-blue-500 outline-none"
                                >
                                    <option value="MANUAL">Manual Decision</option>
                                    <option value="TIME_OVER">Time Over</option>
                                </select>
                            </div>

                            <div className="bg-orange-50 p-3 rounded-lg border border-orange-100">
                                <h3 className="text-[11px] font-bold text-orange-800 uppercase tracking-widest mb-3 flex items-center gap-2">
                                    <Check size={14} />
                                    Post-Entry Move Alignment
                                </h3>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-[10px] font-bold text-orange-700 uppercase mb-1">Align M (Sys)</label>
                                        <select
                                            name="systemMoveAlign"
                                            value={journal.systemMoveAlign}
                                            onChange={handleChange}
                                            className="w-full bg-white border border-orange-200 rounded-lg px-3 py-1.5 text-xs focus:ring-2 focus:ring-orange-500 outline-none"
                                        >
                                            <option value="Yes">Yes</option>
                                            <option value="No">No</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-bold text-orange-700 uppercase mb-1">Align M (View)</label>
                                        <select
                                            name="myViewMoveAlign"
                                            value={journal.myViewMoveAlign}
                                            onChange={handleChange}
                                            className="w-full bg-white border border-orange-200 rounded-lg px-3 py-1.5 text-xs focus:ring-2 focus:ring-orange-500 outline-none"
                                        >
                                            <option value="Yes">Yes</option>
                                            <option value="No">No</option>
                                        </select>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Notes (Common) */}
                    <div className="mt-4">
                        <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Notes</label>
                        <textarea
                            name="notes"
                            value={journal.notes}
                            onChange={handleChange}
                            rows={2}
                            placeholder="Reasoning..."
                            className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-blue-500 outline-none resize-none"
                        />
                    </div>

                    {/* Screenshot URL (Exit Only) */}
                    {isExitTrade && (
                        <div className="mt-4">
                            <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1 flex items-center gap-1">
                                <LinkIcon size={12} />
                                Screenshot URL (Optional)
                            </label>
                            <input
                                type="text"
                                name="screenshotUrl"
                                value={journal.screenshotUrl}
                                onChange={handleChange}
                                placeholder="Paste screenshot URL here..."
                                className="w-full bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-xs focus:ring-2 focus:ring-orange-500 outline-none"
                            />
                        </div>
                    )}

                    {/* Footer Buttons */}
                    <div className="mt-6 flex gap-3">
                        <button
                            onClick={handleCancel}
                            className="flex-1 px-4 py-2 border border-gray-200 text-gray-600 rounded-lg font-bold hover:bg-gray-50 transition-colors uppercase tracking-widest text-[10px]"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleConfirm}
                            className={`flex-1 px-4 py-2 ${isExitTrade ? 'bg-gradient-to-r from-orange-600 to-red-600' : 'bg-gradient-to-r from-green-600 to-emerald-600'} text-white rounded-lg font-bold transition-all shadow-md flex items-center justify-center gap-2 uppercase tracking-widest text-[10px] hover:scale-[1.02]`}
                        >
                            <Check size={14} />
                            Confirm
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
