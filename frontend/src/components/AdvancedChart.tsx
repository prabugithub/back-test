import { useEffect, useRef, useState } from 'react';
import {
  createChart,
  ColorType,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
} from 'lightweight-charts';
import { useSessionStore } from '../stores/sessionStore';
import { ChartToolbar } from './ChartToolbar';
import type { DrawingTool } from './ChartToolbar';
import type { Indicator } from './ChartToolbar';
import { calculateSMA, calculateEMA } from '../utils/indicators';
import { useChartDrawings } from '../hooks/useChartDrawings';

export function AdvancedChart() {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const candleSeriesRef = useRef<any>(null);
  const volumeSeriesRef = useRef<any>(null);
  const indicatorSeriesRef = useRef<Map<string, any>>(new Map());

  const [activeTool, setActiveTool] = useState<DrawingTool>('none');
  const [activeIndicators, setActiveIndicators] = useState<Indicator[]>([]);

  const candles = useSessionStore((s) => s.candles);
  const currentIndex = useSessionStore((s) => s.currentIndex);
  const visibleCandles = candles.slice(0, currentIndex + 1);

  const isFirstLoadRef = useRef(true);
  const canvasRef = useRef<HTMLCanvasElement | null>(null); // Create canvas ref here, not in hook

  // Initialize drawing functionality
  const {
    clearDrawings,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
  } = useChartDrawings({
    chartRef,
    canvasRef, // Pass the ref to the hook
    activeTool,
    onToolComplete: () => setActiveTool('none'),
  });

  // Initialize chart
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: 600,
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

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;

    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth,
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

  // Update indicators
  useEffect(() => {
    if (!chartRef.current || visibleCandles.length === 0) return;

    // Clear old indicator series
    indicatorSeriesRef.current.forEach((series) => {
      chartRef.current.removeSeries(series);
    });
    indicatorSeriesRef.current.clear();

    // Add active indicators
    activeIndicators.forEach((indicator) => {
      let data: any[] = [];
      let color = '';

      switch (indicator) {
        case 'sma20':
          data = calculateSMA(visibleCandles, 20);
          color = '#2962FF';
          break;
        case 'sma50':
          data = calculateSMA(visibleCandles, 50);
          color = '#FF6D00';
          break;
        case 'ema20':
          data = calculateEMA(visibleCandles, 20);
          color = '#00897B';
          break;
        case 'ema50':
          data = calculateEMA(visibleCandles, 50);
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
      console.log('⚠️ Canvas setup skipped - refs not ready:', {
        hasChartContainer: !!chartContainerRef.current,
        hasCanvas: !!canvasRef.current
      });
      return;
    }

    const canvas = canvasRef.current;
    const container = chartContainerRef.current;

    console.log('✅ Setting up canvas - ONCE ONLY');
    console.log('Canvas element:', canvas);
    console.log('Canvas computed style:', window.getComputedStyle(canvas));

    // Match canvas size to chart container
    const resizeCanvas = () => {
      const rect = container.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = 600;

      const canvasRect = canvas.getBoundingClientRect();
      console.log('📐 Canvas resized:', {
        width: canvas.width,
        height: canvas.height,
        canvasRect,
        pointerEvents: canvas.style.pointerEvents,
        zIndex: canvas.style.zIndex
      });
    };

    // Initial resize
    setTimeout(resizeCanvas, 100);

    window.addEventListener('resize', resizeCanvas);

    return () => {
      console.log('🧹 Cleaning up resize listener ONLY');
      window.removeEventListener('resize', resizeCanvas);
    };
  }, []); // Empty dependency array - only run once!

  // Log when activeTool changes
  useEffect(() => {
    console.log('🎨 Active tool changed to:', activeTool);
    console.log('Canvas ref exists:', !!canvasRef.current);
    if (canvasRef.current) {
      const canvas = canvasRef.current;
      console.log('Canvas pointer events:', canvas.style.pointerEvents);
      console.log('Canvas cursor:', canvas.style.cursor);
      console.log('Canvas position in DOM:', canvas.getBoundingClientRect());

      // Test if canvas is actually in the DOM and visible
      const isInDOM = document.body.contains(canvas);
      const rect = canvas.getBoundingClientRect();
      const isVisible = rect.width > 0 && rect.height > 0;
      console.log('Canvas in DOM:', isInDOM, 'Visible:', isVisible);
    }
  }, [activeTool]);

  // Test handler attachment on mount
  useEffect(() => {
    if (!canvasRef.current) return;

    console.log('🧪 Testing canvas event handling...');
    const canvas = canvasRef.current;

    // Add a direct test listener
    const testClick = (e: MouseEvent) => {
      console.log('🎯 DIRECT addEventListener CLICK detected!', {
        x: e.clientX,
        y: e.clientY,
        target: e.target,
        currentTarget: e.currentTarget
      });
    };

    canvas.addEventListener('click', testClick, { capture: true });
    console.log('Test listener attached to canvas');

    return () => {
      canvas.removeEventListener('click', testClick, { capture: true });
      console.log('Test listener removed');
    };
  }, []);

  return (
    <div className="w-full">
      <ChartToolbar
        activeTool={activeTool}
        onToolChange={setActiveTool}
        activeIndicators={activeIndicators}
        onIndicatorToggle={handleIndicatorToggle}
        onClearDrawings={handleClearDrawings}
      />
      <div
        className="relative"
        style={{
          width: '100%',
          height: '600px',
          pointerEvents: activeTool !== 'none' ? 'none' : 'auto', // Disable parent when drawing
        }}
        onClick={() => console.log('🔴 PARENT CONTAINER clicked!')}
      >
        <div
          ref={chartContainerRef}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '600px',
            pointerEvents: activeTool !== 'none' ? 'none' : 'auto', // Disable when drawing
            zIndex: 1, // Below canvas (which is zIndex: 100)
          }}
          onClick={() => console.log('🟡 CHART CONTAINER clicked!')}
        />
        {/* Canvas overlay for drawings */}
        <canvas
          ref={canvasRef}
          className="absolute top-0 left-0"
          style={{
            width: '100%',
            height: '600px',
            cursor: activeTool !== 'none' ? 'crosshair' : 'default',
            pointerEvents: activeTool !== 'none' ? 'auto' : 'none',
            zIndex: 100,
            border: activeTool !== 'none' ? '2px dashed red' : 'none',
            backgroundColor: activeTool !== 'none' ? 'rgba(255, 0, 0, 0.05)' : 'transparent',
            touchAction: 'none', // Prevent touch scrolling
          }}
          onMouseDown={(e) => {
            console.log('🖱️ React onMouseDown fired! Active tool:', activeTool, 'Event:', e);
            e.preventDefault();
            e.stopPropagation();
            handleMouseDown(e.nativeEvent);
          }}
          onMouseMove={(e) => {
            console.log('🖱️ React onMouseMove fired!');
            handleMouseMove(e.nativeEvent);
          }}
          onMouseUp={(e) => {
            console.log('🖱️ React onMouseUp fired!');
            e.preventDefault();
            e.stopPropagation();
            handleMouseUp();
          }}
          onClick={(e) => {
            console.log('🖱️ Canvas CLICK! Active tool:', activeTool, 'Event:', e);
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
