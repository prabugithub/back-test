import { useState } from 'react';
import { Search } from 'lucide-react';
import { fetchCandles } from '../services/api';
import { useSessionStore } from '../stores/sessionStore';

export function InstrumentSelector() {
  const [securityId, setSecurityId] = useState('2885'); // RELIANCE on Angel One
  const [exchangeSegment, setExchangeSegment] = useState('NSE_EQ');
  const [instrument, setInstrument] = useState('EQUITY');
  const [interval, setInterval] = useState('5');
  const [fromDate, setFromDate] = useState('2024-01-01');
  const [toDate, setToDate] = useState('2024-01-31');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadCandles = useSessionStore((s) => s.loadCandles);

  const handleFetch = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetchCandles({
        securityId,
        exchangeSegment,
        instrument,
        interval,
        fromDate,
        toDate,
      });

      if (response.success && response.data.length > 0) {
        loadCandles(response.data, `${securityId}-${exchangeSegment}`);
      } else {
        setError('No data received from API');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch data');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white border rounded-lg p-6 shadow-sm">
      <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
        <Search size={20} />
        Load Data
      </h2>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Symbol Token
          </label>
          <input
            type="text"
            value={securityId}
            onChange={(e) => setSecurityId(e.target.value)}
            className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="e.g., 2885 for RELIANCE"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Exchange Segment
          </label>
          <select
            value={exchangeSegment}
            onChange={(e) => setExchangeSegment(e.target.value)}
            className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="NSE_EQ">NSE Equity</option>
            <option value="NSE_FNO">NSE F&O</option>
            <option value="BSE_EQ">BSE Equity</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Instrument Type
          </label>
          <select
            value={instrument}
            onChange={(e) => setInstrument(e.target.value)}
            className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="EQUITY">Equity</option>
            <option value="INDEX">Index</option>
            <option value="FUTIDX">Index Future</option>
            <option value="FUTSTK">Stock Future</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Interval
          </label>
          <select
            value={interval}
            onChange={(e) => setInterval(e.target.value)}
            className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="1">1 Minute</option>
            <option value="5">5 Minutes</option>
            <option value="15">15 Minutes</option>
            <option value="60">1 Hour</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            From Date
          </label>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            To Date
          </label>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {error && (
        <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
          {error}
        </div>
      )}

      <button
        onClick={handleFetch}
        disabled={loading}
        className="mt-4 w-full px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {loading ? 'Loading...' : 'Fetch Data'}
      </button>

      <div className="mt-3 text-xs text-gray-500">
        <strong>Angel One Symbol Tokens:</strong> RELIANCE: 2885, INFY: 1594, TCS: 11536, SBIN: 3045
        <br />
        <span className="text-blue-600">Note: Using Angel One API (FREE)</span>
      </div>
    </div>
  );
}
