import { useSessionStore } from '../stores/sessionStore';
import { formatCurrency, formatTime } from '../utils/formatters';

export function SessionStats() {
  const trades = useSessionStore((s) => s.trades);
  const position = useSessionStore((s) => s.position);
  const candles = useSessionStore((s) => s.candles);
  const currentIndex = useSessionStore((s) => s.currentIndex);

  // Calculate unrealized P&L inline
  const unrealizedPnL = (() => {
    if (!position || position.quantity === 0) return 0;
    const currentCandle = candles[currentIndex];
    if (!currentCandle) return 0;
    return (currentCandle.close - position.averagePrice) * position.quantity;
  })();

  // Calculate realized P&L inline
  const realizedPnL = position?.realizedPnL || 0;

  const totalPnL = realizedPnL + unrealizedPnL;

  // Calculate win/loss stats
  const closedTrades = trades.filter((t) => t.type === 'SELL' && t.pnl !== undefined);
  const winningTrades = closedTrades.filter((t) => (t.pnl || 0) > 0);
  const losingTrades = closedTrades.filter((t) => (t.pnl || 0) < 0);
  const winRate =
    closedTrades.length > 0 ? (winningTrades.length / closedTrades.length) * 100 : 0;

  return (
    <div className="bg-white border rounded-lg p-6 shadow-sm">
      <h2 className="text-lg font-bold mb-4">Session Statistics</h2>

      {/* Position Summary */}
      {position && position.quantity > 0 && (
        <div className="mb-6 p-4 bg-gray-50 rounded-lg">
          <h3 className="font-semibold mb-2 text-gray-700">Current Position</h3>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-600">Quantity:</span>
              <span className="font-medium">{position.quantity} shares</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Average Price:</span>
              <span className="font-medium">{formatCurrency(position.averagePrice)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Unrealized P&L:</span>
              <span
                className={`font-bold ${
                  unrealizedPnL >= 0 ? 'text-green-600' : 'text-red-600'
                }`}
              >
                {formatCurrency(unrealizedPnL)}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* P&L Summary */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="p-4 bg-blue-50 rounded-lg">
          <div className="text-sm text-gray-600 mb-1">Realized P&L</div>
          <div
            className={`text-xl font-bold ${
              realizedPnL >= 0 ? 'text-green-600' : 'text-red-600'
            }`}
          >
            {formatCurrency(realizedPnL)}
          </div>
        </div>
        <div className="p-4 bg-purple-50 rounded-lg">
          <div className="text-sm text-gray-600 mb-1">Total P&L</div>
          <div
            className={`text-xl font-bold ${
              totalPnL >= 0 ? 'text-green-600' : 'text-red-600'
            }`}
          >
            {formatCurrency(totalPnL)}
          </div>
        </div>
      </div>

      {/* Win/Loss Stats */}
      {closedTrades.length > 0 && (
        <div className="mb-6 p-4 bg-gray-50 rounded-lg">
          <h3 className="font-semibold mb-2 text-gray-700">Performance</h3>
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <div className="text-gray-600">Win Rate</div>
              <div className="font-bold text-blue-600">{winRate.toFixed(1)}%</div>
            </div>
            <div>
              <div className="text-gray-600">Wins</div>
              <div className="font-bold text-green-600">{winningTrades.length}</div>
            </div>
            <div>
              <div className="text-gray-600">Losses</div>
              <div className="font-bold text-red-600">{losingTrades.length}</div>
            </div>
          </div>
        </div>
      )}

      {/* Trade History */}
      <div>
        <div className="flex justify-between items-center mb-3">
          <h3 className="font-semibold text-gray-700">
            Trade History ({trades.length})
          </h3>
        </div>

        {trades.length === 0 ? (
          <div className="text-center text-gray-500 py-8">
            No trades yet. Start backtesting to see your trades here.
          </div>
        ) : (
          <div className="overflow-auto max-h-80">
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
                        className={`px-2 py-1 rounded text-xs font-semibold ${
                          trade.type === 'BUY'
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
                          className={`font-semibold ${
                            trade.pnl >= 0 ? 'text-green-600' : 'text-red-600'
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
          </div>
        )}
      </div>
    </div>
  );
}
