import { useState, useEffect } from 'react';
import { useSessionStore } from '../stores/sessionStore';
import { Target, ShieldAlert, X, Check, Link as LinkIcon } from 'lucide-react';
import { formatCurrency } from '../utils/formatters';

export function TradeExitDialog() {
    const pendingRequest = useSessionStore((s) => s.pendingExitRequest);
    const resolveRequest = useSessionStore((s) => s.resolveExitRequest);
    const position = useSessionStore((s) => s.position);

    const [journalData, setJournalData] = useState({
        systemMoveAlign: 'Yes' as 'Yes' | 'No',
        myViewMoveAlign: 'Yes' as 'Yes' | 'No',
        notes: '',
        screenshotUrl: ''
    });

    useEffect(() => {
        if (pendingRequest) {
            setJournalData({
                systemMoveAlign: 'Yes',
                myViewMoveAlign: 'Yes',
                notes: '',
                screenshotUrl: ''
            });
        }
    }, [pendingRequest]);

    if (!pendingRequest) return null;

    const isTP = pendingRequest.type === 'TP';
    // For live option positions the averagePrice is the option premium, not the spot price,
    // so the spot-based formula produces a wildly wrong number. Use the broker-synced
    // unrealizedPnL instead (kept current by syncLivePositions every 3 s).
    const isLiveOption = !!(position?.liveOptionToken);
    const projectedPnL = position
        ? isLiveOption
            ? (position.unrealizedPnL || 0)
            : (pendingRequest.spotPrice - position.averagePrice) * position.quantity
        : 0;

    const handleConfirm = () => {
        resolveRequest(true, {
            systemMoveAlign: journalData.systemMoveAlign,
            myViewMoveAlign: journalData.myViewMoveAlign,
            notes: journalData.notes,
            screenshotUrl: journalData.screenshotUrl,
            // Fill other required journal fields with defaults or empty if not applicable to exit
            ltMarket: '',
            htMarket: '',
            entryPosition: '',
            llhhPivot: '',
            entrySign: '',
            systemEntryAlign: 'No',
            myViewEntryAlign: 'No',
            tradeCategory: 'System'
        });
    };

    return (
        <div className="fixed inset-0 z-[3000] flex items-center justify-end p-4 pointer-events-none">
            <div className="bg-white/95 backdrop-blur-md rounded-2xl shadow-2xl border-2 border-orange-500 w-[400px] max-w-[90vw] max-h-[90vh] flex flex-col overflow-hidden animate-in slide-in-from-right duration-300 pointer-events-auto">
                {/* Header */}
                <div className={`p-4 flex items-center gap-4 ${isTP ? 'bg-green-50' : 'bg-red-50'}`}>
                    <div className={`p-2 rounded-xl ${isTP ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>
                        {isTP ? <Target size={24} /> : <ShieldAlert size={24} />}
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-gray-800">
                            {isTP ? 'Target Reached' : 'Stop Loss Hit'}
                        </h2>
                    </div>
                    <button
                        onClick={() => resolveRequest(false)}
                        className="ml-auto p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Content */}
                <div className="p-5 overflow-y-auto flex-1 custom-scrollbar">
                    <div className="flex gap-3 mb-4">
                        <div className="flex-1 bg-gray-50 rounded-xl p-3 border border-gray-100 text-center">
                            <span className="text-gray-500 text-[10px] font-bold uppercase tracking-wider block mb-1">{isTP ? 'Target' : 'Stop Loss'}</span>
                            <div className="text-lg font-mono font-bold text-gray-700">
                                {pendingRequest.price.toFixed(2)}
                            </div>
                        </div>
                        <div className="flex-1 bg-blue-50/50 rounded-xl p-3 border border-blue-100/50 text-center">
                            <span className="text-blue-600 text-[10px] font-bold uppercase tracking-wider block mb-1">Spot Price</span>
                            <div className="text-lg font-mono font-bold text-blue-700">
                                {pendingRequest.spotPrice.toFixed(2)}
                            </div>
                        </div>
                    </div>

                    {/* P&L Section */}
                    <div className={`rounded-xl p-3 mb-4 border text-center ${projectedPnL >= 0 ? 'bg-green-50 border-green-100' : 'bg-red-50 border-red-100'}`}>
                        <span className={`text-[10px] font-bold uppercase tracking-wider ${projectedPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {projectedPnL >= 0 ? 'Profit' : 'Loss'}
                        </span>
                        <div className={`text-xl font-bold ${projectedPnL >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                            {formatCurrency(projectedPnL)}
                        </div>
                    </div>

                    {/* Alignment Metrics Capture */}
                    <div className="bg-orange-50/50 rounded-xl p-4 border border-orange-100 mb-4">
                        <h3 className="text-[11px] font-bold text-orange-800 uppercase tracking-widest mb-3 flex items-center gap-2">
                            <Check size={14} />
                            Post-Entry Move Alignment
                        </h3>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Align Move (Sys)</label>
                                <select
                                    value={journalData.systemMoveAlign}
                                    onChange={(e) => setJournalData(p => ({ ...p, systemMoveAlign: e.target.value as any }))}
                                    className="w-full bg-white border border-orange-200 rounded-lg px-3 py-1.5 text-xs focus:ring-2 focus:ring-orange-500 outline-none"
                                >
                                    <option value="Yes">Yes</option>
                                    <option value="No">No</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Align Move (View)</label>
                                <select
                                    value={journalData.myViewMoveAlign}
                                    onChange={(e) => setJournalData(p => ({ ...p, myViewMoveAlign: e.target.value as any }))}
                                    className="w-full bg-white border border-orange-200 rounded-lg px-3 py-1.5 text-xs focus:ring-2 focus:ring-orange-500 outline-none"
                                >
                                    <option value="Yes">Yes</option>
                                    <option value="No">No</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    {/* Exit Notes */}
                    <div className="mb-4">
                        <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Exit Notes</label>
                        <textarea
                            value={journalData.notes}
                            onChange={(e) => setJournalData(p => ({ ...p, notes: e.target.value }))}
                            rows={2}
                            placeholder="Reason for exit/move behavior..."
                            className="w-full bg-white border border-gray-200 rounded-xl px-4 py-2 text-xs focus:ring-2 focus:ring-orange-500 outline-none resize-none"
                        />
                    </div>

                    {/* Screenshot URL Input */}
                    <div className="mb-6">
                        <label className="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1 flex items-center justify-between">
                            <span>Screenshot URL (Manual Link)</span>
                            {journalData.screenshotUrl && <LinkIcon size={12} className="text-blue-500" />}
                        </label>
                        <input
                            type="text"
                            value={journalData.screenshotUrl}
                            onChange={(e) => setJournalData(p => ({ ...p, screenshotUrl: e.target.value }))}
                            placeholder="https://drive.google.com/..."
                            className="w-full bg-white border border-gray-200 rounded-xl px-4 py-2 text-xs focus:ring-2 focus:ring-orange-500 outline-none"
                        />
                    </div>

                    <div className="flex flex-col gap-3">
                        <button
                            onClick={handleConfirm}
                            className={`w-full py-3 rounded-xl font-bold text-white shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2 ${isTP ? 'bg-green-600 hover:bg-green-700 shadow-green-100' : 'bg-red-600 hover:bg-red-700 shadow-red-100'
                                }`}
                        >
                            Exit Trade & Save Move Align
                        </button>
                        <button
                            onClick={() => resolveRequest(false)}
                            className="w-full py-2.5 rounded-xl font-semibold text-gray-600 bg-white border-2 border-gray-100 hover:bg-gray-50 transition-all active:scale-95 text-sm"
                        >
                            Continue Playing
                        </button>
                    </div>

                    <p className="mt-4 text-center text-[10px] text-gray-400">
                        Capture move alignment and enter screenshot link before closing.
                    </p>
                </div>
            </div>
        </div>
    );
}
