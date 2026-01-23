import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
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
import type { Point } from '../hooks/useChartDrawings';
import { format } from 'date-fns';
import { TextInputDialog } from './TextInputDialog';

export function AdvancedChart() {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const [chart, setChart] = useState<any>(null);
  const [series, setSeries] = useState<any>(null);
  const [volumeSeries, setVolumeSeries] = useState<any>(null);
  const markersPrimitiveRef = useRef<any>(null);
  const indicatorSeriesRef = useRef<Map<string, any>>(new Map());

  const [activeTool, setActiveTool] = useState<DrawingTool>('none');
  const [activeIndicators, setActiveIndicators] = useState<Indicator[]>(['ema21', 'pivotPoints']);

  const [isTextDialogOpen, setIsTextDialogOpen] = useState(false);
  const [pendingTextPoint, setPendingTextPoint] = useState<Point | null>(null);
  const [pendingCalloutPoints, setPendingCalloutPoints] = useState<{ p1: Point, p2: Point } | null>(null);

  const candles = useSessionStore((s) => s.candles);
  const currentIndex = useSessionStore((s) => s.currentIndex);
  const trades = useSessionStore((s) => s.trades);

  const visibleCandles = useMemo(() =>
    candles.slice(0, currentIndex + 1),
    [candles, currentIndex]
  );

  const isFirstLoadRef = useRef(true);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const handleTextToolTrigger = useCallback((point: Point) => {
    setPendingTextPoint(point);
    setPendingCalloutPoints(null);
    setIsTextDialogOpen(true);
  }, []);

  const handleCalloutTrigger = useCallback((p1: Point, p2: Point) => {
    setPendingTextPoint(p2);
    setPendingCalloutPoints({ p1, p2 });
    setIsTextDialogOpen(true);
  }, []);

  const {
    clearDrawings,
    addTextDrawing,
    addCalloutDrawing,
    deleteSelectedDrawing,
    selectedDrawingId,
    isHoveringSelected,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
  } = useChartDrawings({
    canvasRef,
    activeTool,
    onToolComplete: () => { /* No-op: keep tool active until reset */ },
    chartApi: chart,
    seriesApi: series,
    onTextToolTrigger: handleTextToolTrigger,
    onCalloutTrigger: handleCalloutTrigger,
  });

  const handleTextSubmit = (text: string) => {
    if (pendingCalloutPoints) {
      addCalloutDrawing(pendingCalloutPoints.p1, pendingCalloutPoints.p2, text);
    } else if (pendingTextPoint) {
      addTextDrawing(pendingTextPoint, text);
    }
    setPendingTextPoint(null);
    setPendingCalloutPoints(null);
  };

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

    setChart(chart);
    setSeries(candleSeries);
    setVolumeSeries(volumeSeries);
    markersPrimitiveRef.current = markersPrimitive;

    const handleResize = () => {
      if (chartContainerRef.current && chart) {
        chart.applyOptions({
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
    if (!series) return;

    const candleData = visibleCandles.map((c: any) => ({
      time: c.timestamp as any,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    const volumeData = visibleCandles.map((c: any) => ({
      time: c.timestamp as any,
      value: c.volume,
      color: c.close >= c.open ? '#26a69a40' : '#ef535040',
    }));

    series.setData(candleData);
    if (volumeSeries) {
      volumeSeries.setData(volumeData);
    }

    if (chart && visibleCandles.length > 0) {
      const timeScale = chart.timeScale();
      if (isFirstLoadRef.current) {
        timeScale.fitContent();
        isFirstLoadRef.current = false;
      }
    }
  }, [visibleCandles, series, volumeSeries, chart]);

  // Reset on new data
  useEffect(() => {
    isFirstLoadRef.current = true;
  }, [candles.length]);

  // Update indicator line series
  useEffect(() => {
    if (!chart || visibleCandles.length === 0) return;

    // Clear old indicator series (LineSeries only)
    indicatorSeriesRef.current.forEach((s) => {
      chart.removeSeries(s);
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
        const lineSeries = chart.addSeries(LineSeries, {
          color,
          lineWidth: 2,
        });
        lineSeries.setData(data);
        indicatorSeriesRef.current.set(indicator, lineSeries);
      }
    });
  }, [activeIndicators, visibleCandles, chart]);

  // Update markers (Trades and Pivot Points)
  useEffect(() => {
    if (!markersPrimitiveRef.current || visibleCandles.length === 0) return;

    const allMarkers: any[] = [];

    // 1. Add Trade Markers
    trades.forEach((trade) => {
      if (trade.timestamp <= visibleCandles[visibleCandles.length - 1].timestamp) {
        const isMs = trade.timestamp > 1e11;
        const date = new Date(isMs ? trade.timestamp : trade.timestamp * 1000);

        // Use UTC methods to ensure the label matches the chart's time scale (which usually interprets unix as UTC)
        const hours = date.getUTCHours();
        const minutes = date.getUTCMinutes();
        const seconds = date.getUTCSeconds();

        // Format as HH:mm if it has time, or dd MMM if it's a daily candle (midnight)
        const timeStr = hours === 0 && minutes === 0 && seconds === 0
          ? `${date.getUTCDate()} ${date.toLocaleString('default', { month: 'short', timeZone: 'UTC' })}`
          : `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;

        allMarkers.push({
          time: trade.timestamp as any,
          position: trade.type === 'BUY' ? 'belowBar' : 'aboveBar',
          color: trade.type === 'BUY' ? '#26a69a' : '#ef5350',
          shape: trade.type === 'BUY' ? 'arrowUp' : 'arrowDown',
          text: `${trade.type === 'BUY' ? 'B' : 'S'}@${trade.price.toFixed(2)} [${timeStr}]`,
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

  const handleTakeScreenshot = () => {
    if (!chart || !canvasRef.current) return;

    const chartCanvas = chart.takeScreenshot();
    if (!chartCanvas) return;

    const combinedCanvas = document.createElement('canvas');
    combinedCanvas.width = chartCanvas.width;
    combinedCanvas.height = chartCanvas.height;
    const ctx = combinedCanvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(chartCanvas, 0, 0);
    ctx.drawImage(canvasRef.current, 0, 0, combinedCanvas.width, combinedCanvas.height);

    const currentCandle = useSessionStore.getState().getCurrentCandle();
    let filename = 'chart-screenshot';
    if (currentCandle) {
      const ts = currentCandle.timestamp as number;
      const date = new Date(ts > 1e11 ? ts : ts * 1000);
      filename = format(date, 'dd-MM-yyyy');
    }

    const link = document.createElement('a');
    link.download = `${filename}.png`;
    link.href = combinedCanvas.toDataURL('image/png');
    link.click();
  };

  // Set up canvas size when chart is ready
  useEffect(() => {
    if (!chartContainerRef.current || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const container = chartContainerRef.current;

    const resizeCanvas = () => {
      const rect = container.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
    };

    setTimeout(resizeCanvas, 100);
    window.addEventListener('resize', resizeCanvas);
    return () => window.removeEventListener('resize', resizeCanvas);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedDrawingId) {
        e.preventDefault();
        deleteSelectedDrawing();
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        setActiveTool('select');
        return;
      }

      const toolMap: { [key: string]: DrawingTool } = {
        'v': 'select',
        '1': 'select',
        '2': 'freehand',
        '3': 'trendline',
        '4': 'horizontal',
        '5': 'rectangle',
        '6': 'fibonacci',
        '7': 'riskReward',
        '8': 'text',
        '9': 'callout',
      };

      const key = e.key.toLowerCase();
      if (toolMap[key]) {
        e.preventDefault();
        const newTool = toolMap[key];
        setActiveTool(activeTool === newTool ? 'none' : newTool);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedDrawingId, activeTool, deleteSelectedDrawing]);

  return (
    <div
      className="w-full h-full flex flex-col relative"
      onContextMenu={(e) => {
        e.preventDefault();
        setActiveTool('select');
      }}
    >
      <ChartToolbar
        activeTool={activeTool}
        onToolChange={setActiveTool}
        activeIndicators={activeIndicators}
        onIndicatorToggle={handleIndicatorToggle}
        onClearDrawings={handleClearDrawings}
        onDeleteSelected={deleteSelectedDrawing}
        onTakeScreenshot={handleTakeScreenshot}
        hasSelection={!!selectedDrawingId}
      />

      <TextInputDialog
        isOpen={isTextDialogOpen}
        onClose={() => setIsTextDialogOpen(false)}
        onSubmit={handleTextSubmit}
        position={pendingTextPoint ? { x: pendingTextPoint.x, y: pendingTextPoint.y } : null}
      />

      <div
        className="relative flex-1"
        style={{ width: '100%', minHeight: '0' }}
        onMouseDownCapture={(e) => {
          if (activeTool === 'none') return;
          const rect = e.currentTarget.getBoundingClientRect();
          const x = e.clientX - rect.left;
          if (x > rect.width - 40) return; // Ignore clicks strictly on the price scale area

          const handled = handleMouseDown(e.nativeEvent);
          if (handled) {
            e.stopPropagation();
          }
        }}
        onMouseMove={(e) => {
          if (activeTool === 'none') return;
          handleMouseMove(e.nativeEvent);
        }}
        onMouseUp={() => {
          if (activeTool === 'none') return;
          handleMouseUp();
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
            pointerEvents: 'auto',
            zIndex: 1,
          }}
        />
        <canvas
          ref={canvasRef}
          className="absolute top-0 left-0 w-full h-full"
          style={{
            cursor: activeTool === 'select' && isHoveringSelected ? 'move' :
              (activeTool === 'select' ? 'pointer' :
                (activeTool !== 'none' ? 'crosshair' : 'default')),
            pointerEvents: 'none',
            zIndex: 100,
            touchAction: 'none',
          }}
        />
        {activeTool !== 'select' && activeTool !== 'none' && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-blue-600 text-white rounded-full px-6 py-1.5 shadow-xl text-sm font-medium animate-in slide-in-from-top-4 flex items-center gap-4" style={{ zIndex: 200 }}>
            <span>Drawing: <span className="capitalize">{activeTool}</span></span>
            <span className="text-[10px] bg-blue-500 px-2 py-0.5 rounded uppercase">Right-Click to Exit</span>
          </div>
        )}
      </div>
    </div>
  );
}
