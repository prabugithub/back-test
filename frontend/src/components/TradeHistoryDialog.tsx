import { useRef, useEffect } from 'react';
import { X } from 'lucide-react';
import { useSessionStore } from '../stores/sessionStore';
import { formatCurrency, formatTime } from '../utils/formatters';

interface TradeHistoryDialogProps {
    isOpen: boolean;
    onClose: () => void;
}

export function TradeHistoryDialog({ isOpen, onClose }: TradeHistoryDialogProps) {
    const trades = useSessionStore((s) => s.trades);
    const dialogRef = useRef<HTMLDivElement>(null);

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
                className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[80vh] flex flex-col m-4"
            >
                <div className="flex items-center justify-between p-4 border-b">
                    <h2 className="text-lg font-bold">Trade History</h2>
                    <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
                        <X size={20} />
                    </button>
                </div>

                <div className="flex-1 overflow-auto p-4">
                    {trades.length === 0 ? (
                        <div className="text-center text-gray-500 py-8">
                            No trades yet.
                        </div>
                    ) : (
                        <table className="w-full text-sm">
                            <thead className="bg-gray-50 sticky top-0">
                                <tr>
                                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Time</th>
                                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Type</th>
                                    <th className="px-3 py-2 text-right font-semibold text-gray-700">Price</th>
                                    <th className="px-3 py-2 text-right font-semibold text-gray-700">Qty</th>
                                    <th className="px-3 py-2 text-right font-semibold text-gray-700">P&L</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y">
                                {trades.map((trade) => (
                                    <tr key={trade.id} className="hover:bg-gray-50">
                                        <td className="px-3 py-2 text-gray-600">
                                            {formatTime(trade.timestamp)}
                                        </td>
                                        <td className="px-3 py-2">
                                            <span
                                                className={`px-2 py-1 rounded text-xs font-semibold ${trade.type === 'BUY'
                                                        ? 'bg-green-100 text-green-700'
                                                        : 'bg-red-100 text-red-700'
                                                    }`}
                                            >
                                                {trade.type}
                                            </span>
                                        </td>
                                        <td className="px-3 py-2 text-right font-medium">
                                            {formatCurrency(trade.price)}
                                        </td>
                                        <td className="px-3 py-2 text-right">{trade.quantity}</td>
                                        <td className="px-3 py-2 text-right">
                                            {trade.pnl !== undefined ? (
                                                <span
                                                    className={`font-semibold ${trade.pnl >= 0 ? 'text-green-600' : 'text-red-600'
                                                        }`}
                                                >
                                                    {formatCurrency(trade.pnl)}
                                                </span>
                                            ) : (
                                                <span className="text-gray-400">-</span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        </div>
    );
}
