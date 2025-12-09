import { useState } from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';
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
    <div className="bg-white border rounded-lg p-6 shadow-sm">
      <h2 className="text-lg font-bold mb-4">Trading Panel</h2>

      {/* Current Price */}
      <div className="mb-6">
        <div className="text-sm text-gray-600 mb-1">Current Price</div>
        <div className="text-3xl font-bold text-gray-900">
          {formatCurrency(currentPrice)}
        </div>
      </div>

      {/* Current Position */}
      {position && position.quantity > 0 && (
        <div className="mb-6 p-3 bg-blue-50 rounded">
          <div className="text-sm text-gray-600 mb-1">Current Position</div>
          <div className="font-semibold">
            {position.quantity} shares @ {formatCurrency(position.averagePrice)}
          </div>
        </div>
      )}

      {/* Quantity Input */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Quantity
        </label>
        <input
          type="number"
          min={1}
          value={quantity}
          onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
          className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Buy/Sell Buttons */}
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={handleBuy}
          disabled={!currentCandle}
          className="flex items-center justify-center gap-2 px-6 py-3 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <TrendingUp size={20} />
          BUY
        </button>
        <button
          onClick={handleSell}
          disabled={!currentCandle || !canSell}
          className="flex items-center justify-center gap-2 px-6 py-3 bg-red-600 text-white rounded-lg font-semibold hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          title={!canSell ? `Not enough shares to sell. Position: ${position?.quantity || 0}` : ''}
        >
          <TrendingDown size={20} />
          SELL
        </button>
      </div>

      {/* Trade Value */}
      <div className="mt-4 text-sm text-gray-600 text-center">
        Trade Value: {formatCurrency(currentPrice * quantity)}
      </div>
    </div>
  );
}
