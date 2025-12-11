import { useState, useRef, useEffect } from 'react';
import { Search, ChevronDown, X } from 'lucide-react';
import { fetchCandles } from '../services/api';
import { useSessionStore } from '../stores/sessionStore';
import { SYMBOLS, SYMBOL_CATEGORIES, searchSymbols, type Symbol } from '../data/symbols';

export function InstrumentSelector() {
  const [securityId, setSecurityId] = useState('2885'); // RELIANCE on Angel One
  const [exchangeSegment, setExchangeSegment] = useState('NSE_EQ');
  const [instrument, setInstrument] = useState('EQUITY');
  const [interval, setInterval] = useState('5');
  const [fromDate, setFromDate] = useState('2024-01-01');
  const [toDate, setToDate] = useState('2024-01-31');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Symbol search states
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedSymbol, setSelectedSymbol] = useState<Symbol | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const loadCandles = useSessionStore((s) => s.loadCandles);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredSymbols = searchSymbols(searchQuery, selectedCategory);

  const handleSymbolSelect = (symbol: Symbol) => {
    setSelectedSymbol(symbol);
    setSecurityId(symbol.token);
    setExchangeSegment(symbol.exchange);
    setInstrument(symbol.instrumentType);
    setSearchQuery('');
    setShowDropdown(false);
  };

  const handleClearSymbol = () => {
    setSelectedSymbol(null);
    setSearchQuery('');
  };

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

      {/* Symbol Search Dropdown */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Search Symbol
        </label>
        <div className="relative" ref={dropdownRef}>
          <div className="relative">
            <input
              type="text"
              value={selectedSymbol ? `${selectedSymbol.name} (${selectedSymbol.symbol})` : searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setShowDropdown(true);
                if (selectedSymbol) setSelectedSymbol(null);
              }}
              onFocus={() => setShowDropdown(true)}
              className="w-full px-3 py-2 pl-10 pr-10 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Search by name, symbol, or token..."
            />
            <Search className="absolute left-3 top-2.5 text-gray-400" size={18} />
            {selectedSymbol && (
              <button
                onClick={handleClearSymbol}
                className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600"
              >
                <X size={18} />
              </button>
            )}
          </div>

          {/* Category Filter */}
          {showDropdown && (
            <div className="absolute z-50 w-full mt-1 bg-white border rounded-lg shadow-lg max-h-96 overflow-hidden">
              <div className="p-2 border-b bg-gray-50 flex gap-1 flex-wrap">
                {SYMBOL_CATEGORIES.map((category) => (
                  <button
                    key={category}
                    onClick={() => setSelectedCategory(category)}
                    className={`px-2 py-1 text-xs rounded ${
                      selectedCategory === category
                        ? 'bg-blue-600 text-white'
                        : 'bg-white text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    {category}
                  </button>
                ))}
              </div>

              {/* Symbol List */}
              <div className="overflow-y-auto max-h-80">
                {filteredSymbols.length > 0 ? (
                  filteredSymbols.map((symbol) => (
                    <button
                      key={symbol.token}
                      onClick={() => handleSymbolSelect(symbol)}
                      className="w-full px-3 py-2 text-left hover:bg-blue-50 border-b last:border-b-0 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-medium text-sm">{symbol.name}</div>
                          <div className="text-xs text-gray-500">
                            {symbol.symbol} • Token: {symbol.token}
                          </div>
                        </div>
                        <div className="text-xs px-2 py-1 bg-gray-100 rounded">
                          {symbol.category}
                        </div>
                      </div>
                    </button>
                  ))
                ) : (
                  <div className="px-3 py-4 text-center text-gray-500 text-sm">
                    No symbols found
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

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
            <option value="1D">1 Day</option>
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

      <div className="mt-3 text-xs text-gray-500 space-y-1">
        <div>
          <strong>Available Symbols:</strong> Nifty 50, Bank Nifty, Finnifty indices + All Nifty 50 stocks
        </div>
        <div className="text-blue-600">
          Using Angel One API (FREE) • {SYMBOLS.length} symbols available
        </div>
      </div>
    </div>
  );
}
