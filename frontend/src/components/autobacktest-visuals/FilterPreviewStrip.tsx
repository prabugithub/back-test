import { useEffect, useRef } from 'react';
import {
  createChart,
  ColorType,
  CandlestickSeries,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type Time,
} from 'lightweight-charts';
import type { FilterPreviewBar, PreviewFilterKey } from '../../hooks/useFilterPreviewData';

interface FilterPreviewStripProps {
  bars: FilterPreviewBar[];
  /** When set, dots reflect only this filter's pass/fail instead of the combined result. */
  highlightFilterKey?: PreviewFilterKey | null;
  height?: number;
}

// Minimal, read-only lightweight-charts instance — deliberately not AdvancedChart, which
// reads candles/indicators straight from useSessionStore and carries the full toolbar/
// drawing-tools stack. This just needs candlesticks + a pass/fail marker row.
export function FilterPreviewStrip({ bars, highlightFilterKey = null, height = 130 }: FilterPreviewStripProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: '#6b7280', fontSize: 10 },
      grid: { vertLines: { visible: false }, horzLines: { visible: false } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
      handleScroll: false,
      handleScale: false,
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderVisible: false,
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
    });
    const markers = createSeriesMarkers(series, []);
    series.attachPrimitive(markers as any);

    chartRef.current = chart;
    seriesRef.current = series;
    markersRef.current = markers;

    const resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height: h } = entry.contentRect;
        if (width > 0 && h > 0) chart.applyOptions({ width, height: h });
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const series = seriesRef.current;
    const markers = markersRef.current;
    if (!series || !markers) return;

    series.setData(
      bars.map(b => ({
        time: b.candle.timestamp as Time,
        open: b.candle.open,
        high: b.candle.high,
        low: b.candle.low,
        close: b.candle.close,
      }))
    );

    markers.setMarkers(
      bars.map(b => {
        const pass = highlightFilterKey ? (b.pass[highlightFilterKey] ?? true) : b.overallPass;
        return {
          time: b.candle.timestamp as Time,
          position: 'belowBar' as const,
          color: pass ? '#22c55e' : '#d1d5db',
          shape: 'circle' as const,
          size: 0.6,
        };
      })
    );

    chartRef.current?.timeScale().fitContent();
  }, [bars, highlightFilterKey]);

  const passCount = bars.filter(b => (highlightFilterKey ? (b.pass[highlightFilterKey] ?? true) : b.overallPass)).length;

  return (
    <div className="relative border border-gray-200 rounded-lg overflow-hidden bg-gray-50">
      <div ref={containerRef} style={{ height }} />
      {bars.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-[11px] text-gray-400 bg-gray-50">
          Load a session with candles to preview this filter on real data
        </div>
      )}
      <div className="px-2 py-1 text-[10px] text-gray-400 border-t border-gray-200 bg-white flex justify-between">
        <span>{bars.length > 0 ? `Last ${bars.length} bars from your loaded data` : 'No data loaded'}</span>
        <span className="font-medium text-gray-500">{bars.length > 0 ? `${passCount}/${bars.length} pass` : '—'}</span>
      </div>
    </div>
  );
}
