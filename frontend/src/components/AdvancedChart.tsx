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

  // Initialize drawing functionality
  const {
    canvasRef,
    clearDrawings,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
  } = useChartDrawings({
    chartRef,
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

  // Set up canvas overlay when chart is ready
  useEffect(() => {
    if (!chartContainerRef.current || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const container = chartContainerRef.current;

    // Match canvas size to chart container
    const resizeCanvas = () => {
      const rect = container.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = 600;

      console.log('Canvas resized:', { width: canvas.width, height: canvas.height });
    };

    // Initial resize
    setTimeout(resizeCanvas, 100);

    window.addEventListener('resize', resizeCanvas);

    // Add mouse event listeners
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleMouseDown, handleMouseMove, handleMouseUp]);

  return (
    <div className="w-full">
      <ChartToolbar
        activeTool={activeTool}
        onToolChange={setActiveTool}
        activeIndicators={activeIndicators}
        onIndicatorToggle={handleIndicatorToggle}
        onClearDrawings={handleClearDrawings}
      />
      <div className="relative" style={{ width: '100%', height: '600px' }}>
        <div ref={chartContainerRef} className="w-full h-full" />
        {/* Canvas overlay for drawings */}
        <canvas
          ref={canvasRef}
          className="absolute top-0 left-0 w-full h-full"
          style={{
            cursor: activeTool !== 'none' ? 'crosshair' : 'default',
            pointerEvents: 'auto',
          }}
        />
        {activeTool !== 'none' && (
          <div className="absolute top-2 right-2 bg-blue-50 border border-blue-200 rounded px-3 py-2 text-sm z-10">
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
