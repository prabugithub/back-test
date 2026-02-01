import { useSessionStore } from '../stores/sessionStore';
import { Target, ShieldAlert, X } from 'lucide-react';
import { formatCurrency } from '../utils/formatters';

export function TradeExitDialog() {
    const pendingRequest = useSessionStore((s) => s.pendingExitRequest);
    const resolveRequest = useSessionStore((s) => s.resolveExitRequest);
    const position = useSessionStore((s) => s.position);

    if (!pendingRequest) return null;

    const isTP = pendingRequest.type === 'TP';
    const projectedPnL = position ? (pendingRequest.spotPrice - position.averagePrice) * position.quantity : 0;

    return (
        <div className="fixed inset-0 z-[3000] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-2xl border border-gray-100 w-[400px] max-w-[90vw] overflow-hidden animate-in zoom-in-95 duration-200">
                {/* Header */}
                <div className={`p-6 flex items-center gap-4 ${isTP ? 'bg-green-50' : 'bg-red-50'}`}>
                    <div className={`p-3 rounded-xl ${isTP ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>
                        {isTP ? <Target size={28} /> : <ShieldAlert size={28} />}
                    </div>
                    <div>
                        <h2 className="text-xl font-bold text-gray-800">
                            {isTP ? 'Target Reached' : 'Stop Loss Hit'}
                        </h2>
                        <p className="text-sm text-gray-500">
                            {isTP ? 'Target price has been hit on candle close.' : 'Stop loss price has been hit on candle close.'}
                        </p>
                    </div>
                </div>

                {/* Content */}
                <div className="p-6">
                    <div className="flex gap-3 mb-4">
                        <div className="flex-1 bg-gray-50 rounded-xl p-4 border border-gray-100">
                            <div className="flex justify-between items-center mb-1">
                                <span className="text-gray-500 text-[10px] font-medium uppercase tracking-wider">{isTP ? 'Target' : 'Stop Loss'}</span>
                            </div>
                            <div className="text-xl font-mono font-bold text-gray-700">
                                {pendingRequest.price.toFixed(2)}
                            </div>
                        </div>
                        <div className="flex-1 bg-blue-50/50 rounded-xl p-4 border border-blue-100/50">
                            <div className="flex justify-between items-center mb-1">
                                <span className="text-blue-600 text-[10px] font-medium uppercase tracking-wider">Spot Price</span>
                            </div>
                            <div className="text-xl font-mono font-bold text-blue-700">
                                {pendingRequest.spotPrice.toFixed(2)}
                            </div>
                        </div>
                    </div>

                    {/* P&L Section */}
                    <div className={`rounded-xl p-4 mb-6 border ${projectedPnL >= 0 ? 'bg-green-50 border-green-100' : 'bg-red-50 border-red-100'}`}>
                        <div className="flex justify-between items-center mb-1">
                            <span className={`text-[10px] font-medium uppercase tracking-wider ${projectedPnL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                Projected {projectedPnL >= 0 ? 'Profit' : 'Loss'}
                            </span>
                        </div>
                        <div className={`text-2xl font-bold ${projectedPnL >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                            {formatCurrency(projectedPnL)}
                        </div>
                    </div>

                    <div className="flex flex-col gap-3">
                        <button
                            onClick={() => resolveRequest(true)}
                            className={`w-full py-3 rounded-xl font-bold text-white shadow-lg transition-all active:scale-95 ${isTP
                                ? 'bg-green-600 hover:bg-green-700 shadow-green-200'
                                : 'bg-red-600 hover:bg-red-700 shadow-red-200'
                                }`}
                        >
                            Exit Trade Now
                        </button>
                        <button
                            onClick={() => resolveRequest(false)}
                            className="w-full py-3 rounded-xl font-semibold text-gray-600 bg-white border-2 border-gray-100 hover:bg-gray-50 transition-all active:scale-95"
                        >
                            Continue Playing
                        </button>
                    </div>

                    <p className="mt-4 text-center text-[11px] text-gray-400">
                        Note: Playback is paused. Choose to close your current position or keep it open.
                    </p>
                </div>

                {/* Close Button X */}
                <button
                    onClick={() => resolveRequest(false)}
                    className="absolute top-4 right-4 p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                >
                    <X size={18} />
                </button>
            </div>
        </div>
    );
}
