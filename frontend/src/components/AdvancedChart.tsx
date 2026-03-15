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
import type { DrawingTool } from './ChartToolbar';
import type { Indicator } from './ChartToolbar';
import { calculateSMA, calculateEMA, calculatePivotPoints, calculateAlBrooks } from '../utils/indicators';
import { resampleCandles } from '../utils/resampler';
import { useChartDrawings } from '../hooks/useChartDrawings';
import type { Point } from '../hooks/useChartDrawings';
import { format } from 'date-fns';
import { TextInputDialog } from './TextInputDialog';
import { uploadScreenshot } from '../services/api';
import { useNotificationStore } from '../stores/notificationStore';
import { ScreenshotSaveDialog } from './ScreenshotSaveDialog';

export interface ChartCallbacks {
  clearDrawings?: () => void;
  deleteSelected?: () => void;
  takeScreenshot?: () => void;
  downloadScreenshot?: () => void;
  hasSelection?: boolean;
  isUploadingScreenshot?: boolean;
}

export function AdvancedChart({
  isSecondary = false,
  onRegisterCallbacks,
}: {
  isSecondary?: boolean;
  onRegisterCallbacks?: (cbs: ChartCallbacks) => void;
}) {
  const chartId = isSecondary ? 'secondary' : 'primary';
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const [chart, setChart] = useState<any>(null);
  const [series, setSeries] = useState<any>(null);
  const [volumeSeries, setVolumeSeries] = useState<any>(null);
  const markersPrimitiveRef = useRef<any>(null);
  const indicatorSeriesRef = useRef<Map<string, any>>(new Map());

  // Shared state from store
  const activeChartId = useSessionStore((s) => s.activeChartId);
  const setActiveChartId = useSessionStore((s) => s.setActiveChartId);
  const sharedActiveTool = useSessionStore((s) => s.sharedActiveTool) as DrawingTool;
  const setSharedActiveTool = useSessionStore((s) => s.setSharedActiveTool);
  const sharedActiveIndicators = useSessionStore((s) => s.sharedActiveIndicators) as Indicator[];
  const showSecondaryChart = useSessionStore((s) => s.showSecondaryChart);

  // The chart is "active" if it's currently selected (or in single-chart mode, always active)
  const isActiveChart = !showSecondaryChart || activeChartId === chartId;

  // Local alias for the active tool (so existing code that uses activeTool still works)
  const activeTool = isActiveChart ? sharedActiveTool : 'none' as DrawingTool;
  const activeIndicators = sharedActiveIndicators;
  const setActiveTool = (tool: DrawingTool) => {
    setActiveChartId(chartId);
    setSharedActiveTool(tool);
  };

  const [isTextDialogOpen, setIsTextDialogOpen] = useState(false);
  const [pendingTextPoint, setPendingTextPoint] = useState<Point | null>(null);
  const [pendingCalloutPoints, setPendingCalloutPoints] = useState<{ p1: Point, p2: Point } | null>(null);
  const [isUploadingScreenshot, setIsUploadingScreenshot] = useState(false);

  const candles = useSessionStore((s) => s.candles);
  const currentIndex = useSessionStore((s) => s.currentIndex);
  const trades = useSessionStore((s) => s.trades);
  const saveCurrentSession = useSessionStore((s) => s.saveCurrentSession);
  const saveRemoteSession = useSessionStore((s) => s.saveRemoteSession);
  const showMarkers = useSessionStore((s) => s.showMarkers);
  const useAtrForSignals = useSessionStore((s) => s.useAtrForSignals);
  const showPivotRR = useSessionStore((s) => s.showPivotRR);
  const secondaryTimeframe = useSessionStore((s) => s.secondaryTimeframe);

  const visibleCandles = useMemo(() => {
    const primaryVisible = candles.slice(0, currentIndex + 1);
    if (isSecondary && secondaryTimeframe) {
      // Return HTF candles formed by the primary candles up to current LTF index
      return resampleCandles(primaryVisible, parseInt(secondaryTimeframe));
    }
    return primaryVisible;
  }, [candles, currentIndex, isSecondary, secondaryTimeframe]);

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

  // Callback to render pivot risk-reward lines
  const handleCustomRender = useCallback((ctx: CanvasRenderingContext2D) => {
    if (!chart || !series || visibleCandles.length === 0) return;
    if (!activeIndicators.includes('pivotPoints') || !showMarkers || !showPivotRR) return;

    // Calculate pivots
    const allPivots = calculatePivotPoints(visibleCandles);
    if (allPivots.length === 0) return;

    // Get the most recent pivot
    const recentPivot = allPivots[allPivots.length - 1];

    // Find the candle corresponding to this pivot to get the entry price (close)
    const pivotCandle = visibleCandles.find(c => c.timestamp === recentPivot.time);
    if (!pivotCandle) return;

    // Convert price and time to canvas coordinates
    const timeScale = chart.timeScale();

    const pivotX = timeScale.timeToCoordinate(recentPivot.time);
    if (pivotX === null) return;

    // Determine entry price (close of the signal candle) and SL distance
    const entryPrice = pivotCandle.close;
    const slDistance = recentPivot.slDistance;

    let slPrice: number;
    let direction: 'long' | 'short';

    if (recentPivot.type === 'bullish') {
      // For bullish pivot: entry at candle close, SL below
      slPrice = entryPrice - slDistance;
      direction = 'long';
    } else {
      // For bearish pivot: entry at candle close, SL above
      slPrice = entryPrice + slDistance;
      direction = 'short';
    }

    // Calculate target prices based on risk (slDistance)
    const tp1Price = direction === 'long' ? entryPrice + slDistance : entryPrice - slDistance;
    const tp2Price = direction === 'long' ? entryPrice + (slDistance * 2) : entryPrice - (slDistance * 2);
    const tp3Price = direction === 'long' ? entryPrice + (slDistance * 3) : entryPrice - (slDistance * 3);

    // Convert prices to Y coordinates using series API
    const entryY = series.priceToCoordinate(entryPrice);
    const slY = series.priceToCoordinate(slPrice);
    const tp1Y = series.priceToCoordinate(tp1Price);
    const tp2Y = series.priceToCoordinate(tp2Price);
    const tp3Y = series.priceToCoordinate(tp3Price);

    if (entryY === null || slY === null || tp1Y === null || tp2Y === null || tp3Y === null) return;

    // Get canvas dimensions
    const canvasWidth = ctx.canvas.width;
    const startX = Math.max(0, pivotX);
    const endX = canvasWidth - 60; // Leave space for labels

    // Helper function to draw a horizontal line with label
    const drawHorizontalLine = (
      y: number,
      color: string,
      label: string,
      lineWidth: number = 2,
      dashed: boolean = false
    ) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.setLineDash(dashed ? [5, 5] : []);
      ctx.beginPath();
      ctx.moveTo(startX, y);
      ctx.lineTo(endX, y);
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw label
      ctx.font = 'bold 11px Inter, sans-serif';
      ctx.fillStyle = color;
      ctx.textAlign = 'left';
      ctx.fillText(label, endX + 5, y + 4);
    };

    // Draw Entry Line
    drawHorizontalLine(entryY, '#FFC107', 'ENTRY', 2, false);

    // Draw Stop Loss Line
    drawHorizontalLine(slY, '#F44336', 'SL', 2, false);

    // Draw Target Lines
    drawHorizontalLine(tp1Y, '#4CAF50', '1:1', 1.5, true);
    drawHorizontalLine(tp2Y, '#4CAF50', '1:2', 1.5, true);
    drawHorizontalLine(tp3Y, '#2E7D32', '1:3', 1.5, true);

    // Reset context
    ctx.textAlign = 'start';
  }, [chart, series, visibleCandles, activeIndicators, showMarkers, showPivotRR]);

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
    renderCanvas,
  } = useChartDrawings({
    canvasRef,
    activeTool,
    onToolComplete: () => { /* No-op: keep tool active until reset */ },
    chartApi: chart,
    seriesApi: series,
    onTextToolTrigger: handleTextToolTrigger,
    onCalloutTrigger: handleCalloutTrigger,
    onCustomRender: handleCustomRender,
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
      localization: {
        timeFormatter: (time: any) => {
          const date = new Date(time * 1000);
          const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
          const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

          // Use UTC methods to match the chart's time interpretation
          const dayName = dayNames[date.getUTCDay()];
          const day = date.getUTCDate();
          const month = monthNames[date.getUTCMonth()];
          const year = date.getUTCFullYear();
          const hours = date.getUTCHours().toString().padStart(2, '0');
          const minutes = date.getUTCMinutes().toString().padStart(2, '0');

          // Format: "Mon, 15 Jan 2024, 09:30"
          const formatted = `${dayName}, ${day} ${month} ${year}, ${hours}:${minutes}`;
          return formatted;
        },
      },
      crosshair: {
        mode: 0, // Normal crosshair - follows mouse pointer exactly (not magnet mode)
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

    // Use ResizeObserver for more reliable resizing than window.resize
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (chart) {
          chart.applyOptions({ width, height });
        }
      }
    });

    if (chartContainerRef.current) {
      resizeObserver.observe(chartContainerRef.current);
    }

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      // Clear all handles associated with this chart instance
      indicatorSeriesRef.current.clear();
      markersPrimitiveRef.current = null;
    };
  }, []); // Only run once on mount

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

      // Auto-scroll logic: 
      // If we are strictly "first loading" the data, fit content.
      // If we are appending data (playback), we generally want to stay on the latest bar (right edge).
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
    if (!chart) return;

    // Clear old indicator series (LineSeries only)
    // We always clear them before re-adding to avoid duplication or stale series
    indicatorSeriesRef.current.forEach((s) => {
      if (s) {
        try {
          chart.removeSeries(s);
        } catch (e) {
          // If series was already removed or chart state is weird, ignore
          console.debug('Skip removing internal series:', e);
        }
      }
    });
    indicatorSeriesRef.current.clear();

    if (visibleCandles.length === 0) return;

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
    if (showMarkers) {
      trades.forEach((trade) => {
        let markerTime = trade.timestamp;
        if (isSecondary && secondaryTimeframe) {
          const tfSeconds = parseInt(secondaryTimeframe) * 60;
          markerTime = Math.floor(trade.timestamp / tfSeconds) * tfSeconds;
        }

        if (markerTime <= visibleCandles[visibleCandles.length - 1].timestamp) {
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
            time: markerTime as any,
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
        allPivots.forEach((p, index) => {
          const isLast = index === allPivots.length - 1;
          const gapTooltip = isLast ? ` SL:${p.slDistance}` : '';
          const label = p.trendLabel || '';

          allMarkers.push({
            time: p.time as any,
            position: p.type === 'bullish' ? 'belowBar' : 'aboveBar',
            color: p.type === 'bullish' ? '#26a69a' : '#ef5350',
            shape: p.type === 'bullish' ? 'arrowUp' : 'arrowDown',
            text: `${label}${gapTooltip}`,
            size: 1,
          });
        });
      }
    }

    // 3. Add Al Brooks Markers if active
    if (showMarkers && activeIndicators.includes('alBrooks')) {
      const alBrooksSignals = calculateAlBrooks(visibleCandles, useAtrForSignals, 1.0);
      alBrooksSignals.forEach((s) => {
        let color = '#00BCD4'; // Default aqua
        const signal = s.signal;

        if (signal === 'H1') color = '#00FFFF';
        else if (signal === 'H2') color = '#008000';
        else if (signal === 'H3') color = '#00FF00';
        else if (signal === 'L1') color = '#FFA500';
        else if (signal === 'L2') color = '#FF0000';
        else if (signal === 'L3') color = '#FF00FF';

        allMarkers.push({
          time: s.time as any,
          position: signal.startsWith('H') ? 'belowBar' : 'aboveBar',
          color: color,
          shape: signal.startsWith('H') ? 'arrowUp' : 'arrowDown',
          text: signal,
          size: 1,
        });
      });
    }

    allMarkers.sort((a, b) => (a.time as number) - (b.time as number));
    markersPrimitiveRef.current.setMarkers(allMarkers);
  }, [activeIndicators, visibleCandles, trades, showMarkers, useAtrForSignals]);

  const handleClearDrawings = useCallback(() => {
    clearDrawings();
    setSharedActiveTool('none');
  }, [clearDrawings, setSharedActiveTool]);


  const [isScreenshotDialogOpen, setIsScreenshotDialogOpen] = useState(false);
  const [screenshotDefaultName, setScreenshotDefaultName] = useState('');
  const [pendingScreenshotData, setPendingScreenshotData] = useState<string | null>(null);

  const notify = useNotificationStore((s: any) => s.notify);

  const getScreenshotData = () => {
    if (!chart || !canvasRef.current) return null;

    const chartCanvas = chart.takeScreenshot();
    if (!chartCanvas) return null;

    const combinedCanvas = document.createElement('canvas');
    combinedCanvas.width = chartCanvas.width;
    combinedCanvas.height = chartCanvas.height;
    const ctx = combinedCanvas.getContext('2d');
    if (!ctx) return null;

    ctx.drawImage(chartCanvas, 0, 0);
    ctx.drawImage(canvasRef.current, 0, 0, combinedCanvas.width, combinedCanvas.height);

    return combinedCanvas.toDataURL('image/png');
  };

  const getScreenshotDefaultName = () => {
    const currentCandle = useSessionStore.getState().getCurrentCandle();
    let defaultBase = 'chart-screenshot';
    let dateStr = '';

    if (currentCandle) {
      const ts = currentCandle.timestamp as number;
      const date = new Date(ts > 1e11 ? ts : ts * 1000);
      dateStr = format(date, 'dd-MM-yyyy');
    }

    const tradesForDay = trades.filter(t => {
      const tDate = new Date(t.timestamp > 1e11 ? t.timestamp : t.timestamp * 1000);
      return format(tDate, 'dd-MM-yyyy') === dateStr;
    });

    const tradeCount = tradesForDay.length;
    const countToUse = tradeCount > 0 ? tradeCount : 1;
    return dateStr ? `${dateStr}_Trade-${countToUse}` : defaultBase;
  };

  const handleTakeScreenshot = () => {
    const base64Image = getScreenshotData();
    if (!base64Image) return;

    setScreenshotDefaultName(getScreenshotDefaultName());
    setPendingScreenshotData(base64Image);
    setIsScreenshotDialogOpen(true);
  };

  const handleDownloadScreenshot = () => {
    const base64Image = getScreenshotData();
    if (!base64Image) return;

    const filename = getScreenshotDefaultName();
    const link = document.createElement('a');
    link.download = `${filename}.png`;
    link.href = base64Image;
    link.click();
    notify('Screenshot downloaded locally', 'success');
  };

  // Register this chart's callbacks with the parent whenever active state changes
  // (placed after all handler definitions to avoid "used before declaration" errors)
  useEffect(() => {
    if (!isActiveChart || !onRegisterCallbacks) return;
    onRegisterCallbacks({
      clearDrawings: handleClearDrawings,
      deleteSelected: deleteSelectedDrawing,
      takeScreenshot: handleTakeScreenshot,
      downloadScreenshot: handleDownloadScreenshot,
      hasSelection: !!selectedDrawingId,
      isUploadingScreenshot,
    });
  }, [isActiveChart, onRegisterCallbacks, handleClearDrawings, deleteSelectedDrawing,
    handleTakeScreenshot, handleDownloadScreenshot, selectedDrawingId, isUploadingScreenshot]);

  const handleScreenshotSubmit = (name: string) => {
    if (!pendingScreenshotData) return;

    setIsUploadingScreenshot(true);
    uploadScreenshot(pendingScreenshotData, `${name}.png`)
      .then(res => {
        if (res.link) {
          navigator.clipboard.writeText(res.link);
          notify('Screenshot uploaded and link copied!', 'success');

          // Auto-save session state
          saveCurrentSession();
          saveRemoteSession();

          setIsScreenshotDialogOpen(false);
          setPendingScreenshotData(null);
        }
      })
      .catch(err => {
        console.error('Failed to upload screenshot:', err);
        notify('Upload failed. Downloading locally.', 'error');

        // Fallback: download
        const link = document.createElement('a');
        link.download = `${name}.png`;
        link.href = pendingScreenshotData!;
        link.click();

        // Auto-save session state even on upload failure
        saveCurrentSession();
        saveRemoteSession();

        setIsScreenshotDialogOpen(false);
        setPendingScreenshotData(null);
      })
      .finally(() => {
        setIsUploadingScreenshot(false);
      });
  };

  // Set up canvas size when chart is ready
  useEffect(() => {
    if (!chartContainerRef.current || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const container = chartContainerRef.current;

    const resizeCanvasObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.scale(dpr, dpr);
        }
        // Force re-render after size change
        renderCanvas();
      }
    });

    resizeCanvasObserver.observe(container);
    return () => resizeCanvasObserver.disconnect();
  }, [renderCanvas]);

  // Keyboard shortcuts — only registered by the primary chart to avoid double-binding
  useEffect(() => {
    if (isSecondary) return; // Secondary chart doesn't own global keyboard shortcuts
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
        setSharedActiveTool(activeTool === newTool ? 'none' : newTool);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSecondary, selectedDrawingId, activeTool, deleteSelectedDrawing]);

  return (
    <div
      className="w-full h-full flex flex-col relative"
      onMouseDownCapture={() => {
        // When clicking on this chart, make it the active chart
        if (showSecondaryChart && activeChartId !== chartId) {
          setActiveChartId(chartId);
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        setActiveTool('select');
      }}
    >
      {/* Chart focus indicator in dual mode */}
      {showSecondaryChart && (
        <div
          className={`absolute inset-0 pointer-events-none z-50 rounded-sm transition-all duration-150 ${
            isActiveChart
              ? 'ring-2 ring-inset ring-blue-500'
              : 'ring-1 ring-inset ring-transparent'
          }`}
        />
      )}

      {/* Active chart label in dual mode */}
      {showSecondaryChart && (
        <div className={`absolute top-2 left-4 z-10 px-3 py-1.5 rounded-lg border shadow-sm flex items-center gap-2 transition-all duration-150 ${
          isActiveChart
            ? 'bg-blue-600 text-white border-blue-700'
            : 'bg-white/80 backdrop-blur-sm text-gray-700 border-gray-200'
        }`}>
          <span className="text-xs font-bold">
            {isSecondary ? `HTF: ${secondaryTimeframe}m` : 'LTF Chart'}
          </span>
          {isActiveChart && (
            <div className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
          )}
        </div>
      )}

      <TextInputDialog
        isOpen={isTextDialogOpen}
        onClose={() => setIsTextDialogOpen(false)}
        onSubmit={handleTextSubmit}
        position={pendingTextPoint ? { x: pendingTextPoint.x, y: pendingTextPoint.y } : null}
      />

      <ScreenshotSaveDialog
        isOpen={isScreenshotDialogOpen}
        onClose={() => setIsScreenshotDialogOpen(false)}
        onSubmit={handleScreenshotSubmit}
        defaultName={screenshotDefaultName}
        isUploading={isUploadingScreenshot}
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
          if (!isActiveChart || activeTool === 'none') return;
          handleMouseMove(e.nativeEvent);
        }}
        onMouseUp={() => {
          if (!isActiveChart || activeTool === 'none') return;
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
