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
import { useLiveStore } from '../stores/liveStore';
import type { DrawingTool } from './ChartToolbar';
import type { Indicator } from './ChartToolbar';
import { calculateSMA, calculateEMA, calculatePivotPoints, calculateAlBrooks } from '../utils/indicators';
import { resampleCandles } from '../utils/resampler';
import { useChartDrawings } from '../hooks/useChartDrawings';
import type { Point } from '../hooks/useChartDrawings';
import { format } from 'date-fns';
import { TextInputDialog } from './TextInputDialog';
import { uploadScreenshot, fetchCandles } from '../services/api';
import { useNotificationStore } from '../stores/notificationStore';
import { ScreenshotSaveDialog } from './ScreenshotSaveDialog';
import type { Trade, LegSegment } from '../types';
import { formatCurrency } from '../utils/formatters';
import { exitReasonBadge } from '../utils/tradeAnalysis';
import { X } from 'lucide-react';

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
  const lastCandleRef = useRef<any>(null);
  const correctionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevCumulativeVolumeRef = useRef<number>(0);
  const seenFirstTickRef = useRef<boolean>(false);

  // Shared state from store
  const activeChartId = useSessionStore((s) => s.activeChartId);
  const setActiveChartId = useSessionStore((s) => s.setActiveChartId);
  const sharedActiveTool = useSessionStore((s) => s.sharedActiveTool) as DrawingTool;
  const setSharedActiveTool = useSessionStore((s) => s.setSharedActiveTool);
  const primaryIndicators = useSessionStore((s) => s.primaryIndicators) as Indicator[];
  const secondaryIndicators = useSessionStore((s) => s.secondaryIndicators) as Indicator[];
  const showSecondaryChart = useSessionStore((s) => s.showSecondaryChart);

  // The chart is "active" if it's currently selected (or in single-chart mode, always active)
  const isActiveChart = !showSecondaryChart || activeChartId === chartId;

  // Local alias for the active tool (so existing code that uses activeTool still works)
  const activeTool = isActiveChart ? sharedActiveTool : 'none' as DrawingTool;
  const activeIndicators = isSecondary ? secondaryIndicators : primaryIndicators;
  const setActiveTool = useCallback((tool: DrawingTool) => {
    setActiveChartId(chartId);
    setSharedActiveTool(tool);
  }, [setActiveChartId, chartId, setSharedActiveTool]);

  const [isTextDialogOpen, setIsTextDialogOpen] = useState(false);
  const [pendingTextPoint, setPendingTextPoint] = useState<Point | null>(null);
  const [pendingCalloutPoints, setPendingCalloutPoints] = useState<{ p1: Point, p2: Point } | null>(null);
  const [isUploadingScreenshot, setIsUploadingScreenshot] = useState(false);
  const [execPopup, setExecPopup] = useState<{ x: number; y: number; trades: Trade[] } | null>(null);
  // A leg/pullback segment the user clicked in the Trade Record popup's Leg Sequence strip —
  // highlighted on the chart (canvas band over its candles) and expanded to its tracked values.
  const [selectedSegment, setSelectedSegment] = useState<LegSegment | null>(null);

  const candles = useSessionStore((s) => s.candles);
  const currentIndex = useSessionStore((s) => s.currentIndex);
  const trades = useSessionStore((s) => s.trades);
  const saveCurrentSession = useSessionStore((s) => s.saveCurrentSession);
  const saveRemoteSession = useSessionStore((s) => s.saveRemoteSession);
  const primaryShowMarkers = useSessionStore((s) => s.primaryShowMarkers);
  const secondaryShowMarkers = useSessionStore((s) => s.secondaryShowMarkers);
  const showMarkers = isSecondary ? secondaryShowMarkers : primaryShowMarkers;
  const useAtrForSignals = useSessionStore((s) => s.useAtrForSignals);
  const showPivotRR = useSessionStore((s) => s.showPivotRR);
  const secondaryTimeframe = useSessionStore((s) => s.secondaryTimeframe);
  const secondaryCandles = useSessionStore((s) => s.secondaryCandles);
  const isLiveMode = useSessionStore((s) => s.isLiveMode);
  const sessionConfig = useSessionStore((s) => s.sessionConfig);
  const scrollToTimestamp = useSessionStore((s) => s.scrollToTimestamp);
  const highlightTimestamp = useSessionStore((s) => s.highlightTimestamp);

  const visibleCandles = useMemo(() => {
    // In live mode, show all candles (don't slice by currentIndex)
    const primaryVisible = isLiveMode ? candles : candles.slice(0, currentIndex + 1);

    if (isSecondary && secondaryTimeframe) {
      // Live mode: use pre-fetched HTF candles (3000 candles from API)
      if (isLiveMode && secondaryCandles.length > 0) return secondaryCandles;

      // Backtest mode: resample on-the-fly from primary candles
      let tfMinutes = parseInt(secondaryTimeframe);
      if (secondaryTimeframe === '1D') tfMinutes = 1440;
      return resampleCandles(primaryVisible, tfMinutes);
    }
    return primaryVisible;
  }, [candles, currentIndex, isSecondary, secondaryTimeframe, isLiveMode, secondaryCandles]);

  const isFirstLoadRef = useRef(true);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const execPopupRef = useRef<HTMLDivElement | null>(null);

  // Perf: skip indicator/marker rebuilds when only the live price updated (no new candle)
  const lastIndicatorCandleCountRef = useRef(0);
  const lastIndicatorTimestampRef = useRef(0);
  const lastIndicatorKeyRef = useRef('');
  const lastMarkerCandleCountRef = useRef(0);
  const lastMarkerTradeCountRef = useRef(0);
  const lastMarkerConfigKeyRef = useRef('');

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

  // Memoize heavy calculations
  const memoizedPivots = useMemo(() => {
    if (!activeIndicators.includes('pivotPoints') || visibleCandles.length === 0) return [];
    return calculatePivotPoints(visibleCandles);
  }, [visibleCandles, activeIndicators]);

  const memoizedAlBrooks = useMemo(() => {
    if (!activeIndicators.includes('alBrooks') || visibleCandles.length === 0) return [];
    return calculateAlBrooks(visibleCandles, useAtrForSignals, 1.0);
  }, [visibleCandles, activeIndicators, useAtrForSignals]);

  // Callback to render additional overlays on the chart canvas
  const handleCustomRender = useCallback((ctx: CanvasRenderingContext2D) => {
    if (!chart || !series || visibleCandles.length === 0) return;

    // 1. Draw Pivot Risk-Reward Lines
    if (activeIndicators.includes('pivotPoints') && showMarkers && showPivotRR) {
      const allPivots = memoizedPivots;
      if (allPivots.length > 0) {
        const recentPivot = allPivots[allPivots.length - 1];
        const pivotCandle = visibleCandles.find(c => c.timestamp === recentPivot.time);

        if (pivotCandle) {
          const timeScale = chart.timeScale();
          const pivotX = timeScale.timeToCoordinate(recentPivot.time);

          if (pivotX !== null) {
            const entryPrice = pivotCandle.close;
            const slDistance = recentPivot.slDistance;
            let slPrice: number;
            let direction: 'long' | 'short';

            if (recentPivot.type === 'bullish') {
              slPrice = entryPrice - slDistance;
              direction = 'long';
            } else {
              slPrice = entryPrice + slDistance;
              direction = 'short';
            }

            const tp1Price = direction === 'long' ? entryPrice + slDistance : entryPrice - slDistance;
            const tp2Price = direction === 'long' ? entryPrice + (slDistance * 2) : entryPrice - (slDistance * 2);
            const tp3Price = direction === 'long' ? entryPrice + (slDistance * 3) : entryPrice - (slDistance * 3);

            const entryY = series.priceToCoordinate(entryPrice);
            const slY = series.priceToCoordinate(slPrice);
            const tp1Y = series.priceToCoordinate(tp1Price);
            const tp2Y = series.priceToCoordinate(tp2Price);
            const tp3Y = series.priceToCoordinate(tp3Price);

            if (entryY !== null && slY !== null && tp1Y !== null && tp2Y !== null && tp3Y !== null) {
              const canvasWidth = ctx.canvas.width;
              const startX = Math.max(0, pivotX) / (window.devicePixelRatio || 1);
              const endX = (canvasWidth / (window.devicePixelRatio || 1)) - 60;

              const drawHorizontalLine = (y: number, color: string, label: string, lineWidth: number = 2, dashed: boolean = false) => {
                ctx.save();
                ctx.strokeStyle = color;
                ctx.lineWidth = lineWidth;
                ctx.setLineDash(dashed ? [5, 5] : []);
                ctx.beginPath();
                ctx.moveTo(startX, y);
                ctx.lineTo(endX, y);
                ctx.stroke();

                ctx.font = 'bold 11px Inter, sans-serif';
                ctx.fillStyle = color;
                ctx.textAlign = 'left';
                ctx.fillText(label, endX + 5, y + 4);
                ctx.restore();
              };

              drawHorizontalLine(entryY, '#FFC107', 'ENTRY');
              drawHorizontalLine(slY, '#F44336', 'SL');
              drawHorizontalLine(tp1Y, '#4CAF50', '1:1', 1.5, true);
              drawHorizontalLine(tp2Y, '#4CAF50', '1:2', 1.5, true);
              drawHorizontalLine(tp3Y, '#2E7D32', '1:3', 1.5, true);
            }
          }
        }
      }
    }

    // 2. Draw Sync Crosshair from other chart
    const crosshairPosition = useSessionStore.getState().crosshairPosition;
    if (crosshairPosition.time && crosshairPosition.sourceChartId !== chartId) {
      const timeScale = chart.timeScale();
      let syncTime = crosshairPosition.time;

      // Align time for HTF chart if incoming time is from LTF (session-aligned, same as resampler)
      if (isSecondary && secondaryTimeframe) {
        let tfMinutes = parseInt(secondaryTimeframe);
        if (secondaryTimeframe === '1D') tfMinutes = 1440;
        const timeframeSeconds = tfMinutes * 60;
        const IST_OFFSET = 19800;
        const SESSION_START = 9 * 3600 + 15 * 60;
        const tsIst = syncTime + IST_OFFSET;
        const timeInDay = tsIst % 86400;
        const istDayStart = tsIst - timeInDay;
        const sincOpen = timeInDay - SESSION_START;
        const bucketIdx = Math.max(0, Math.floor(sincOpen / timeframeSeconds));
        syncTime = (istDayStart + SESSION_START + bucketIdx * timeframeSeconds) - IST_OFFSET;
      }

      const x = timeScale.timeToCoordinate(syncTime as any);
      if (x !== null) {
        ctx.save();
        ctx.strokeStyle = '#2196F3'; // Blue sync color
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, ctx.canvas.height);
        ctx.stroke();

        if (crosshairPosition.price) {
          const y = series.priceToCoordinate(crosshairPosition.price);
          if (y !== null) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(ctx.canvas.width, y);
            ctx.stroke();
          }
        }
        ctx.restore();
      }
    }

    // 3. Highlight the candle jumped to from Trade History's "Jump to entry" eye icon
    if (!isSecondary && highlightTimestamp !== null) {
      const target = visibleCandles.find((c) => c.timestamp === highlightTimestamp);
      if (target) {
        const timeScale = chart.timeScale();
        const x = timeScale.timeToCoordinate(target.timestamp as any);
        const highY = series.priceToCoordinate(target.high);
        if (x !== null) {
          const barSpacing = (timeScale.options() as any).barSpacing || 6;
          const halfWidth = barSpacing / 2 + 3;

          ctx.save();
          ctx.fillStyle = 'rgba(255, 193, 7, 0.18)';
          ctx.fillRect(x - halfWidth, 0, halfWidth * 2, ctx.canvas.height);
          ctx.strokeStyle = '#FFC107';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.moveTo(x - halfWidth, 0);
          ctx.lineTo(x - halfWidth, ctx.canvas.height);
          ctx.moveTo(x + halfWidth, 0);
          ctx.lineTo(x + halfWidth, ctx.canvas.height);
          ctx.stroke();

          if (highY !== null) {
            const arrowTipY = highY - 8;
            ctx.fillStyle = '#B45309';
            ctx.beginPath();
            ctx.moveTo(x, arrowTipY);
            ctx.lineTo(x - 6, arrowTipY - 10);
            ctx.lineTo(x + 6, arrowTipY - 10);
            ctx.closePath();
            ctx.fill();

            ctx.font = 'bold 11px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('JUMPED HERE', x, arrowTipY - 14);
          }
          ctx.restore();
        }
      }
    }

    // 4. Highlight the leg/pullback segment clicked in the Trade Record popup — a translucent
    //    band across the segment's candles so its tracked values can be read against the bars.
    if (!isSecondary && selectedSegment) {
      const timeScale = chart.timeScale();
      const x1 = timeScale.timeToCoordinate(selectedSegment.startTime as any);
      const x2 = timeScale.timeToCoordinate(selectedSegment.endTime as any);
      if (x1 !== null && x2 !== null) {
        const barSpacing = (timeScale.options() as any).barSpacing || 6;
        const pad = barSpacing / 2 + 1;
        const left = Math.min(x1, x2) - pad;
        const right = Math.max(x1, x2) + pad;
        const bull = selectedSegment.direction === 'bull';
        const stroke = bull ? '#16a34a' : '#dc2626';
        const fill = bull ? 'rgba(22,163,74,0.12)' : 'rgba(220,38,38,0.12)';

        ctx.save();
        ctx.fillStyle = fill;
        ctx.fillRect(left, 0, right - left, ctx.canvas.height);
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 1.5;
        ctx.setLineDash(selectedSegment.kind === 'pullback' ? [5, 3] : []);
        ctx.strokeRect(left, 0, right - left, ctx.canvas.height);

        ctx.setLineDash([]);
        ctx.fillStyle = stroke;
        ctx.font = 'bold 10px Inter, sans-serif';
        ctx.textAlign = 'center';
        const label = `${selectedSegment.kind === 'pullback' ? 'PULLBACK' : 'LEG'} ${bull ? '▲' : '▼'} ${selectedSegment.barCount}b`;
        ctx.fillText(label, (left + right) / 2, 14);
        ctx.restore();
      }
    }
  }, [chart, series, visibleCandles, activeIndicators, showMarkers, showPivotRR, memoizedPivots, isSecondary, secondaryTimeframe, chartId, highlightTimestamp, selectedSegment]);

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
    scheduleRender,
    invalidateRectCache,
  } = useChartDrawings({
    canvasRef,
    activeTool,
    onToolComplete: () => { /* No-op: keep tool active until reset */ },
    chartApi: chart,
    seriesApi: series,
    onTextToolTrigger: handleTextToolTrigger,
    onCalloutTrigger: handleCalloutTrigger,
    onCustomRender: handleCustomRender,
    isSecondary,
  });

  // Redraw the canvas overlay and pan the selected Leg Sequence segment into view.
  useEffect(() => {
    if (isSecondary || !chart) return;
    scheduleRender();
    if (!selectedSegment) return;
    const ts = chart.timeScale();
    const fromIdx = visibleCandles.findIndex((c) => c.timestamp === selectedSegment.startTime);
    const toIdx = visibleCandles.findIndex((c) => c.timestamp === selectedSegment.endTime);
    if (fromIdx === -1 || toIdx === -1) return;
    const lo = Math.min(fromIdx, toIdx);
    const hi = Math.max(fromIdx, toIdx);
    const cur = ts.getVisibleLogicalRange();
    // Only recenter when the segment isn't already comfortably in view.
    if (!cur || lo < cur.from + 1 || hi > cur.to - 1) {
      const width = cur ? cur.to - cur.from : 60;
      const pad = Math.max((width - (hi - lo + 1)) / 2, 3);
      ts.setVisibleLogicalRange({ from: lo - pad, to: hi + pad });
    }
  }, [selectedSegment, chart, isSecondary, visibleCandles, scheduleRender]);

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
        tickMarkFormatter: (time: any, markType: number) => {
          const date = new Date(time * 1000);
          const dd = date.getDate().toString().padStart(2, '0');
          const hh = date.getHours().toString().padStart(2, '0');
          const min = date.getMinutes().toString().padStart(2, '0');
          const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
          // markType: 0=Year, 1=Month, 2=Day, 3=Time, 4=TimeWithSeconds
          if (markType <= 1) return `${monthNames[date.getMonth()]} ${date.getFullYear()}`;
          if (markType === 2) return `${dd} ${monthNames[date.getMonth()]}`;
          return `${hh}:${min}`;
        },
      },
      localization: {
        timeFormatter: (time: any) => {
          const date = new Date(time * 1000);
          const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
          const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

          // Use local methods to show time in the user's timezone (e.g. IST)
          const dayName = dayNames[date.getDay()];
          const day = date.getDate();
          const month = monthNames[date.getMonth()];
          const year = date.getFullYear();
          const hours = date.getHours().toString().padStart(2, '0');
          const minutes = date.getMinutes().toString().padStart(2, '0');

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

  // Sync crosshair with other charts
  const setCrosshairPosition = useSessionStore((s) => s.setCrosshairPosition);
  useEffect(() => {
    if (!chart || !series) return;

    // Track last handled time/price to avoid redundant store updates
    let lastHandledTime: number | null = null;
    let lastHandledPrice: number | null = null;

    const handler = (param: any) => {
      if (!param.time || !param.point) {
        if (lastHandledTime !== null) {
          const current = useSessionStore.getState().crosshairPosition;
          if (current.sourceChartId === chartId) {
            lastHandledTime = null;
            lastHandledPrice = null;
            setCrosshairPosition({ time: null, price: null, sourceChartId: null });
          }
        }
        return;
      }

      const price = param.seriesData.get(series)?.close || param.seriesData.get(series)?.value || null;

      // Optimization: Only update store if the crosshair actually moved to a new candle or price level
      if (param.time !== lastHandledTime || price !== lastHandledPrice) {
        lastHandledTime = param.time as number;
        lastHandledPrice = price;
        setCrosshairPosition({ time: param.time as number, price, sourceChartId: chartId });
      }
    };

    chart.subscribeCrosshairMove(handler);
    return () => chart.unsubscribeCrosshairMove(handler);
  }, [chart, series, chartId, setCrosshairPosition]);

  // Redraw when crosshair position changes from other chart
  // Redraw when crosshair position changes from other chart
  // Optimized: Use a direct store subscription to avoid full component re-renders on every mouse move
  useEffect(() => {
    const unsubscribe = useSessionStore.subscribe((state, prevState) => {
      // Only notify if crosshair position actually changed
      if (state.crosshairPosition !== prevState.crosshairPosition) {
        const pos = state.crosshairPosition;
        // Only trigger redraw if position comes from a different chart
        if (pos.sourceChartId !== chartId) {
          scheduleRender();
        }
      }
    });
    return unsubscribe;
  }, [chartId, scheduleRender]);

  // Update candle data
  useEffect(() => {
    if (!series) return;

    const count = visibleCandles.length;
    const lastTime = count > 0 ? (visibleCandles[count - 1].timestamp as number) : 0;

    // Check if this is just a live update or 1-candle extension
    // We can skip setData because the imperative tick handler already updated the chart
    const isLiveExtension = isLiveMode &&
      (count === lastSetDataCountRef.current || count === lastSetDataCountRef.current + 1) &&
      lastTime >= lastSetDataTimeRef.current &&
      !isFirstLoadRef.current;

    if (isLiveExtension) {
      lastSetDataCountRef.current = count;
      lastSetDataTimeRef.current = lastTime;
      return;
    }

    // Deduplicate by timestamp — live candles can overlap last historical candle
    const seenTs = new Map<number, any>();
    for (const c of visibleCandles) {
      seenTs.set(c.timestamp as number, c); // later entries win (live overrides historical)
    }
    const dedupedCandles = Array.from(seenTs.values());

    const candleData = dedupedCandles.map((c: any) => ({
      time: c.timestamp as any,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    const volumeData = dedupedCandles.map((c: any) => ({
      time: c.timestamp as any,
      value: c.volume,
      color: c.close >= c.open ? '#26a69a40' : '#ef535040',
    }));

    const timeScale = chart ? chart.timeScale() : null;
    const savedLogicalRange = (!isFirstLoadRef.current && timeScale) ? timeScale.getVisibleLogicalRange() : null;
    const prevBarCount = lastSetDataCountRef.current;

    series.setData(candleData);
    if (volumeSeries) {
      volumeSeries.setData(volumeData);
    }

    // Tick handler is the sole owner of lastCandleRef between setData calls.
    // Initialize it here so no React re-render can overwrite tick-handler mutations.
    if (dedupedCandles.length > 0) {
      const last = dedupedCandles[dedupedCandles.length - 1];
      lastCandleRef.current = {
        time: last.timestamp as any,
        open: last.open,
        high: last.high,
        low: last.low,
        close: last.close,
        volume: last.volume || 0,
      };
    } else {
      lastCandleRef.current = null;
    }

    lastSetDataCountRef.current = dedupedCandles.length;
    lastSetDataTimeRef.current = dedupedCandles.length > 0 ? (dedupedCandles[dedupedCandles.length - 1].timestamp as number) : 0;

    if (timeScale && dedupedCandles.length > 0) {
      if (isFirstLoadRef.current) {
        timeScale.fitContent();
        isFirstLoadRef.current = false;
      } else if (savedLogicalRange) {
        const addedBars = dedupedCandles.length - prevBarCount;
        // If user was at the right edge (last candle visible), scroll forward to keep new candle in view
        const wasAtRightEdge = prevBarCount > 0 && savedLogicalRange.to >= prevBarCount - 1.5;
        if (wasAtRightEdge && addedBars > 0) {
          timeScale.setVisibleLogicalRange({
            from: savedLogicalRange.from + addedBars,
            to: savedLogicalRange.to + addedBars,
          });
        } else {
          timeScale.setVisibleLogicalRange(savedLogicalRange);
        }
      }
    }
  }, [visibleCandles, series, volumeSeries, chart, isLiveMode]);

  // Pan to a specific candle on external request (e.g. "Jump to entry" in TradeHistoryDialog)
  // without changing currentIndex — the requested candle is already part of visibleCandles
  // since it's in the past; this only recenters the viewport, it never rewinds playback.
  useEffect(() => {
    if (isSecondary || !chart || scrollToTimestamp === null) return;

    const idx = visibleCandles.findIndex((c) => c.timestamp === scrollToTimestamp);
    if (idx !== -1) {
      const timeScale = chart.timeScale();
      const currentRange = timeScale.getVisibleLogicalRange();
      const width = currentRange ? currentRange.to - currentRange.from : 50;
      timeScale.setVisibleLogicalRange({
        from: idx - width / 2,
        to: idx + width / 2,
      });
    }
    // Clear the request so jumping to the same candle again later still triggers this effect
    useSessionStore.getState().scrollToTime(null);
  }, [scrollToTimestamp, isSecondary, chart, visibleCandles]);

  // Auto-clear the "jumped to" highlight a few seconds after it renders, so it reads as a
  // flash rather than a permanent marking. Re-jumping to the same candle re-arms the timer
  // via TradeHistoryDialog calling highlightCandle() again (store update fires even with an
  // unchanged value's re-set, since it's a fresh click).
  useEffect(() => {
    if (isSecondary || highlightTimestamp === null) return;
    const timer = setTimeout(() => {
      useSessionStore.getState().highlightCandle(null);
    }, 3500);
    return () => clearTimeout(timer);
  }, [highlightTimestamp, isSecondary]);

  // Click a candle that has a trade execution on it to see its journal details in a popup.
  // Only wired on the primary chart (trades are recorded on the primary timeframe). It also
  // stays active in 'select' mode — the idle "inspect/select existing drawings" mode you land
  // in after Escape or a right-click (both set 'select'), which shows no banner — so trade
  // inspection isn't silently disabled by those very common actions. Only *placement* drawing
  // tools suppress it, so it never steals a click meant for drawing; a click that selects an
  // existing drawing is already consumed by the drawings mousedown-capture handler.
  useEffect(() => {
    if (!chart || isSecondary) return;
    const handleClick = (param: any) => {
      if (activeTool !== 'none' && activeTool !== 'select') return;
      if (!param.time || !param.point) {
        setExecPopup(null);
        return;
      }
      const clickedTrades = useSessionStore.getState().trades.filter((t) => t.timestamp === param.time);
      if (clickedTrades.length === 0) {
        setExecPopup(null);
        return;
      }
      setExecPopup({ x: param.point.x, y: param.point.y, trades: clickedTrades });
    };
    chart.subscribeClick(handleClick);
    return () => chart.unsubscribeClick(handleClick);
  }, [chart, isSecondary, activeTool]);

  // Close the execution popup once playback moves — it refers to a specific candle click,
  // not a persistent state, so stepping/jumping should not leave it stranded on screen.
  useEffect(() => {
    setExecPopup(null);
    setSelectedSegment(null);
  }, [currentIndex]);

  // Dismiss on any click outside the popup that isn't on the chart itself — chart clicks
  // are already handled by the subscribeClick handler above (which re-targets or clears it).
  useEffect(() => {
    if (!execPopup) return;
    const handleOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (execPopupRef.current?.contains(target)) return;
      if (chartContainerRef.current?.contains(target)) return;
      setExecPopup(null);
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [execPopup]);

  const lastSetDataCountRef = useRef(0);
  const lastSetDataTimeRef = useRef(0);

  // Live Tick Subscription (Bypasses React State for Performance)
  useEffect(() => {
    if (!series || !chart) return;

    const unsubscribe = useLiveStore.subscribe((state, prevState) => {
      const tick = state.lastTick;
      const isLive = state.isLiveMode;

      // Only process ticks in live mode, and only when tick actually changed
      if (!isLive || !tick || tick === prevState.lastTick) return;

      if (!lastCandleRef.current) {
        console.warn('[Chart] Tick received but no candles loaded yet');
        return;
      }

      const chartInterval = isSecondary ? secondaryTimeframe : sessionConfig?.interval;
      let tfMinutes = parseInt(chartInterval || '5');
      if (chartInterval === '1D') tfMinutes = 1440;
      const timeframeSeconds = tfMinutes * 60;

      // Align to session open (09:15 IST) — same logic as resampler.ts
      const IST_OFFSET = 19800;
      const SESSION_START = 9 * 3600 + 15 * 60;
      const tsIst = tick.timestamp + IST_OFFSET;
      const timeInDay = tsIst % 86400;
      const istDayStart = tsIst - timeInDay;
      const sincOpen = timeInDay - SESSION_START;
      const bucketIdx = Math.max(0, Math.floor(sincOpen / timeframeSeconds));
      const bucketStart = (istDayStart + SESSION_START + bucketIdx * timeframeSeconds) - IST_OFFSET;
      const lastCandle = lastCandleRef.current;


      // Dhan sends cumulative day volume — compute per-tick delta to avoid overflow.
      // On the very first tick (e.g. secondary chart mounted mid-session), seed the
      // baseline without adding any volume so the huge cumulative value never reaches
      // the histogram (which has a ±9e13 hard limit in lightweight-charts).
      const cumVol = tick.volume || 0;
      let deltaVol = 0;
      if (!seenFirstTickRef.current) {
        seenFirstTickRef.current = true;
        prevCumulativeVolumeRef.current = cumVol; // seed — no delta on first tick
      } else {
        deltaVol = cumVol > prevCumulativeVolumeRef.current
          ? cumVol - prevCumulativeVolumeRef.current
          : cumVol; // reset at day start
        prevCumulativeVolumeRef.current = cumVol;
      }

      if (bucketStart === lastCandle.time) {
        // ── Update active candle in-place ─────────────────────────────────
        lastCandle.close = tick.price;
        lastCandle.high = Math.max(lastCandle.high, tick.price);
        lastCandle.low = Math.min(lastCandle.low, tick.price);
        lastCandle.volume = (lastCandle.volume || 0) + deltaVol;

        series.update({
          time: lastCandle.time,
          open: lastCandle.open,
          high: lastCandle.high,
          low: lastCandle.low,
          close: lastCandle.close
        });

        if (volumeSeries) {
          volumeSeries.update({
            time: lastCandle.time,
            value: lastCandle.volume,
            color: lastCandle.close >= lastCandle.open ? '#26a69a40' : '#ef535040'
          });
        }

        // Keep session store in sync
        if (!isSecondary) {
          useSessionStore.getState().addLiveCandle({
            timestamp: lastCandle.time,
            open: lastCandle.open,
            high: lastCandle.high,
            low: lastCandle.low,
            close: lastCandle.close,
            volume: lastCandle.volume
          });
        }

      } else if (bucketStart > lastCandle.time) {
        // ── New timeframe boundary ─────────────────────────────────────────
        // Capture before overwriting lastCandleRef so the correction timer
        // knows which candle just closed.
        const closedCandleTime = lastCandle.time;

        // open = first tick of the new period (matches TradingView OHLC).
        const openPrice = tick.price;
        const newCandle = {
          time: bucketStart as any,
          open: openPrice,
          high: Math.max(openPrice, tick.price),
          low: Math.min(openPrice, tick.price),
          close: tick.price,
          volume: deltaVol
        };
        lastCandleRef.current = newCandle;

        // Capture the user's current scroll position (bar-index based) before appending
        // the new bar. series.update() with a new timestamp may trigger LWC auto-scroll if
        // the chart is in "real-time following" mode; restore synchronously after to
        // preserve a manually-positioned viewport. Same pattern as the main candle-data
        // effect's setData()/wasAtRightEdge restore below.
        const ts = chart ? chart.timeScale() : null;
        const savedLogicalRange = ts ? ts.getVisibleLogicalRange() : null;
        const prevBarCount = lastSetDataCountRef.current;
        const wasAtRightEdge = !!savedLogicalRange && prevBarCount > 0 && savedLogicalRange.to >= prevBarCount - 1.5;

        series.update({
          time: newCandle.time,
          open: newCandle.open,
          high: newCandle.high,
          low: newCandle.low,
          close: newCandle.close
        });

        if (volumeSeries) {
          volumeSeries.update({
            time: newCandle.time,
            value: newCandle.volume,
            color: newCandle.close >= newCandle.open ? '#26a69a40' : '#ef535040'
          });
        }

        // Restore the user's scroll position synchronously: shift forward by one bar if
        // they were following the live edge, otherwise hold the exact prior range.
        if (ts && savedLogicalRange) {
          if (wasAtRightEdge) {
            ts.setVisibleLogicalRange({
              from: savedLogicalRange.from + 1,
              to: savedLogicalRange.to + 1,
            });
          } else {
            ts.setVisibleLogicalRange(savedLogicalRange);
          }
        }

        // Persist new candle to session store
        if (!isSecondary) {
          useSessionStore.getState().addLiveCandle({
            timestamp: bucketStart,
            open: newCandle.open,
            high: newCandle.high,
            low: newCandle.low,
            close: newCandle.close,
            volume: newCandle.volume
          });
        }

        // ── Exchange OHLCV correction for the just-closed candle ──────────
        // Dhan WebSocket delivers LTP ticks, not every trade. The accumulated
        // high/low can miss intra-tick extremes. After 3s Dhan's REST endpoint
        // has the authoritative exchange OHLCV — fetch it and patch the chart.
        if (!isSecondary && sessionConfig) {
          if (correctionTimerRef.current) clearTimeout(correctionTimerRef.current);
          correctionTimerRef.current = setTimeout(async () => {
            try {
              // Use IST date (markets are IST; Date.now() is UTC)
              const istNow = new Date(Date.now() + 19800 * 1000);
              const today = istNow.toISOString().split('T')[0];

              const result = await fetchCandles({
                securityId:      sessionConfig.securityId,
                exchangeSegment: sessionConfig.exchangeSegment,
                instrument:      sessionConfig.instrumentType,
                interval:        sessionConfig.interval,
                fromDate:        today,
                toDate:          today,
              });

              const corrected = result.data.find(c => c.timestamp === closedCandleTime);
              if (!corrected) return;

              const store = useSessionStore.getState();
              const existing = store.candles.find(c => c.timestamp === closedCandleTime);
              if (!existing) return;

              // Skip if tick-accumulated values already match exchange data
              if (
                existing.high  === corrected.high &&
                existing.low   === corrected.low  &&
                existing.close === corrected.close
              ) return;

              // Patch store (open is preserved inside patchLiveCandle)
              store.patchLiveCandle(corrected);

              // Patch chart — series.update() can't reach non-last bars,
              // so use setData() with visible-range restore to avoid scroll jump.
              // Bar-index based (not time-based) to match the tick handler's restore —
              // this patch never changes bar count, so it's always an exact restore.
              const patchTs = chart.timeScale();
              const savedPatchRange = patchTs.getVisibleLogicalRange();
              const latest = useSessionStore.getState().candles;
              series.setData(
                latest.map(c => ({
                  time:  c.timestamp as any,
                  open:  c.open,
                  high:  c.high,
                  low:   c.low,
                  close: c.close,
                }))
              );
              if (savedPatchRange) patchTs.setVisibleLogicalRange(savedPatchRange);

              if (volumeSeries) {
                volumeSeries.setData(
                  latest.map(c => ({
                    time:  c.timestamp as any,
                    value: c.volume,
                    color: c.close >= c.open ? '#26a69a40' : '#ef535040',
                  }))
                );
              }
            } catch {
              // Silent fail — tick-accumulated data remains as fallback
            }
          }, 3000);
        }
      } else {
        console.warn('[Chart] Stale tick ignored: bucket', bucketStart, '< lastCandle.time', lastCandle.time);
      }
    });

    return () => {
      unsubscribe();
      if (correctionTimerRef.current) clearTimeout(correctionTimerRef.current);
    };
  }, [series, chart, volumeSeries, isSecondary, secondaryTimeframe, sessionConfig]);

  // Reset on new data only if it's a major data reload (len decreased or jumped > 5)
  useEffect(() => {
    isFirstLoadRef.current = true;
  }, [sessionConfig?.securityId, sessionConfig?.interval, sessionConfig?.fromDate]);

  // Update indicator line series
  useEffect(() => {
    if (!chart) return;

    // Skip if only a live price tick updated the last candle — no new candle, same structure.
    // activeIndicators changes produce a different key, so they always pass through.
    const lastCandle = visibleCandles[visibleCandles.length - 1];
    const indicatorKey = activeIndicators.join(',');
    const sameCount = visibleCandles.length === lastIndicatorCandleCountRef.current;
    const sameTimestamp = lastCandle?.timestamp === lastIndicatorTimestampRef.current;
    const sameKey = indicatorKey === lastIndicatorKeyRef.current;
    if (sameCount && sameTimestamp && sameKey) return;
    lastIndicatorCandleCountRef.current = visibleCandles.length;
    lastIndicatorTimestampRef.current = lastCandle?.timestamp ?? 0;
    lastIndicatorKeyRef.current = indicatorKey;

    const indicatorsToKeep = new Set(activeIndicators);

    // Remove series that are no longer active
    indicatorSeriesRef.current.forEach((s, name) => {
      if (!indicatorsToKeep.has(name as Indicator)) {
        try { chart.removeSeries(s); } catch (e) { }
        indicatorSeriesRef.current.delete(name);
      }
    });

    if (visibleCandles.length === 0) return;

    // Update or add active line-based indicators
    activeIndicators.forEach((indicator) => {
      let data: any[] = [];
      let color = '';

      switch (indicator) {
        case 'sma21': data = calculateSMA(visibleCandles, 21); color = '#2962FF'; break;
        case 'sma60': data = calculateSMA(visibleCandles, 60); color = '#FF6D00'; break;
        case 'ema21': data = calculateEMA(visibleCandles, 21); color = '#00897B'; break;
        case 'ema60': data = calculateEMA(visibleCandles, 60); color = '#D81B60'; break;
      }

      let lineSeries = indicatorSeriesRef.current.get(indicator);
      if (!lineSeries && data.length > 0) {
        // Only create a new series when there is data — avoids empty phantom series
        lineSeries = chart.addSeries(LineSeries, { color, lineWidth: 2 });
        indicatorSeriesRef.current.set(indicator, lineSeries);
      }
      if (lineSeries) {
        // Always call setData — even with [] — so old data is cleared when jumping
        // to a position with fewer candles than the indicator period
        lineSeries.setData(data);
      }
    });
  }, [activeIndicators, visibleCandles, chart]);

  // Update markers (Trades and Pivot Points)
  useEffect(() => {
    if (!markersPrimitiveRef.current || visibleCandles.length === 0) return;

    // Skip if only a live price tick arrived — no new candle and no trade/indicator change.
    const markerConfigKey = `${activeIndicators.join(',')}|${showMarkers}|${useAtrForSignals}|${isSecondary}|${secondaryTimeframe}|${sessionConfig?.interval ?? ''}`;
    const structureSame =
      visibleCandles.length === lastMarkerCandleCountRef.current &&
      trades.length === lastMarkerTradeCountRef.current &&
      markerConfigKey === lastMarkerConfigKeyRef.current;
    if (structureSame) return;
    lastMarkerCandleCountRef.current = visibleCandles.length;
    lastMarkerTradeCountRef.current = trades.length;
    lastMarkerConfigKeyRef.current = markerConfigKey;

    const allMarkers: any[] = [];

    // 1. Add Trade Markers
    if (showMarkers) {
      const getTfMins = (tf: string | null | undefined) => {
        if (!tf) return 5;
        if (tf === '1D') return 1440;
        return parseInt(tf) || 5;
      };

      const chartInterval = isSecondary ? secondaryTimeframe : sessionConfig?.interval;
      const chartTfMins = getTfMins(chartInterval);

      trades.forEach((trade) => {
        // Only show trades that were taken on this timeframe or a higher one
        // (Hide lower timeframe trades on higher timeframe charts)
        const tradeTfMins = getTfMins(trade.interval);
        if (tradeTfMins < chartTfMins) return;

        let markerTime = trade.timestamp;
        if (isSecondary && secondaryTimeframe) {
          const tfSeconds = getTfMins(secondaryTimeframe) * 60;
          markerTime = Math.floor(trade.timestamp / tfSeconds) * tfSeconds;
        }

        if (markerTime <= visibleCandles[visibleCandles.length - 1].timestamp) {
          const isMs = trade.timestamp > 1e11;
          const date = new Date(isMs ? trade.timestamp : trade.timestamp * 1000);

          // Use local methods to ensure the label matches the user's timezone
          const hours = date.getHours();
          const minutes = date.getMinutes();
          const seconds = date.getSeconds();

          // Format as HH:mm if it has time, or dd MMM if it's a daily candle (midnight)
          const timeStr = hours === 0 && minutes === 0 && seconds === 0
            ? `${date.getDate()} ${date.toLocaleString('default', { month: 'short' })}`
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
        const allPivots = memoizedPivots;
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
      const alBrooksSignals = memoizedAlBrooks;
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
  }, [activeIndicators, visibleCandles, trades, showMarkers, useAtrForSignals, memoizedPivots, memoizedAlBrooks, sessionConfig, secondaryTimeframe, isSecondary]);

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

  const handleTakeScreenshot = useCallback(() => {
    const base64Image = getScreenshotData();
    if (!base64Image) return;

    setScreenshotDefaultName(getScreenshotDefaultName());
    setPendingScreenshotData(base64Image);
    setIsScreenshotDialogOpen(true);
  }, [chart, trades]);

  const handleDownloadScreenshot = useCallback(() => {
    const base64Image = getScreenshotData();
    if (!base64Image) return;

    const filename = getScreenshotDefaultName();
    const link = document.createElement('a');
    link.download = `${filename}.png`;
    link.href = base64Image;
    link.click();
    notify('Screenshot downloaded locally', 'success');
  }, [chart, trades, notify]);

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
        // Invalidate rect cache (size changed) then schedule one redraw
        invalidateRectCache();
        scheduleRender();
      }
    });

    resizeCanvasObserver.observe(container);
    return () => resizeCanvasObserver.disconnect();
  }, [scheduleRender, invalidateRectCache]);

  // Keyboard shortcuts — only registered by the active chart to avoid double-binding
  useEffect(() => {
    if (!isActiveChart) return;
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
        '0': 'channel',
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
  }, [isActiveChart, selectedDrawingId, activeTool, deleteSelectedDrawing, setActiveTool, setSharedActiveTool]);

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
          className={`absolute inset-0 pointer-events-none z-50 rounded-sm transition-all duration-150 ${isActiveChart
              ? 'ring-2 ring-inset ring-blue-500'
              : 'ring-1 ring-inset ring-transparent'
            }`}
        />
      )}

      {/* Active chart label in dual mode */}
      {showSecondaryChart && (
        <div className={`absolute top-2 left-4 z-10 px-3 py-1.5 rounded-lg border shadow-sm flex items-center gap-2 transition-all duration-150 ${isActiveChart
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
        {execPopup && (
          <div
            ref={execPopupRef}
            className="absolute bg-white border border-gray-200 rounded-lg shadow-xl text-xs w-[26rem] max-h-[28rem] overflow-y-auto"
            style={{
              left: Math.min(execPopup.x + 12, (chartContainerRef.current?.clientWidth ?? 800) - 440),
              top: Math.min(execPopup.y + 12, (chartContainerRef.current?.clientHeight ?? 500) - 400),
              zIndex: 300,
            }}
          >
            <div className="flex items-center justify-between px-3 py-2 border-b bg-gray-50 sticky top-0">
              <span className="font-bold text-gray-700">
                Trade Record{execPopup.trades.length > 1 ? `s (${execPopup.trades.length})` : ''}
              </span>
              <button onClick={() => { setExecPopup(null); setSelectedSegment(null); }} className="text-gray-400 hover:text-gray-700">
                <X size={14} />
              </button>
            </div>
            <div className="divide-y divide-gray-100">
              {execPopup.trades.map((t) => (
                <div key={t.id} className="p-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className={`font-bold ${t.type === 'BUY' ? 'text-green-600' : 'text-red-600'}`}>
                      {t.type}{t.optionType ? ` ${t.optionType}` : ''} @ {formatCurrency(t.price)}
                    </span>
                    {t.exitReason && t.exitReason !== 'MANUAL' && (
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${exitReasonBadge(t.exitReason).cls}`}>
                        {exitReasonBadge(t.exitReason).label}
                      </span>
                    )}
                  </div>
                  {/* Recent-price-action context: the last N Al Brooks impulse legs + the
                      pullbacks between them (newest→oldest, left→right — leftmost is closest
                      to entry). Leg = solid chip, pullback = dashed; green = bull move, red =
                      bear move. Click a chip to highlight its candles on the chart and expand
                      its tracked values. */}
                  {t.legSequenceAtEntry && t.legSequenceAtEntry.length > 0 && (
                    <div className="mb-2">
                      <div className="text-[9px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
                        Leg Sequence ({t.legSequenceAtEntry.length}) · click a segment to locate it on the chart
                      </div>
                      <div className="flex gap-1 overflow-x-auto pb-1">
                        {t.legSequenceAtEntry.map((seg, i) => {
                          const bull = seg.direction === 'bull';
                          const isSel = selectedSegment != null
                            && selectedSegment.startTime === seg.startTime
                            && selectedSegment.endTime === seg.endTime
                            && selectedSegment.kind === seg.kind;
                          return (
                            <button
                              key={i}
                              onClick={() => setSelectedSegment(isSel ? null : seg)}
                              title={`${seg.kind} ${seg.direction} · bars ${seg.startIndex}–${seg.endIndex} (${seg.barCount}) · move ${seg.movePct.toFixed(2)}% · H ${seg.high.toFixed(2)} L ${seg.low.toFixed(2)} · BRR ${seg.brrAvg.toFixed(2)} CLV ${seg.clvAvg.toFixed(2)} UWR ${seg.uwrAvg.toFixed(2)} LWR ${seg.lwrAvg.toFixed(2)} · H/L breaks ${seg.highBreakCount}/${seg.lowBreakCount}${seg.bullBear ? ` · bull/bear ${seg.bullBear.join('')}` : ''}${seg.hlSeq ? ` · Brooks H/L ${seg.hlSeq}` : ''}`}
                              className={`shrink-0 rounded px-1.5 py-1 text-[9px] leading-tight text-center min-w-[3rem] cursor-pointer transition-all ${
                                bull ? 'text-green-700' : 'text-red-700'
                              } ${
                                seg.kind === 'leg'
                                  ? bull ? 'bg-green-50 border border-green-300' : 'bg-red-50 border border-red-300'
                                  : bull ? 'bg-green-50/40 border border-dashed border-green-300' : 'bg-red-50/40 border border-dashed border-red-300'
                              } ${isSel ? 'ring-2 ring-offset-1 ' + (bull ? 'ring-green-500' : 'ring-red-500') : 'hover:brightness-95'}`}
                            >
                              <div className="font-bold">{bull ? '▲' : '▼'} {seg.kind === 'pullback' ? 'pb' : 'leg'}</div>
                              <div>{seg.barCount}b</div>
                              <div>{seg.movePct >= 0 ? '+' : ''}{seg.movePct.toFixed(1)}%</div>
                            </button>
                          );
                        })}
                      </div>
                      {/* Detail of the clicked segment — values aligned with the highlighted candles. */}
                      {selectedSegment && t.legSequenceAtEntry.some(s => s === selectedSegment) && (() => {
                        const s = selectedSegment;
                        const bull = s.direction === 'bull';
                        const fmt = (v?: number, d = 2) => (v === undefined || Number.isNaN(v) ? '—' : v.toFixed(d));
                        return (
                          <div className={`mt-1 rounded border p-2 text-[10px] ${bull ? 'border-green-300 bg-green-50/50' : 'border-red-300 bg-red-50/50'}`}>
                            <div className="flex items-center justify-between mb-1">
                              <span className={`font-bold ${bull ? 'text-green-700' : 'text-red-700'}`}>
                                {s.kind === 'pullback' ? 'Pullback' : 'Leg'} · {s.direction} · bars {s.startIndex}–{s.endIndex} ({s.barCount})
                              </span>
                              <button onClick={() => setSelectedSegment(null)} className="text-gray-400 hover:text-gray-700"><X size={11} /></button>
                            </div>
                            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-gray-600">
                              <span>Move: <b>{s.movePct >= 0 ? '+' : ''}{fmt(s.movePct)}%</b></span>
                              <span>Price: {fmt(s.startPrice)} → {fmt(s.endPrice)}</span>
                              <span>High: <b>{fmt(s.high)}</b> · Low: <b>{fmt(s.low)}</b></span>
                              <span>Range: <b>{fmt(s.high - s.low)}</b></span>
                              <span>H/L breaks: <b>{s.highBreakCount}/{s.lowBreakCount}</b></span>
                              {/* Absent on trades restored from sessions saved before bullCount existed. */}
                              <span>Bull/bear bars: <b>{Number.isFinite(s.bullCount) ? `${s.bullCount}/${s.barCount - s.bullCount}` : '—'}</b></span>
                              <span>Avg BRR {fmt(s.brrAvg)} · CLV {fmt(s.clvAvg)}</span>
                              <span>Avg UWR {fmt(s.uwrAvg)} · LWR {fmt(s.lwrAvg)}</span>
                              {/* Al Brooks pullback labels — distinct from "H/L breaks" above.
                                  typeof (not === undefined) because hlSeq is a required field:
                                  it's only absent on trades restored from older sessions. */}
                              <span className="col-span-2">Brooks H/L: <b>{typeof s.hlSeq === 'string' ? (s.hlSeq === '' ? 'none' : s.hlSeq) : '—'}</b></span>
                            </div>
                            {s.brr && s.brr.length > 0 && (
                              <div className="mt-1.5 max-h-40 overflow-y-auto">
                                <table className="w-full text-[9px] tabular-nums">
                                  <thead className="text-gray-400 sticky top-0 bg-inherit">
                                    <tr className="text-left">
                                      <th className="pr-2 font-semibold">Bar</th>
                                      <th className="pr-2 font-semibold">Dir</th>
                                      <th className="pr-2 font-semibold">H/L</th>
                                      <th className="pr-2 font-semibold">BRR</th>
                                      <th className="pr-2 font-semibold">CLV</th>
                                      <th className="pr-2 font-semibold">UWR</th>
                                      <th className="font-semibold">LWR</th>
                                    </tr>
                                  </thead>
                                  <tbody className="text-gray-700">
                                    {s.brr.map((_, k) => (
                                      <tr key={k} className="border-t border-gray-100">
                                        <td className="pr-2 text-gray-400">{s.startIndex + k}</td>
                                        <td className={`pr-2 font-bold ${s.bullBear?.[k] === 1 ? 'text-green-600' : 'text-red-600'}`}>
                                          {s.bullBear === undefined ? '—' : s.bullBear[k] === 1 ? '▲' : '▼'}
                                        </td>
                                        {/* Blank on the many bars with no signal — a dash on
                                            every row would drown out the few that fired. */}
                                        <td className={`pr-2 font-bold ${s.hl?.[k]?.startsWith('H') ? 'text-green-600' : 'text-red-600'}`}>
                                          {s.hl === undefined ? '—' : (s.hl[k] ?? '')}
                                        </td>
                                        <td className="pr-2">{fmt(s.brr?.[k])}</td>
                                        <td className="pr-2">{fmt(s.clv?.[k])}</td>
                                        <td className="pr-2">{fmt(s.uwr?.[k])}</td>
                                        <td>{fmt(s.lwr?.[k])}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                            {!s.brr && <div className="mt-1 text-[9px] text-gray-400 italic">Per-candle detail not stored for this trade (averages-only mode / restored session).</div>}
                          </div>
                        );
                      })()}
                    </div>
                  )}
                  {/* Raw object dump — full trade record (journal + every *AtEntry instrumentation
                      field, including legSequenceAtEntry's per-leg brr/clv/uwr/lwr) so values can be
                      eyeballed directly, the same way you'd inspect an object in the console. */}
                  <pre className="bg-gray-50 border border-gray-100 rounded p-2 text-[10px] leading-snug text-gray-700 whitespace-pre-wrap break-words">
                    {JSON.stringify(t, null, 2)}
                  </pre>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
