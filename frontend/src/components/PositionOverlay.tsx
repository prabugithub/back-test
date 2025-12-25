import { useSessionStore } from '../stores/sessionStore';
import { formatCurrency } from '../utils/formatters';

export function PositionOverlay() {
    const position = useSessionStore((s) => s.position);
    const candles = useSessionStore((s) => s.candles);
    const currentIndex = useSessionStore((s) => s.currentIndex);

    if (!position || position.quantity === 0) return null;

    const currentCandle = candles[currentIndex];
    if (!currentCandle) return null;

    const unrealizedPnL = (currentCandle.close - position.averagePrice) * position.quantity;
    // Simple direction inference (if we only support long for now, quantity is always positive. 
    // If we support shorts, quantity might be negative? Store logic suggests generic quantity, but assuming Long only based on UI 'Buy'/'Sell' reducing pos)
    // Actually the store handles Sell by reducing quantity, so it seems Long only. 
    // Let's assume Long for now or check if we want to show 'LONG'.
    const direction = "LONG";

    const isProfit = unrealizedPnL >= 0;

    return (
        <div
            className="absolute top-2 right-2 bg-white/90 backdrop-blur-sm border border-gray-200 shadow-lg rounded-lg p-3 z-[150] min-w-[200px] cursor-move"
            draggable={true} // In a real app we'd use a DnD lib or custom logic
            // For now simple fixed positioning is safer to avoid bugs without a lib
            style={{ right: '10px', top: '50px' }}
        >
            <div className="flex justify-between items-center mb-2 border-b pb-1">
                <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${direction === 'LONG' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {direction}
                </span>
                <span className="text-xs text-gray-500 font-mono">
                    {position.quantity} Qty
                </span>
            </div>

            <div className="flex flex-col gap-1">
                <div className="flex justify-between text-xs">
                    <span className="text-gray-600">Avg Price:</span>
                    <span className="font-medium">{formatCurrency(position.averagePrice)}</span>
                </div>
                <div className="flex justify-between text-sm mt-1">
                    <span className="font-semibold text-gray-700">P&L:</span>
                    <span className={`font-bold ${isProfit ? 'text-green-600' : 'text-red-600'}`}>
                        {formatCurrency(unrealizedPnL)}
                    </span>
                </div>
            </div>
        </div>
    );
}
