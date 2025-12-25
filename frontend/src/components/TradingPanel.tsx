import { useState } from 'react';
// import { TrendingUp, TrendingDown } from 'lucide-react';
import { useSessionStore } from '../stores/sessionStore';
import { formatCurrency } from '../utils/formatters';

export function TradingPanel() {
  const [quantity, setQuantity] = useState(1);
  // Use selector to get current candle
  const currentCandle = useSessionStore((s) => s.candles[s.currentIndex] || null);
  const position = useSessionStore((s) => s.position);
  const executeTrade = useSessionStore((s) => s.executeTrade);

  const handleBuy = () => {
    if (quantity > 0) {
      executeTrade('BUY', quantity);
    }
  };

  const handleSell = () => {
    if (quantity > 0) {
      executeTrade('SELL', quantity);
    }
  };

  const currentPrice = currentCandle?.close || 0;
  const canSell = position && position.quantity >= quantity;

  return (
    <div className="bg-white border rounded p-4 shadow-sm h-full flex flex-col gap-4">
      {/* Current Position (Top, if any) */}
      {position && position.quantity > 0 && (
        <div className="p-2 bg-blue-50 rounded text-xs">
          <div className="font-semibold text-blue-900">Position</div>
          <div className="flex justify-between mt-1 text-blue-800">
            <span>{position.quantity} qty</span>
            <span>@{formatCurrency(position.averagePrice)}</span>
          </div>
        </div>
      )}

      {/* Price Display */}
      <div className="text-center">
        <div className="text-2xl font-bold text-gray-900 mb-1">
          {formatCurrency(currentPrice)}
        </div>
        <div className="text-xs text-gray-500">Current Price</div>
      </div>

      {/* Inputs */}
      <div className="flex-1 flex flex-col justify-center gap-3">
        <div>
          {/* <label className="block text-xs font-medium text-gray-500 mb-1">Quantity</label> */}
          <input
            type="number"
            min={1}
            value={quantity}
            onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
            className="w-full px-3 py-2 border rounded text-center font-medium focus:ring-1 focus:ring-blue-500 text-lg"
            placeholder="Qty"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={handleBuy}
            disabled={!currentCandle}
            className="flex flex-col items-center justify-center py-3 bg-green-600 text-white rounded font-bold hover:bg-green-700 disabled:opacity-50 transition-colors"
          >
            <span className="text-sm">BUY</span>
          </button>
          <button
            onClick={handleSell}
            disabled={!currentCandle || !canSell}
            className="flex flex-col items-center justify-center py-3 bg-red-600 text-white rounded font-bold hover:bg-red-700 disabled:opacity-50 transition-colors"
          >
            <span className="text-sm">SELL</span>
          </button>
        </div>
      </div>

      {/* Trade Value */}
      <div className="text-xs text-center text-gray-400">
        Value: {formatCurrency(currentPrice * quantity)}
      </div>
    </div>
  );
}
