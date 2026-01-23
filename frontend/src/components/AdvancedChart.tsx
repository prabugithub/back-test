import { useEffect, useRef, useState } from 'react';
import {
  createChart,
  ColorType,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  createSeriesMarkers,
} from 'lightweight-charts';
import { useSessionStore } from '../stores/sessionStore';
import { ChartToolbar } from './ChartToolbar';
import type { DrawingTool } from './ChartToolbar';
import type { Indicator } from './ChartToolbar';
import { calculateSMA, calculateEMA, calculatePivotPoints } from '../utils/indicators';
import { useChartDrawings } from '../hooks/useChartDrawings';

export function AdvancedChart() {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const candleSeriesRef = useRef<any>(null);
  const volumeSeriesRef = useRef<any>(null);
  const markersPrimitiveRef = useRef<any>(null);
  const indicatorSeriesRef = useRef<Map<string, any>>(new Map());

  const [activeTool, setActiveTool] = useState<DrawingTool>('none');
  const [activeIndicators, setActiveIndicators] = useState<Indicator[]>(['ema21', 'pivotPoints']);

  const candles = useSessionStore((s) => s.candles);
  const currentIndex = useSessionStore((s) => s.currentIndex);
  const trades = useSessionStore((s) => s.trades);
  const visibleCandles = candles.slice(0, currentIndex + 1);

  const isFirstLoadRef = useRef(true);
  const canvasRef = useRef<HTMLCanvasElement | null>(null); // Create canvas ref here, not in hook

  // Initialize drawing functionality
  const {
    clearDrawings,
    deleteSelectedDrawing,
    selectedDrawingId,
    isHoveringSelected,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
  } = useChartDrawings({
    canvasRef, // Pass the ref to the hook
    activeTool,
    onToolComplete: () => setActiveTool('none'),
  });

  // Initialize chart
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: chartContainerRef.current.clientHeight,
      layout: {
        background: { type: ColorType.Solid, color: '#ffffff' },
        textColor: '#333',
      },
      grid: {
        vertLines: { color: '#f0f0f0' },
        horzLines: { color: '#f0f0f0' },
      },
      rightPriceScale: {
        borderColor: '#d1d4dc',
      },
      timeScale: {
        borderColor: '#d1d4dc',
        timeVisible: true,
        secondsVisible: false,
        fixLeftEdge: true,
        lockVisibleTimeRangeOnResize: true,
      },
      crosshair: {
        mode: 1, // Normal crosshair
      },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderVisible: false,
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: '#26a69a',
      priceFormat: {
        type: 'volume',
      },
      priceScaleId: '',
    });

    volumeSeries.priceScale().applyOptions({
      scaleMargins: {
        top: 0.8,
        bottom: 0,
      },
    });

    const markersPrimitive = createSeriesMarkers(candleSeries, []);
    candleSeries.attachPrimitive(markersPrimitive as any);

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;
    markersPrimitiveRef.current = markersPrimitive;

    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
        });
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, []);

  // Update candle data
  useEffect(() => {
    if (!candleSeriesRef.current || !volumeSeriesRef.current) return;

    const candleData = visibleCandles.map((c) => ({
      time: c.timestamp as any,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    const volumeData = visibleCandles.map((c) => ({
      time: c.timestamp as any,
      value: c.volume,
      color: c.close >= c.open ? '#26a69a40' : '#ef535040',
    }));

    candleSeriesRef.current.setData(candleData);
    volumeSeriesRef.current.setData(volumeData);

    if (chartRef.current && visibleCandles.length > 0) {
      const timeScale = chartRef.current.timeScale();

      if (isFirstLoadRef.current) {
        timeScale.fitContent();
        isFirstLoadRef.current = false;
      } else {
        timeScale.scrollToPosition(3, false);
      }
    }
  }, [visibleCandles]);

  // Reset on new data
  useEffect(() => {
    isFirstLoadRef.current = true;
  }, [candles.length]);

  // Update indicator line series
  useEffect(() => {
    if (!chartRef.current || visibleCandles.length === 0) return;

    // Clear old indicator series (LineSeries only)
    indicatorSeriesRef.current.forEach((series) => {
      chartRef.current.removeSeries(series);
    });
    indicatorSeriesRef.current.clear();

    // Add active line-based indicators
    activeIndicators.forEach((indicator) => {
      let data: any[] = [];
      let color = '';

      switch (indicator) {
        case 'sma21':
          data = calculateSMA(visibleCandles, 21);
          color = '#2962FF';
          break;
        case 'sma60':
          data = calculateSMA(visibleCandles, 60);
          color = '#FF6D00';
          break;
        case 'ema21':
          data = calculateEMA(visibleCandles, 21);
          color = '#00897B';
          break;
        case 'ema60':
          data = calculateEMA(visibleCandles, 60);
          color = '#D81B60';
          break;
      }

      if (data.length > 0) {
        const series = chartRef.current.addSeries(LineSeries, {
          color,
          lineWidth: 2,
        });
        series.setData(data);
        indicatorSeriesRef.current.set(indicator, series);
      }
    });
  }, [activeIndicators, visibleCandles]);

  // Update markers (Trades and Pivot Points)
  useEffect(() => {
    if (!markersPrimitiveRef.current || visibleCandles.length === 0) return;

    const allMarkers: any[] = [];

    // 1. Add Trade Markers
    trades.forEach((trade) => {
      // Only show markers for trades that are within the current visible range
      if (trade.timestamp <= visibleCandles[visibleCandles.length - 1].timestamp) {
        allMarkers.push({
          time: trade.timestamp as any,
          position: trade.type === 'BUY' ? 'belowBar' : 'aboveBar',
          color: trade.type === 'BUY' ? '#26a69a' : '#ef5350',
          shape: trade.type === 'BUY' ? 'arrowUp' : 'arrowDown',
          text: `${trade.type === 'BUY' ? 'B' : 'S'}@${trade.price.toFixed(2)}`,
          size: 2,
        });
      }
    });

    // 2. Add Pivot Point Markers if active
    if (activeIndicators.includes('pivotPoints')) {
      const allPivots = calculatePivotPoints(visibleCandles);
      allPivots.forEach((p) => {
        allMarkers.push({
          time: p.time as any,
          position: p.type === 'bullish' ? 'belowBar' : 'aboveBar',
          color: p.type === 'bullish' ? '#26a69a' : '#ef5350',
          shape: p.type === 'bullish' ? 'arrowUp' : 'arrowDown',
          text: '',
        });
      });
    }

    // Sort markers by time
    allMarkers.sort((a, b) => (a.time as number) - (b.time as number));

    markersPrimitiveRef.current.setMarkers(allMarkers);
  }, [activeIndicators, visibleCandles, trades]);

  const handleIndicatorToggle = (indicator: Indicator) => {
    setActiveIndicators((prev) =>
      prev.includes(indicator)
        ? prev.filter((i) => i !== indicator)
        : [...prev, indicator]
    );
  };

  const handleClearDrawings = () => {
    clearDrawings();
    setActiveTool('none');
  };

  // Set up canvas size when chart is ready
  useEffect(() => {
    if (!chartContainerRef.current || !canvasRef.current) {
      return;
    }

    const canvas = canvasRef.current;
    const container = chartContainerRef.current;

    const resizeCanvas = () => {
      const rect = container.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
    };

    // Initial resize
    setTimeout(resizeCanvas, 100);

    window.addEventListener('resize', resizeCanvas);

    return () => {
      window.removeEventListener('resize', resizeCanvas);
    };
  }, []); // Empty dependency array - only run once!

  // Log when activeTool changes
  useEffect(() => {
    // Only keeping this generic log if useful, but can remove
    // console.log('🎨 Active tool changed to:', activeTool); 
  }, [activeTool]);



  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input field
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        return;
      }

      // Delete/Backspace to delete selected drawing
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedDrawingId) {
        e.preventDefault();
        deleteSelectedDrawing();
        return;
      }

      // Escape to exit drawing/select mode
      if (e.key === 'Escape' && activeTool !== 'none') {
        e.preventDefault();
        setActiveTool('none');
        return;
      }

      // Drawing tool shortcuts (1-7 for tools, V for select)
      const toolMap: { [key: string]: DrawingTool } = {
        'v': 'select',
        '1': 'select',
        '2': 'freehand',
        '3': 'trendline',
        '4': 'horizontal',
        '5': 'rectangle',
        '6': 'fibonacci',
        '7': 'riskReward',
      };

      const key = e.key.toLowerCase();
      if (toolMap[key]) {
        e.preventDefault();
        const newTool = toolMap[key];
        // Toggle off if already active
        setActiveTool(activeTool === newTool ? 'none' : newTool);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedDrawingId, activeTool, deleteSelectedDrawing]);

  return (
    <div className="w-full h-full flex flex-col">
      <ChartToolbar
        activeTool={activeTool}
        onToolChange={setActiveTool}
        activeIndicators={activeIndicators}
        onIndicatorToggle={handleIndicatorToggle}
        onClearDrawings={handleClearDrawings}
        onDeleteSelected={deleteSelectedDrawing}
        hasSelection={!!selectedDrawingId}
      />
      <div
        className="relative flex-1"
        style={{
          width: '100%',
          minHeight: '0', // Important for flex container
        }}
      >
        <div
          ref={chartContainerRef}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            pointerEvents: activeTool !== 'none' ? 'none' : 'auto', // Disable when drawing
            zIndex: 1, // Below canvas (which is zIndex: 100)
          }}
        />
        {/* Canvas overlay for drawings */}
        <canvas
          ref={canvasRef}
          className="absolute top-0 left-0 w-full h-full"
          style={{
            cursor: activeTool === 'select' && isHoveringSelected ? 'move' :
              (activeTool === 'select' ? 'pointer' :
                (activeTool !== 'none' ? 'crosshair' : 'default')),
            pointerEvents: activeTool !== 'none' ? 'auto' : 'none',
            zIndex: 100,
            touchAction: 'none', // Prevent touch scrolling
          }}
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            handleMouseDown(e.nativeEvent);
          }}
          onMouseMove={(e) => {
            e.stopPropagation();
            handleMouseMove(e.nativeEvent);
          }}
          onMouseUp={(e) => {
            e.preventDefault();
            e.stopPropagation();
            handleMouseUp();
          }}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
        />
        {activeTool !== 'none' && (
          <div className="absolute top-2 right-2 bg-blue-50 border border-blue-200 rounded px-3 py-2 text-sm" style={{ zIndex: 200 }}>
            <strong>Drawing Mode:</strong> {activeTool}
            <button
              onClick={() => setActiveTool('none')}
              className="ml-2 text-blue-600 hover:text-blue-800 underline"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
