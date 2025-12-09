import { useEffect, useRef } from 'react';
import { createChart, ColorType, CandlestickSeries, HistogramSeries } from 'lightweight-charts';
import { useSessionStore } from '../stores/sessionStore';

export function CandlestickChart() {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const candleSeriesRef = useRef<any>(null);
  const volumeSeriesRef = useRef<any>(null);

  // Use selector to get visible candles - this creates a stable reference
  const candles = useSessionStore((s) => s.candles);
  const currentIndex = useSessionStore((s) => s.currentIndex);
  const visibleCandles = candles.slice(0, currentIndex + 1);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    // Create chart
    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: 500,
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
        fixLeftEdge: true, // Keep candles aligned from the left
        lockVisibleTimeRangeOnResize: true, // Prevent zoom change on resize
      },
    });

    // Create candlestick series
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderVisible: false,
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
    });

    // Create volume series
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

    // Handle resize
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

  // Track if this is the first load
  const isFirstLoadRef = useRef(true);

  useEffect(() => {
    if (!candleSeriesRef.current || !volumeSeriesRef.current) return;

    // Update chart data
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

      // Only set initial range on first load
      if (isFirstLoadRef.current) {
        timeScale.fitContent();
        // Show a reasonable number of candles (50-100 bars) instead of all
        // const barsToShow = Math.min(100, visibleCandles.length);
        // const fromIndex = Math.max(0, visibleCandles.length - barsToShow);

        // if (visibleCandles.length > 0) {
        //   timeScale.setVisibleRange({
        //     from: visibleCandles[fromIndex].timestamp as any,
        //     to: visibleCandles[visibleCandles.length - 1].timestamp as any,
        //   });
        // }
        isFirstLoadRef.current = false;
      } else {
        // Scroll to the latest candle while maintaining zoom
        timeScale.scrollToPosition(3, false);
        // timeScale.scrollToRealTime();
      }
    }
  }, [visibleCandles]);

  // Reset first load flag when candles array changes (new data loaded)
  useEffect(() => {
    isFirstLoadRef.current = true;
  }, [candles.length]);

  return (
    <div className="w-full">
      <div ref={chartContainerRef} className="w-full" />
    </div>
  );
}
