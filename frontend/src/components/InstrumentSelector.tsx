import { useState, useRef, useEffect } from 'react';
import { Search, X, Database, HardDrive, CloudDownload } from 'lucide-react';
import { fetchCandles } from '../services/api';
import { useSessionStore } from '../stores/sessionStore';
import { SYMBOLS, SYMBOL_CATEGORIES, searchSymbols, type Symbol } from '../data/symbols';
import { useLiveStore } from '../stores/liveStore';
import {
  LOCAL_DATASETS, LEGACY_DATASET_ID, getLocalDataset, intervalToMinutes,
  loadLocalCandles, localInstrumentLabel,
} from '../utils/localMarketData';

// Timeframes offered for local data; those finer than the dataset's native bars are hidden.
const LOCAL_TIMEFRAMES = [
  { value: '5', label: '5 Minutes' },
  { value: '15', label: '15 Minutes' },
  { value: '60', label: '1 Hour' },
  { value: '1D', label: '1 Day' },
];

export function InstrumentSelector() {
  const [dataSource, setDataSource] = useState<'api' | 'local' | 'live'>('local');
  const [securityId, setSecurityId] = useState('2885'); // RELIANCE on Angel One
  const [exchangeSegment, setExchangeSegment] = useState('NSE_EQ');
  const [instrument, setInstrument] = useState('EQUITY');
  const [interval, setInterval] = useState('15');
  const [fromDate, setFromDate] = useState('2021-01-01');
  const [toDate, setToDate] = useState('2026-01-20');
  const [jumpToDate, setJumpToDate] = useState('2021-01-01');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [useDateBasedLoading, setUseDateBasedLoading] = useState(false);
  const [selectedYear, setSelectedYear] = useState<string>(''); // '' = custom range
  const [localDatasetId, setLocalDatasetId] = useState<string>(LEGACY_DATASET_ID);

  const localDataset = getLocalDataset(localDatasetId);
  const localBaseMinutes = localDataset.baseMinutes ?? 1;
  const localTimeframes = LOCAL_TIMEFRAMES.filter(tf => intervalToMinutes(tf.value) >= localBaseMinutes);

  const handleLocalDatasetChange = (id: string) => {
    setLocalDatasetId(id);
    // Raise the timeframe if the new dataset can't produce the current one (e.g. 5m from 15m bars).
    const base = getLocalDataset(id).baseMinutes ?? 1;
    if (intervalToMinutes(interval) < base) setInterval(base === 1440 ? '1D' : String(base));
  };

  // Years available for quick-select (local data starts 2015)
  const yearOptions = (() => {
    const currentYear = new Date().getFullYear();
    const years: number[] = [];
    for (let y = currentYear; y >= 2015; y--) years.push(y);
    return years;
  })();

  const handleYearSelect = (year: string) => {
    setSelectedYear(year);
    if (year) {
      const currentYear = new Date().getFullYear();
      const start = `${year}-01-01`;
      setFromDate(start);
      // Cap "to date" at today for the current year so we don't request future data
      setToDate(Number(year) === currentYear ? new Date().toISOString().split('T')[0] : `${year}-12-31`);
      // Default playback to start at the beginning of the selected range
      setJumpToDate(start);
    }
  };

  // Keep Jump to Date in sync with From Date when the user edits it manually
  const handleFromDateChange = (value: string) => {
    setFromDate(value);
    setJumpToDate(value);
    setSelectedYear('');
  };

  // Auto-bind defaults for Live mode
  useEffect(() => {
    if (dataSource === 'live') {
      // Bind Nifty
      const nifty = SYMBOLS.find(s => s.symbol === 'NIFTY 50');
      if (nifty && (!selectedSymbol || selectedSymbol.symbol !== 'NIFTY 50')) {
        setSelectedSymbol(nifty);
        setSecurityId(nifty.token);
        setExchangeSegment(nifty.exchange);
        setInstrument(nifty.instrumentType);
      }

      // Always set jump to today for Live
      const today = new Date().toISOString().split('T')[0];
      if (jumpToDate !== today) setJumpToDate(today);

      // Handle historical data range
      if (!useDateBasedLoading) {
        const to = new Date();
        const from = new Date();
        from.setMonth(from.getMonth() - 1);
        const fromStr = from.toISOString().split('T')[0];
        const toStr = to.toISOString().split('T')[0];
        
        if (fromDate !== fromStr) setFromDate(fromStr);
        if (toDate !== toStr) setToDate(toStr);
      }
    }
  }, [dataSource, useDateBasedLoading]);

  // Auto-bind defaults for API mode
  useEffect(() => {
    if (dataSource === 'api') {
      const nifty = SYMBOLS.find(s => s.symbol === 'NIFTY 50');
      if (nifty && (!selectedSymbol || selectedSymbol.symbol !== 'NIFTY 50')) {
        setSelectedSymbol(nifty);
        setSecurityId(nifty.token);           // '13'
        setExchangeSegment(nifty.exchange);   // 'IDX_I'
        setInstrument(nifty.instrumentType);  // 'INDEX'
      }

      const to = new Date();
      const from = new Date();
      from.setMonth(from.getMonth() - 3);
      setFromDate(from.toISOString().split('T')[0]);
      setToDate(to.toISOString().split('T')[0]);
    }
  }, [dataSource]);

  // Symbol search states
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedSymbol, setSelectedSymbol] = useState<Symbol | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const loadCandles = useSessionStore((s) => s.loadCandles);
  const setCurrentIndex = useSessionStore((s) => s.setCurrentIndex);
  const loadRemoteSession = useSessionStore((s) => s.loadRemoteSession);
  const restoreSessionState = useSessionStore((s) => s.restoreSessionState);
  const setLiveModeInSession = useSessionStore((s) => s.setLiveMode);
  
  const { isConnected, isLiveMode, setLiveMode, connect } = useLiveStore();

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

  // Helper to find index by date. Returns -1 if not found.
  const findIndexByDate = (candles: any[], dateStr: string): number => {
    if (!dateStr) return -1;
    const targetTs = new Date(dateStr).getTime() / 1000;
    for (let i = 0; i < candles.length; i++) {
      if (candles[i].timestamp >= targetTs) return i;
    }
    return -1;
  };

  const handleFetch = async (overrideConfig?: any) => {
    setLoading(true);
    setError(null);

    // Use overrides if provided, otherwise use current state
    const cfg = overrideConfig || {
      dataSource,
      securityId,
      exchangeSegment,
      instrumentType: instrument, // Map local state 'instrument' to 'instrumentType'
      interval,
      fromDate,
      toDate,
      ...(dataSource === 'local' ? { localDatasetId } : {}),
    };

    try {
      if (cfg.dataSource === 'api' || cfg.dataSource === 'live') {
        const response = await fetchCandles({
          securityId: cfg.securityId,
          exchangeSegment: cfg.exchangeSegment,
          instrument: cfg.instrumentType,
          interval: cfg.interval,
          fromDate: cfg.fromDate,
          toDate: cfg.toDate,
        });

        if (response.success && response.data.length > 0) {
          loadCandles(response.data, `${cfg.securityId}-${cfg.exchangeSegment}`, cfg);

          if (cfg.dataSource === 'live') {
              setLiveModeInSession(true);
              setLiveMode(true);
              // Restore drawings from the last saved session so they survive a live chart reload
              try {
                const saved = await loadRemoteSession();
                const ui = saved?.data.uiSettings as any;
                if (ui?.drawings?.length) {
                  useSessionStore.getState().setDrawings(ui.drawings);
                }
                if (ui?.secondaryDrawings?.length) {
                  useSessionStore.getState().setSecondaryDrawings(ui.secondaryDrawings);
                }
              } catch (_) {
                // No prior session — silently ignore
              }
          }

          // Apply initial jump if requested
          if (!overrideConfig && jumpToDate) {
            const index = findIndexByDate(response.data, jumpToDate);
            if (index >= 0) setCurrentIndex(index);
          }
        } else {
          setError('No data received from API');
        }
      } else {
        // Handle Local Data Loading
        try {
          const result = await loadLocalCandles(cfg.localDatasetId, cfg.interval, cfg.fromDate, cfg.toDate);
          const resampledCandles = result.candles;
          const loadedCfg = { ...cfg, interval: result.interval };
          if (result.clamped) setInterval(result.interval);

          if (resampledCandles.length > 0) {
            loadCandles(resampledCandles, localInstrumentLabel(cfg.localDatasetId, result.interval), loadedCfg);

            // Apply initial jump if requested
            if (!overrideConfig && jumpToDate) {
              const index = findIndexByDate(resampledCandles, jumpToDate);
              if (index >= 0) setCurrentIndex(index);
            }
          } else {
            setError(`No ${result.dataset.label} candles in the selected date range`);
          }
        } catch (err: any) {
          console.error(err);
          setError(`Failed to load local file: ${err.message}`);
        }
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch data');
    } finally {
      setLoading(false);
    }
  };

  const handleResumeSession = async () => {
    try {
      const result = await loadRemoteSession();
      if (result && result.config) {
        // Update local state to match restored config
        const { config, data } = result;
        setDataSource(config.dataSource);
        setSecurityId(config.securityId);
        setExchangeSegment(config.exchangeSegment);
        setInstrument(config.instrumentType);
        setInterval(config.interval);
        setFromDate(config.fromDate);
        setToDate(config.toDate);
        setLocalDatasetId(config.localDatasetId || LEGACY_DATASET_ID);

        // Fetch using the restored config
        await handleFetch(config);

        // Restore session state (trades, position, currentIndex, and UI settings like drawings /
        // indicators) in one synchronous call right after handleFetch completes.
        // loadCandles (called inside handleFetch) does NOT reset drawings or indicators, so
        // applying uiSettings here in the same tick ensures a single React render cycle sees
        // both the new candle data and the restored UI state.
        restoreSessionState(data.trades, data.position, data.currentIndex, data.uiSettings, {
          openPositions: data.openPositions,
          multiRealizedPnL: data.multiRealizedPnL,
        });
      } else {
        setError("No saved session found.");
      }
    } catch (e) {
      console.error(e);
      setError("Failed to resume session.");
    }
  };

  return (
    <div className="bg-white border rounded-lg p-6 shadow-sm">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-bold flex items-center gap-2">
          <Search size={20} />
          Load Data
        </h2>

        {/* Source Toggle */}
        <div className="flex bg-gray-100 p-1 rounded-lg gap-1">
          <button
            onClick={handleResumeSession}
            className="px-3 py-1.5 text-sm font-medium rounded-md flex items-center gap-2 text-blue-700 bg-blue-50 hover:bg-blue-100 transition-all border border-blue-200"
            title="Resume last saved session"
          >
            <CloudDownload size={16} />
            Resume
          </button>
          <div className="w-px bg-gray-300 mx-1 self-center h-6"></div>
          <button
            onClick={() => setDataSource('local')}
            className={`px-3 py-1.5 text-sm font-medium rounded-md flex items-center gap-2 transition-all ${dataSource === 'local'
              ? 'bg-white text-blue-600 shadow-sm'
              : 'text-gray-600 hover:text-gray-900'
              }`}
          >
            <HardDrive size={16} />
            Local
          </button>
          <button
            onClick={() => setDataSource('api')}
            className={`px-3 py-1.5 text-sm font-medium rounded-md flex items-center gap-2 transition-all ${dataSource === 'api'
              ? 'bg-white text-blue-600 shadow-sm'
              : 'text-gray-600 hover:text-gray-900'
              }`}
          >
            <Database size={16} />
            API
          </button>
          <button
            onClick={() => {
                setDataSource('live');
                setLiveModeInSession(true);
                connect();
            }}
            className={`px-3 py-1.5 text-sm font-medium rounded-md flex items-center gap-2 transition-all ${dataSource === 'live'
              ? 'bg-white text-green-600 shadow-sm font-bold border border-green-200'
              : 'text-gray-600 hover:text-gray-900'
              }`}
          >
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-gray-400'} ${isLiveMode ? 'animate-pulse' : ''}`}></div>
            Live
          </button>
        </div>
      </div>

      {dataSource === 'live' && (
        <div className="mb-4 flex items-center gap-3 p-3 bg-green-50 border border-green-100 rounded-lg">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-green-800">NIFTY 50 (Selected by default)</span>
            <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></div>
          </div>
          <div className="h-4 w-px bg-green-200 mx-2"></div>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <div className="relative">
              <input 
                type="checkbox" 
                className="sr-only" 
                checked={useDateBasedLoading}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setUseDateBasedLoading(checked);
                  if (!checked) {
                    const to = new Date();
                    const from = new Date();
                    from.setMonth(from.getMonth() - 1);
                    setFromDate(from.toISOString().split('T')[0]);
                    setToDate(to.toISOString().split('T')[0]);
                  }
                }}
              />
              <div className={`block w-8 h-5 rounded-full transition-colors ${useDateBasedLoading ? 'bg-green-600' : 'bg-gray-300'}`}></div>
              <div className={`absolute left-1 top-1 bg-white w-3 h-3 rounded-full transition-transform ${useDateBasedLoading ? 'translate-x-3' : ''}`}></div>
            </div>
            <span className="text-sm text-green-800 font-medium">Use Custom Date Range</span>
          </label>
        </div>
      )}

      {dataSource === 'api' || dataSource === 'live' ? (
        <>
          {/* Symbol Search Dropdown - Only for API source */}
          {dataSource === 'api' && (
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
                          className={`px-2 py-1 text-xs rounded ${selectedCategory === category
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
          )}

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {dataSource === 'api' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Symbol Token
                  </label>
                  <input
                    type="text"
                    value={securityId}
                    onChange={(e) => setSecurityId(e.target.value)}
                    className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="e.g., 13 for NIFTY 50"
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
                    <option value="IDX_I">Index (IDX)</option>
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
              </>
            )}

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
                onChange={(e) => handleFromDateChange(e.target.value)}
                disabled={dataSource === 'live' && !useDateBasedLoading}
                className={`w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 ${dataSource === 'live' && !useDateBasedLoading ? 'bg-gray-100 cursor-not-allowed text-gray-500' : ''}`}
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
                disabled={dataSource === 'live' && !useDateBasedLoading}
                className={`w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 ${dataSource === 'live' && !useDateBasedLoading ? 'bg-gray-100 cursor-not-allowed text-gray-500' : ''}`}
              />
            </div>

            {dataSource === 'api' && (
              <div>
                <label className="block text-sm font-medium text-blue-700 mb-1 font-bold">
                  Jump to Date
                </label>
                <input
                  type="date"
                  value={jumpToDate}
                  onChange={(e) => setJumpToDate(e.target.value)}
                  className="w-full px-3 py-2 border border-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-blue-50"
                />
              </div>
            )}
          </div>
        </>
      ) : (
        /* Local Data Options */
        <div className="space-y-4">
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <h3 className="font-semibold text-blue-900 mb-2">Local Data Source</h3>
            <p className="text-blue-800 text-sm">
              {LOCAL_DATASETS.length} instruments bundled from <code>assets/market-data</code>.
              Drop a <code>NAME_15minute.json</code> file there to add another.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Instrument
            </label>
            <select
              value={localDatasetId}
              onChange={(e) => handleLocalDatasetChange(e.target.value)}
              className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {LOCAL_DATASETS.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}{d.baseMinutes ? ` — ${d.baseMinutes}m bars` : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              View Timeframe (Resampled)
            </label>
            <select
              value={intervalToMinutes(interval) < localBaseMinutes ? localTimeframes[0]?.value : interval}
              onChange={(e) => setInterval(e.target.value)}
              className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {localTimeframes.map((tf) => (
                <option key={tf.value} value={tf.value}>
                  {tf.label}{intervalToMinutes(tf.value) === localBaseMinutes ? ' (Original)' : ''}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-gray-500">
              Bars are aggregated up from the file's native {localBaseMinutes}m timeframe.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Year
            </label>
            <select
              value={selectedYear}
              onChange={(e) => handleYearSelect(e.target.value)}
              className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Custom Range</option>
              {yearOptions.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-gray-500">
              Pick a year to load Jan 1 – Dec 31, or use Custom Range below.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                From Date
              </label>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => handleFromDateChange(e.target.value)}
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
                onChange={(e) => { setToDate(e.target.value); setSelectedYear(''); }}
                className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-blue-700 mb-1 font-bold">
                Jump to Date
              </label>
              <input
                type="date"
                value={jumpToDate}
                onChange={(e) => setJumpToDate(e.target.value)}
                className="w-full px-3 py-2 border border-blue-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-blue-50"
              />
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
          {error}
        </div>
      )}

      <button
        onClick={() => handleFetch()}
        disabled={loading}
        className="mt-4 w-full px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {loading ? 'Processing...' : (dataSource === 'api' ? 'Fetch & Load' : (dataSource === 'live' ? 'Start Live Feed' : 'Load Local Data'))}
      </button>

      {dataSource === 'api' && (
        <div className="mt-3 text-xs text-gray-500 space-y-1">
          <div>
            <strong>Available Symbols:</strong> Nifty 50, Bank Nifty, Finnifty indices + All Nifty 50 stocks
          </div>
          <div className="text-blue-600">
            Using Dhan API • {SYMBOLS.length} symbols available
          </div>
        </div>
      )}
    </div>
  );
}
