import { useRef, useEffect, useState, useCallback } from 'react';
import { useSessionStore } from '../stores/sessionStore';
import { type Point, type Drawing, type DrawingTool } from '../types';

interface UseChartDrawingsProps {
  canvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  activeTool: DrawingTool;
  onToolComplete?: () => void;
  chartApi: any;
  seriesApi: any;
  onTextToolTrigger?: (point: Point) => void;
  onCalloutTrigger?: (p1: Point, p2: Point) => void;
  onCustomRender?: (ctx: CanvasRenderingContext2D) => void;
  isSecondary?: boolean;
}

export function useChartDrawings({
  canvasRef,
  activeTool,
  onToolComplete,
  chartApi,
  seriesApi,
  onTextToolTrigger,
  onCalloutTrigger,
  onCustomRender,
  isSecondary = false,
}: UseChartDrawingsProps) {
  const setTradeQuantity = useSessionStore((s) => s.setTradeQuantity);
  const riskPerTrade = useSessionStore((s) => s.riskPerTrade);
  const setManualLevels = useSessionStore((s) => s.setManualLevels);

  const drawings = useSessionStore((s) => isSecondary ? s.secondaryDrawings : s.drawings);
  const setDrawingsState = useSessionStore((s) => isSecondary ? s.setSecondaryDrawings : s.setDrawings);

  // Returns the current drawings array for this chart without triggering a re-render
  const getDrawings = (): Drawing[] => isSecondary
    ? useSessionStore.getState().secondaryDrawings
    : useSessionStore.getState().drawings;

  // Helper to maintain compatibility with functional set state
  const setDrawings = useCallback((action: Drawing[] | ((prev: Drawing[]) => Drawing[])) => {
    if (typeof action === 'function') {
      setDrawingsState(action(getDrawings()));
    } else {
      setDrawingsState(action);
    }
  }, [setDrawingsState]);

  const [currentDrawing, setCurrentDrawing] = useState<Point[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState<Point>({ x: 0, y: 0 });
  const [isHoveringSelected] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [resizeHandleIndex, setResizeHandleIndex] = useState<number>(-1);

  // Undo history — stores up to 5 previous drawings states
  const drawingHistoryRef = useRef<Drawing[][]>([]);

  const pushToHistory = useCallback(() => {
    drawingHistoryRef.current = [...drawingHistoryRef.current, [...getDrawings()]].slice(-5);
  }, [isSecondary]);

  // Use refs to track current values without causing re-renders
  const activeToolRef = useRef(activeTool);
  const isDrawingRef = useRef(isDrawing);
  const currentDrawingRef = useRef(currentDrawing);
  const isDraggingRef = useRef(isDragging);
  const dragOffsetRef = useRef(dragOffset);
  const selectedDrawingIdRef = useRef(selectedDrawingId);
  const isResizingRef = useRef(isResizing);
  const resizeHandleIndexRef = useRef(resizeHandleIndex);

  // Cached bounding rect — invalidated on resize, avoids forced reflow on every mousemove
  const rectCacheRef = useRef<DOMRect | null>(null);
  const invalidateRectCache = useCallback(() => { rectCacheRef.current = null; }, []);

  // rAF scheduler — collapses all synchronous renderCanvas() calls within a frame into one
  const rafIdRef = useRef<number>(0);

  // Perf: buffer drag/resize mutations locally; commit to store only on mouseup.
  // This prevents setDrawings() → re-render → repaint on every mousemove pixel.
  const dragBufferRef = useRef<Drawing[] | null>(null);
  // Synchronous flag (not via useEffect) so renderCanvas and handleMouseMove
  // always know whether an interaction is genuinely active even before React's
  // useEffect-based ref-sync fires.
  const isInteractingRef = useRef(false);

  // Keep refs in sync with state
  useEffect(() => { activeToolRef.current = activeTool; }, [activeTool]);
  useEffect(() => { isDrawingRef.current = isDrawing; }, [isDrawing]);
  useEffect(() => { currentDrawingRef.current = currentDrawing; }, [currentDrawing]);
  useEffect(() => { isDraggingRef.current = isDragging; }, [isDragging]);
  useEffect(() => { dragOffsetRef.current = dragOffset; }, [dragOffset]);
  useEffect(() => { selectedDrawingIdRef.current = selectedDrawingId; }, [selectedDrawingId]);
  useEffect(() => { isResizingRef.current = isResizing; }, [isResizing]);
  useEffect(() => { resizeHandleIndexRef.current = resizeHandleIndex; }, [resizeHandleIndex]);

  const getChartCoordinates = useCallback((event: MouseEvent, canvas: HTMLCanvasElement): Point => {
    const rect = rectCacheRef.current ?? (rectCacheRef.current = canvas.getBoundingClientRect());
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const point: Point = { x, y };
    if (chartApi && seriesApi) {
      const timeScale = chartApi.timeScale();
      const logical = timeScale.coordinateToLogical(x);
      const bt = timeScale.coordinateToTime(x);
      const price = seriesApi.coordinateToPrice(y);
      if (logical !== null) point.time = logical;
      if (bt !== null) point.barTime = bt as number;
      if (price !== null) point.price = price;
    }
    return point;
  }, [chartApi, seriesApi]);

  const convertLogicalToPixel = useCallback((point: Point): Point => {
    if (!chartApi || !seriesApi) return point;
    const timeScale = chartApi.timeScale();
    let x = point.x;

    if (point.barTime !== undefined) {
      // Stable path: use actual candle timestamp (survives bar-count changes on reload)
      const coord = timeScale.timeToCoordinate(point.barTime as any);
      if (coord !== null) x = coord;
      else {
        const visibleRange = timeScale.getVisibleLogicalRange();
        if (visibleRange) {
          if ((point.time ?? 0) < visibleRange.from) x = -10000;
          else x = 10000;
        }
      }
    } else if (point.time !== undefined) {
      // Legacy path: logical bar index (kept for backward compat with old saved drawings)
      const coord = timeScale.logicalToCoordinate(point.time as any);
      if (coord !== null) x = coord;
      else {
        const visibleRange = timeScale.getVisibleLogicalRange();
        if (visibleRange) {
          if (point.time < visibleRange.from) x = -10000;
          else if (point.time > visibleRange.to) x = 10000;
        }
      }
    }

    let y = point.y;
    if (point.price !== undefined) {
      const coord = seriesApi.priceToCoordinate(point.price as any);
      if (coord !== null) y = coord;
    }
    return { ...point, x, y };
  }, [chartApi, seriesApi]);

  const HANDLE_SIZE = 8;

  const getResizeHandleAtPoint = (point: Point, drawing: Drawing): number => {
    const points = drawing.points.map(p => convertLogicalToPixel(p));
    for (let i = 0; i < points.length; i++) {
      const hp = points[i];
      if (point.x >= hp.x - HANDLE_SIZE && point.x <= hp.x + HANDLE_SIZE &&
          point.y >= hp.y - HANDLE_SIZE && point.y <= hp.y + HANDLE_SIZE) return i;
    }
    return -1;
  };

  const isPointNearLine = (point: Point, p1: Point, p2: Point, threshold = 8): boolean => {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared === 0) return Math.hypot(point.x - p1.x, point.y - p1.y) <= threshold;
    let t = ((point.x - p1.x) * dx + (point.y - p1.y) * dy) / lengthSquared;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(point.x - (p1.x + t * dx), point.y - (p1.y + t * dy)) <= threshold;
  };

  const isPointNearHorizontalLine = (point: Point, linePoint: Point, threshold = 8): boolean => Math.abs(point.y - linePoint.y) <= threshold;

  const isPointInRectangle = (point: Point, p1: Point, p2: Point, threshold = 8): boolean => {
    const minX = Math.min(p1.x, p2.x), maxX = Math.max(p1.x, p2.x), minY = Math.min(p1.y, p2.y), maxY = Math.max(p1.y, p2.y);
    if (point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY) return true;
    return (Math.abs(point.x - minX) <= threshold && point.y >= minY && point.y <= maxY) ||
           (Math.abs(point.x - maxX) <= threshold && point.y >= minY && point.y <= maxY) ||
           (Math.abs(point.y - minY) <= threshold && point.x >= minX && point.x <= maxX) ||
           (Math.abs(point.y - maxY) <= threshold && point.x >= minX && point.x <= maxX);
  };

  const isPointOnFibonacci = (point: Point, p1: Point, p2: Point, threshold = 8): boolean => {
    const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
    if (point.x < Math.min(p1.x, p2.x) || point.x > Math.max(p1.x, p2.x)) return false;
    return levels.some(l => Math.abs(point.y - (p1.y + (p2.y - p1.y) * l)) <= threshold);
  };

  const isPointOnRiskReward = (point: Point, p1: Point, p2: Point, threshold = 8): boolean => {
    const entryY = p1.y, riskY = p2.y, dy = riskY - entryY, minX = Math.min(p1.x, p2.x), maxX = Math.max(p1.x, p2.x);
    if (point.x < minX - threshold || point.x > maxX + threshold) return false;
    if (Math.abs(point.y - entryY) <= threshold || Math.abs(point.y - riskY) <= threshold) return true;
    return [1, 2, 3].some(r => Math.abs(point.y - (entryY - dy * r)) <= threshold);
  };

  const isPointOnFreehand = (point: Point, points: Point[], threshold = 8): boolean => {
    for (let i = 0; i < points.length - 1; i++) if (isPointNearLine(point, points[i], points[i + 1], threshold)) return true;
    return false;
  };

  const isPointOnText = (point: Point, p1: Point, text: string): boolean => {
    const canvas = canvasRef.current;
    if (!canvas) return false;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    ctx.font = 'bold 14px Inter, system-ui, sans-serif';
    const metrics = ctx.measureText(text);
    return point.x >= p1.x - 5 && point.x <= p1.x + metrics.width + 5 &&
           point.y >= p1.y - 19 && point.y <= p1.y + 5;
  };

  const isPointOnCallout = (point: Point, p1: Point, p2: Point, text: string, threshold = 8): boolean => {
    if (isPointNearLine(point, p1, p2, threshold)) return true;
    const canvas = canvasRef.current;
    if (!canvas) return false;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    ctx.font = 'bold 12px Inter, system-ui, sans-serif';
    const metrics = ctx.measureText(text || 'Note');
    const w = metrics.width + 16, h = 24;
    return point.x >= p2.x - w / 2 && point.x <= p2.x + w / 2 &&
           point.y >= p2.y - h / 2 && point.y <= p2.y + h / 2;
  };

  const isPointOnChannel = (point: Point, points: Point[], threshold = 8): boolean => {
    if (points.length < 2) return false;
    const p1 = points[0], p2 = points[1], p3 = points[2] || p1;
    if (isPointNearLine(point, p1, p2, threshold)) return true;
    const dx = p2.x - p1.x, dy = p2.y - p1.y, m2 = dx * dx + dy * dy;
    if (m2 === 0) return false;
    const t = ((p3.x - p1.x) * dx + (p3.y - p1.y) * dy) / m2;
    const ox = (p3.x - p1.x) - t * dx, oy = (p3.y - p1.y) - t * dy;
    const p1b = { x: p1.x + ox, y: p1.y + oy }, p2b = { x: p2.x + ox, y: p2.y + oy };
    if (isPointNearLine(point, p1b, p2b, threshold)) return true;
    const p1m = { x: p1.x + ox / 2, y: p1.y + oy / 2 }, p2m = { x: p2.x + ox / 2, y: p2.y + oy / 2 };
    return isPointNearLine(point, p1m, p2m, threshold);
  };

  const isPointOnDrawing = (point: Point, drawing: Drawing): boolean => {
    if (drawing.points.length === 0) return false;
    if (drawing.type !== 'text' && drawing.points.length < 2) return false;
    const pts = drawing.points.map(p => convertLogicalToPixel(p));
    const p1 = pts[0], p2 = pts[1] || p1;
    switch (drawing.type) {
      case 'trendline': return isPointNearLine(point, p1, p2);
      case 'horizontal': return isPointNearHorizontalLine(point, p1);
      case 'rectangle': return isPointInRectangle(point, p1, p2);
      case 'fibonacci': return isPointOnFibonacci(point, p1, p2);
      case 'riskReward': return isPointOnRiskReward(point, p1, p2);
      case 'freehand': return isPointOnFreehand(point, pts);
      case 'text': return isPointOnText(point, p1, drawing.text || '');
      case 'callout': return isPointOnCallout(point, p1, p2, drawing.text || '');
      case 'channel': return isPointOnChannel(point, pts);
      default: return false;
    }
  };

  const findDrawingAtPoint = (point: Point, drawings: Drawing[]): Drawing | null => {
    for (let i = drawings.length - 1; i >= 0; i--) {
      const d = drawings[i];
      // Fast bounding-box reject before expensive per-pixel geometry test
      if (d.points.length >= 2) {
        const pts = d.points.map(p => convertLogicalToPixel(p));
        const pad = 12;
        const minX = Math.min(...pts.map(p => p.x)) - pad;
        const maxX = Math.max(...pts.map(p => p.x)) + pad;
        const minY = Math.min(...pts.map(p => p.y)) - pad;
        const maxY = Math.max(...pts.map(p => p.y)) + pad;
        // Horizontal lines span the full width — skip X bounds check for them
        if (d.type !== 'horizontal' && (point.x < minX || point.x > maxX)) continue;
        if (point.y < minY || point.y > maxY) continue;
      }
      if (isPointOnDrawing(point, d)) return d;
    }
    return null;
  };

  const deleteSelectedDrawing = useCallback(() => {
    if (!selectedDrawingId) return;
    pushToHistory();
    setDrawings(prev => prev.filter(d => d.id !== selectedDrawingId));
    setSelectedDrawingId(null);
    setManualLevels(null);
  }, [selectedDrawingId, pushToHistory]);

  const getDrawingColor = useCallback((tool: DrawingTool): string => {
    switch (tool) {
      case 'freehand': return '#E91E63';
      case 'trendline': return '#2962FF';
      case 'horizontal': return '#FF6D00';
      case 'rectangle': return '#00897B40';
      case 'fibonacci': return '#9C27B0';
      case 'riskReward': return '#F44336';
      case 'text': return '#212121';
      case 'callout': return '#673AB7';
      case 'channel': return '#4CAF50';
      default: return '#000000';
    }
  }, []);

  const addTextDrawing = useCallback((point: Point, text: string) => {
    pushToHistory();
    const newId = `drawing-${Date.now()}`;
    setDrawings(p => [...p, { id: newId, type: 'text', points: [point], text, color: getDrawingColor('text') }]);
    setSelectedDrawingId(newId);
    onToolComplete?.();
  }, [getDrawingColor, onToolComplete, pushToHistory]);

  const addCalloutDrawing = useCallback((p1: Point, p2: Point, text: string) => {
    pushToHistory();
    const newId = `drawing-${Date.now()}`;
    setDrawings(p => [...p, { id: newId, type: 'callout', points: [p1, p2], text, color: getDrawingColor('callout') }]);
    setSelectedDrawingId(newId);
    onToolComplete?.();
  }, [getDrawingColor, onToolComplete, pushToHistory]);

  const handleMouseDown = useCallback((event: MouseEvent) => {
    if (!canvasRef.current || event.button !== 0) return false;
    const point = getChartCoordinates(event, canvasRef.current);
    if (activeToolRef.current === 'none') return false;

    // Handle subsequent points for multi-point tools like 'channel'
    if (isDrawingRef.current && activeToolRef.current === 'channel') {
      const pts = currentDrawingRef.current;
      if (pts.length === 2) {
        // Second click: Fix the second point (p2) and prepare to define the width (p3)
        // We use the current point as both the fixed end of the line and the starting point for width
        setCurrentDrawing([pts[0], point, point]);
        return true;
      } else if (pts.length === 3) {
        // Third click: Complete the drawing
        pushToHistory();
        const newId = `drawing-${Date.now()}`;
        setDrawings(p => [...p, { id: newId, type: 'channel', points: [pts[0], pts[1], point], color: getDrawingColor('channel') }]);
        setSelectedDrawingId(newId);
        setCurrentDrawing([]);
        setIsDrawing(false);
        isDrawingRef.current = false;
        onToolComplete?.();
        return true;
      }
    }

    // Check resize handle
    if (activeToolRef.current === 'select' && selectedDrawingIdRef.current) {
      const drawing = getDrawings().find(d => d.id === selectedDrawingIdRef.current);
      if (drawing) {
        const hIdx = getResizeHandleAtPoint(point, drawing);
        if (hIdx !== -1) { pushToHistory(); isInteractingRef.current = true; setIsResizing(true); setResizeHandleIndex(hIdx); return true; }
      }
    }

    const found = findDrawingAtPoint(point, getDrawings());
    if (found && activeToolRef.current === 'select') {
      pushToHistory();
      setSelectedDrawingId(found.id);
      const pts = found.points.map(p => convertLogicalToPixel(p));
      setDragOffset({ x: point.x - pts[0].x, y: point.y - pts[0].y });
      isInteractingRef.current = true;
      setIsDragging(true);
      return true;
    }

    if (activeToolRef.current === 'select') {
      setSelectedDrawingId(null); setIsDragging(false); setIsResizing(false); return false;
    }

    if (activeToolRef.current === 'text') {
      if (onTextToolTrigger) onTextToolTrigger(point);
      else { const t = prompt('Text:'); if (t) addTextDrawing(point, t); }
      return true;
    }

    setSelectedDrawingId(null); setIsDragging(false);
    setCurrentDrawing([point]);
    setIsDrawing(true);
    isDrawingRef.current = true;
    return true;
  }, [getChartCoordinates, convertLogicalToPixel, onTextToolTrigger, addTextDrawing, getDrawingColor, onToolComplete, pushToHistory]);

  const handleMouseMove = useCallback((event: MouseEvent) => {
    if (!canvasRef.current || !chartApi || !seriesApi) return;
    const point = getChartCoordinates(event, canvasRef.current);

    if (isResizingRef.current && isInteractingRef.current && selectedDrawingIdRef.current) {
      const hIdx = resizeHandleIndexRef.current;
      const source = dragBufferRef.current ?? getDrawings();
      const updated = source.map(d => {
        if (d.id !== selectedDrawingIdRef.current) return d;
        const ts = chartApi.timeScale();
        const logical = ts.coordinateToLogical(point.x);
        const bt = ts.coordinateToTime(point.x);
        const price = seriesApi.coordinateToPrice(point.y);
        const newPoints = d.points.map((p, i) => i === hIdx ? { ...p, x: point.x, y: point.y, time: logical ?? p.time, barTime: bt !== null ? bt as number : p.barTime, price: price ?? p.price } : p);
        if (d.type === 'riskReward') {
           const p1 = newPoints[0].price, p2 = newPoints[1]?.price;
           if (p1 && p2 && Math.abs(p1 - p2) > 0) {
             const dist = Math.abs(p1 - p2);
             const newQty = Math.floor(riskPerTrade / dist);
             if (newQty !== useSessionStore.getState().tradeQuantity) setTradeQuantity(newQty);
             setManualLevels({ sl: p2, target: p1 + (p1 - p2) * 2, entry: p1 });
           }
        }
        return { ...d, points: newPoints };
      });
      dragBufferRef.current = updated;
      canvasRef.current.style.cursor = 'crosshair';
      scheduleRender();
      return;
    }

    if (isDraggingRef.current && isInteractingRef.current && selectedDrawingIdRef.current) {
      const source = dragBufferRef.current ?? getDrawings();
      const updated = source.map(d => {
        if (d.id !== selectedDrawingIdRef.current) return d;
        const pts = d.points.map(p => convertLogicalToPixel(p));
        const dx = (point.x - dragOffsetRef.current.x) - pts[0].x;
        const dy = (point.y - dragOffsetRef.current.y) - pts[0].y;
        const newPoints = pts.map(p => {
          const nx = p.x + dx, ny = p.y + dy;
          const ts = chartApi.timeScale(), logical = ts.coordinateToLogical(nx), bt = ts.coordinateToTime(nx), pr = seriesApi.coordinateToPrice(ny);
          return { ...p, x: nx, y: ny, time: logical ?? p.time, barTime: bt !== null ? bt as number : p.barTime, price: pr ?? p.price };
        });
        if (d.type === 'riskReward') {
          const p1 = newPoints[0].price, p2 = newPoints[1]?.price;
          if (p1 && p2 && Math.abs(p1 - p2) > 0) {
            const newQty = Math.floor(riskPerTrade / Math.abs(p1 - p2));
            if (newQty !== useSessionStore.getState().tradeQuantity) setTradeQuantity(newQty);
            setManualLevels({ sl: p2, target: p1 + (p1 - p2) * 2, entry: p1 });
          }
        }
        return { ...d, points: newPoints };
      });
      dragBufferRef.current = updated;
      scheduleRender();
      return;
    }

    if (!isDrawingRef.current || activeToolRef.current === 'none') {
      if (activeToolRef.current === 'select' && canvasRef.current) {
        const found = findDrawingAtPoint(point, getDrawings());
        canvasRef.current.style.cursor = found ? 'pointer' : 'default';
      } else if (canvasRef.current) {
        canvasRef.current.style.cursor = 'crosshair';
      }
      return;
    }

    setCurrentDrawing(prev => {
      if (prev.length === 0) return [point];
      if (activeToolRef.current === 'freehand') return [...prev, point];
      if (activeToolRef.current === 'channel') {
        // Stage 1: Defining the first line (length is 1 or 2)
        if (prev.length === 1 || prev.length === 2) return [prev[0], point];
        // Stage 2: Defining the width (length is 3)
        if (prev.length === 3) return [prev[0], prev[1], point];
        return prev;
      }
      return [prev[0], point];
    });
  }, [getChartCoordinates, convertLogicalToPixel, chartApi, seriesApi, riskPerTrade, setTradeQuantity, setManualLevels]);

  const handleMouseUp = useCallback(() => {
    if (isResizingRef.current) {
      isInteractingRef.current = false;
      if (dragBufferRef.current) { setDrawings(dragBufferRef.current); dragBufferRef.current = null; }
      setIsResizing(false); setResizeHandleIndex(-1); return;
    }
    if (isDraggingRef.current) {
      isInteractingRef.current = false;
      if (dragBufferRef.current) { setDrawings(dragBufferRef.current); dragBufferRef.current = null; }
      setIsDragging(false); return;
    }
    if (!isDrawingRef.current || activeToolRef.current === 'none') return;

    const pts = currentDrawingRef.current;
    if (activeToolRef.current === 'channel' && isDrawingRef.current) {
      if (pts.length === 2) {
        // If we dragged and released, fix p2 and immediately enter Stage 2 (width)
        const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        if (dist > 5) {
          // Advance to 3 points: [p1, p2, p2_placeholder]
          setCurrentDrawing([pts[0], pts[1], pts[1]]);
        }
      }
      return; 
    }

    if (pts.length >= 2) {
      if (activeToolRef.current === 'callout') {
        if (onCalloutTrigger) onCalloutTrigger(pts[0], pts[1]);
        else { const t = prompt('Text:'); if (t) addCalloutDrawing(pts[0], pts[1], t); }
        setCurrentDrawing([]); setIsDrawing(false); return;
      }
      pushToHistory();
      const newId = `drawing-${Date.now()}`;
      setDrawings(prev => [...prev, { id: newId, type: activeToolRef.current, points: pts, color: getDrawingColor(activeToolRef.current) }]);
      setSelectedDrawingId(newId);
      if (activeToolRef.current === 'riskReward' && pts[0].price && pts[1].price) {
        const dist = Math.abs(pts[0].price - pts[1].price);
        if (dist > 0) {
          const finalQty = Math.floor(riskPerTrade / dist);
          if (finalQty !== useSessionStore.getState().tradeQuantity) {
            setTradeQuantity(finalQty);
          }
          setManualLevels({ sl: pts[1].price, target: pts[0].price + (pts[0].price - pts[1].price) * 2, entry: pts[0].price });
        }
      }
    }
    if (activeToolRef.current !== 'freehand') { 
      setCurrentDrawing([]); 
      setIsDrawing(false); 
      isDrawingRef.current = false;
      onToolComplete?.(); 
    }
  }, [onToolComplete, getDrawingColor, riskPerTrade, setTradeQuantity, setManualLevels, onCalloutTrigger, addCalloutDrawing, pushToHistory]);

  const handleUndo = useCallback(() => {
    if (drawingHistoryRef.current.length === 0) return;
    const prev = drawingHistoryRef.current[drawingHistoryRef.current.length - 1];
    drawingHistoryRef.current = drawingHistoryRef.current.slice(0, -1);
    setDrawings(prev);
    setSelectedDrawingId(null);
  }, [setDrawings]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        // Don't intercept undo inside text inputs / textareas / contenteditable
        const tag = (e.target as HTMLElement)?.tagName;
        const isEditable = tag === 'INPUT' || tag === 'TEXTAREA' ||
          (e.target as HTMLElement)?.isContentEditable;
        if (isEditable) return;
        e.preventDefault();
        handleUndo();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [handleUndo]);

  const drawLine = (ctx: CanvasRenderingContext2D, p1: Point, p2: Point, color: string, w = 2) => {
    ctx.strokeStyle = color; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
  };

  const drawRectangle = (ctx: CanvasRenderingContext2D, p1: Point, p2: Point, color: string) => {
    ctx.fillStyle = color; ctx.strokeStyle = color.replace('40', ''); ctx.lineWidth = 2;
    ctx.fillRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y); ctx.strokeRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
  };

  const drawFibonacci = (ctx: CanvasRenderingContext2D, p1: Point, p2: Point, color: string) => {
    const lvls = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
    ctx.font = '12px sans-serif'; ctx.fillStyle = color;
    lvls.forEach(l => {
      const y = p1.y + (p2.y - p1.y) * l;
      ctx.setLineDash([5, 5]); ctx.beginPath(); ctx.moveTo(p1.x, y); ctx.lineTo(p2.x, y); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillText(`${(l * 100).toFixed(1)}%`, p2.x + 5, y + 4);
    });
  };

  const drawRiskReward = (ctx: CanvasRenderingContext2D, p1: Point, p2: Point) => {
    const eY = p1.y, rY = p2.y, dy = rY - eY, minX = Math.min(p1.x, p2.x), maxX = Math.max(p1.x, p2.x);
    ctx.strokeStyle = '#FFC107'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(minX, eY); ctx.lineTo(maxX, eY); ctx.stroke();
    ctx.font = 'bold 12px Inter, sans-serif'; ctx.fillStyle = '#FFC107'; ctx.fillText('E', maxX + 5, eY + 4);
    ctx.strokeStyle = '#F44336'; ctx.beginPath(); ctx.moveTo(minX, rY); ctx.lineTo(maxX, rY); ctx.stroke();
    ctx.fillStyle = '#F44336'; ctx.fillText('S', maxX + 5, rY + 4);
    [{ r: 1, c: '#4CAF50' }, { r: 2, c: '#4CAF50' }, { r: 3, c: '#2E7D32' }].forEach(o => {
      const y = eY - dy * o.r; ctx.strokeStyle = o.c; ctx.setLineDash([5, 5]); ctx.beginPath(); ctx.moveTo(minX, y); ctx.lineTo(maxX, y); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = o.c; ctx.fillText(`${o.r}`, maxX + 5, y + 4);
    });
  };

  const drawChannel = (ctx: CanvasRenderingContext2D, pts: Point[], color: string, isSelected: boolean) => {
    if (pts.length < 2) return;
    const p1 = pts[0], p2 = pts[1];
    
    // Phase 1: Only have the first line
    if (pts.length === 2) {
      ctx.strokeStyle = color; ctx.lineWidth = isSelected ? 3 : 2;
      ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
      return;
    }

    // Phase 2: Parallel line width
    const p3 = pts[2];
    const dx = p2.x - p1.x, dy = p2.y - p1.y, m2 = dx * dx + dy * dy;
    if (m2 === 0) return;
    const t = ((p3.x - p1.x) * dx + (p3.y - p1.y) * dy) / m2;
    const ox = (p3.x - p1.x) - t * dx, oy = (p3.y - p1.y) - t * dy;
    ctx.strokeStyle = color; ctx.lineWidth = isSelected ? 3 : 2;
    ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(p1.x + ox, p1.y + oy); ctx.lineTo(p2.x + ox, p2.y + oy); ctx.stroke();
    ctx.setLineDash([5, 5]); ctx.beginPath(); ctx.moveTo(p1.x + ox / 2, p1.y + oy / 2); ctx.lineTo(p2.x + ox / 2, p2.y + oy / 2); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = color + '15'; ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.lineTo(p2.x + ox, p2.y + oy); ctx.lineTo(p1.x + ox, p1.y + oy); ctx.closePath(); ctx.fill();
  };

  const drawText = (ctx: CanvasRenderingContext2D, p1: Point, text: string, color: string, isSelected: boolean) => {
    ctx.font = 'bold 14px Inter, system-ui, sans-serif';
    const metrics = ctx.measureText(text);
    const width = metrics.width;
    if (isSelected) {
      ctx.fillStyle = '#2196F315';
      ctx.fillRect(p1.x - 5, p1.y - 18, width + 10, 24);
      ctx.strokeStyle = '#2196F3';
      ctx.lineWidth = 1;
      ctx.strokeRect(p1.x - 5, p1.y - 18, width + 10, 24);
    }
    ctx.fillStyle = color;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, p1.x, p1.y - 6);
    ctx.textBaseline = 'alphabetic';
  };

  const drawCallout = (ctx: CanvasRenderingContext2D, p1: Point, p2: Point, text: string, color: string, isSelected: boolean) => {
    ctx.strokeStyle = isSelected ? '#2196F3' : color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
    
    ctx.fillStyle = ctx.strokeStyle;
    ctx.beginPath();
    ctx.arc(p1.x, p1.y, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = 'bold 12px Inter, system-ui, sans-serif';
    const metrics = ctx.measureText(text || 'Note');
    const padding = 8;
    const width = metrics.width + padding * 2;
    const height = 24;
    const x = p2.x - width / 2;
    const y = p2.y - height / 2;

    ctx.fillStyle = isSelected ? '#2196F3' : color;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, width, height, 4);
    else ctx.fillRect(x, y, width, height);
    ctx.fill();

    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text || 'Note', p2.x, p2.y);
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
  };

  const renderCanvas = useCallback(() => {
    if (!canvasRef.current || !chartApi || !seriesApi) return;
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    const { currentIndex: cIdx, isLiveMode } = useSessionStore.getState();

    // Viewport culling: use logical bar indices (same units as d.points[].time)
    const logicalRange = chartApi.timeScale().getVisibleLogicalRange() as { from: number; to: number } | null;

    // Use drag buffer only while an interaction is genuinely active (synchronous flag,
    // not the useEffect-delayed isDraggingRef/isResizingRef which lag by one render).
    const drawingsToRender = (isInteractingRef.current && dragBufferRef.current) ? dragBufferRef.current : getDrawings();
    drawingsToRender.forEach(d => {
      if (!isLiveMode && d.points[0]?.time !== undefined && Math.floor(d.points[0].time) > cIdx) return;
      // Skip drawings whose every point is outside the visible bar range.
      // Horizontal lines span the full width so they're never culled.
      if (logicalRange && d.points.length > 0 && d.type !== 'horizontal') {
        const pad = 5; // extra bars of leeway for trendlines that extend past their anchor
        const allOutside = d.points.every(
          p => p.time !== undefined && (p.time < logicalRange.from - pad || p.time > logicalRange.to + pad)
        );
        if (allOutside) return;
      }
      const pts = d.points.map(p => convertLogicalToPixel(p));
      const isSel = d.id === selectedDrawingId;
      const col = d.color || '#000000';
      switch (d.type) {
        case 'freehand': ctx.strokeStyle = col; ctx.lineWidth = isSel ? 4 : 2; ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); pts.forEach(p => ctx.lineTo(p.x, p.y)); ctx.stroke(); break;
        case 'trendline': drawLine(ctx, pts[0], pts[1], col, isSel ? 4 : 2); break;
        case 'horizontal': drawLine(ctx, { ...pts[0], x: 0 }, { ...pts[0], x: ctx.canvas.width }, col, isSel ? 4 : 2); break;
        case 'rectangle': drawRectangle(ctx, pts[0], pts[1], col); break;
        case 'fibonacci': drawFibonacci(ctx, pts[0], pts[1], col); break;
        case 'riskReward': drawRiskReward(ctx, pts[0], pts[1]); break;
        case 'text': drawText(ctx, pts[0], d.text || '', col, isSel); break;
        case 'callout': drawCallout(ctx, pts[0], pts[1], d.text || '', col, isSel); break;
        case 'channel': drawChannel(ctx, pts, col, isSel); break;
      }
      if (isSel && d.type !== 'text') {
        ctx.fillStyle = '#FFF'; ctx.strokeStyle = '#2196F3'; ctx.lineWidth = 2;
        pts.forEach(p => { ctx.fillRect(p.x - 4, p.y - 4, 8, 8); ctx.strokeRect(p.x - 4, p.y - 4, 8, 8); });
      }
    });
    if (currentDrawing.length >= 1) {
      const col = getDrawingColor(activeTool);
      const pts = currentDrawing.map(p => convertLogicalToPixel(p));
      if (activeTool === 'channel') drawChannel(ctx, pts, col, false);
      else if (pts.length >= 2) switch (activeTool) {
        case 'trendline': drawLine(ctx, pts[0], pts[1], col); break;
        case 'rectangle': drawRectangle(ctx, pts[0], pts[1], col); break;
        case 'riskReward': drawRiskReward(ctx, pts[0], pts[1]); break;
      }
    }
    onCustomRender?.(ctx);
  }, [chartApi, seriesApi, currentDrawing, selectedDrawingId, activeTool, getDrawingColor, convertLogicalToPixel, canvasRef, onCustomRender]);

  const renderCanvasRef = useRef(renderCanvas);
  renderCanvasRef.current = renderCanvas;

  // Collapses all renderCanvas() calls within a single animation frame into one paint
  const scheduleRender = useCallback(() => {
    if (rafIdRef.current) return;
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = 0;
      renderCanvasRef.current?.();
    });
  }, []);

  useEffect(() => { scheduleRender(); }, [renderCanvas, scheduleRender]);

  // Redraw when drawings change without recreating renderCanvas on every drag frame
  useEffect(() => { scheduleRender(); }, [drawings, scheduleRender]);

  useEffect(() => {
    if (!chartApi || !seriesApi) return;

    const sync = () => { scheduleRender(); };
    
    const ts = chartApi.timeScale();
    ts.subscribeVisibleLogicalRangeChange(sync);
    ts.subscribeVisibleTimeRangeChange(sync);

    // This catches Y-axis pans/zooms and other redraw events
    const redrawPrimitive = {
      renderer: () => ({
        draw: sync,
      }),
      update: () => {},
    };

    try {
      seriesApi.attachPrimitive(redrawPrimitive);
    } catch (e) {
      console.warn('Failed to attach redraw primitive:', e);
    }

    return () => {
      ts.unsubscribeVisibleLogicalRangeChange(sync);
      ts.unsubscribeVisibleTimeRangeChange(sync);
      try {
        seriesApi.detachPrimitive(redrawPrimitive);
      } catch (e) {}
    };
  }, [chartApi, seriesApi, scheduleRender]);

  return {
    drawings, clearDrawings: useCallback(() => { setDrawings([]); setCurrentDrawing([]); setSelectedDrawingId(null); }, []),
    addTextDrawing, addCalloutDrawing, deleteSelectedDrawing, selectedDrawingId, isHoveringSelected, handleMouseDown, handleMouseMove, handleMouseUp, renderCanvas, scheduleRender, invalidateRectCache
  };
}

export type { Point };
