import { useRef, useEffect, useState, useCallback } from 'react';
import type { DrawingTool } from '../components/ChartToolbar';

export interface Point {
  x: number;
  y: number;
  price?: number;
  time?: number;
}

export interface Drawing {
  id: string;
  type: DrawingTool;
  points: Point[];
  color?: string;
  text?: string;
}

interface UseChartDrawingsProps {
  canvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  activeTool: DrawingTool;
  onToolComplete?: () => void;
  chartApi: any;
  seriesApi: any;
  onTextToolTrigger?: (point: Point) => void;
  onCalloutTrigger?: (p1: Point, p2: Point) => void;
}

export function useChartDrawings({
  canvasRef,
  activeTool,
  onToolComplete,
  chartApi,
  seriesApi,
  onTextToolTrigger,
  onCalloutTrigger,
}: UseChartDrawingsProps) {
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [currentDrawing, setCurrentDrawing] = useState<Point[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState<Point>({ x: 0, y: 0 });
  const [isHoveringSelected, setIsHoveringSelected] = useState(false);

  // Use refs to track current values without causing re-renders
  const activeToolRef = useRef(activeTool);
  const isDrawingRef = useRef(isDrawing);
  const currentDrawingRef = useRef(currentDrawing);
  const isDraggingRef = useRef(isDragging);
  const dragOffsetRef = useRef(dragOffset);
  const selectedDrawingIdRef = useRef(selectedDrawingId);

  // Keep refs in sync with state
  useEffect(() => {
    activeToolRef.current = activeTool;
  }, [activeTool]);

  useEffect(() => {
    isDrawingRef.current = isDrawing;
  }, [isDrawing]);

  useEffect(() => {
    currentDrawingRef.current = currentDrawing;
  }, [currentDrawing]);

  useEffect(() => {
    isDraggingRef.current = isDragging;
  }, [isDragging]);

  useEffect(() => {
    dragOffsetRef.current = dragOffset;
  }, [dragOffset]);

  useEffect(() => {
    selectedDrawingIdRef.current = selectedDrawingId;
  }, [selectedDrawingId]);

  const getChartCoordinates = useCallback((event: MouseEvent, canvas: HTMLCanvasElement): Point => {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    const point: Point = { x, y };

    if (chartApi && seriesApi) {
      const timeScale = chartApi.timeScale();
      const logical = timeScale.coordinateToLogical(x);
      const price = seriesApi.coordinateToPrice(y);

      if (logical !== null) point.time = logical;
      if (price !== null) point.price = price;
    }

    return point;
  }, [chartApi, seriesApi]);

  const convertLogicalToPixel = useCallback((point: Point): Point => {
    if (!chartApi || !seriesApi) return point;

    const timeScale = chartApi.timeScale();

    // Convert time to X coordinate
    let x = point.x;
    if (point.time !== undefined) {
      const coord = timeScale.logicalToCoordinate(point.time as any);
      if (coord !== null) {
        x = coord;
      } else {
        const visibleRange = timeScale.getVisibleLogicalRange();
        if (visibleRange) {
          if (point.time < visibleRange.from) x = -10000;
          else if (point.time > visibleRange.to) x = 10000;
        }
      }
    }

    // Convert price to Y coordinate
    let y = point.y;
    if (point.price !== undefined) {
      const coord = seriesApi.priceToCoordinate(point.price as any);
      if (coord !== null) {
        y = coord;
      }
    }

    return { ...point, x, y };
  }, [chartApi, seriesApi]);

  // Hit detection helper functions
  const isPointNearLine = (point: Point, p1: Point, p2: Point, threshold = 8): boolean => {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const lengthSquared = dx * dx + dy * dy;

    if (lengthSquared === 0) return Math.hypot(point.x - p1.x, point.y - p1.y) <= threshold;

    let t = ((point.x - p1.x) * dx + (point.y - p1.y) * dy) / lengthSquared;
    t = Math.max(0, Math.min(1, t));

    const projX = p1.x + t * dx;
    const projY = p1.y + t * dy;

    const distance = Math.hypot(point.x - projX, point.y - projY);
    return distance <= threshold;
  };

  const isPointNearHorizontalLine = (point: Point, linePoint: Point, threshold = 8): boolean => {
    return Math.abs(point.y - linePoint.y) <= threshold;
  };

  const isPointInRectangle = (point: Point, p1: Point, p2: Point, threshold = 8): boolean => {
    const minX = Math.min(p1.x, p2.x);
    const maxX = Math.max(p1.x, p2.x);
    const minY = Math.min(p1.y, p2.y);
    const maxY = Math.max(p1.y, p2.y);

    if (point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY) {
      return true;
    }

    const nearLeft = Math.abs(point.x - minX) <= threshold && point.y >= minY && point.y <= maxY;
    const nearRight = Math.abs(point.x - maxX) <= threshold && point.y >= minY && point.y <= maxY;
    const nearTop = Math.abs(point.y - minY) <= threshold && point.x >= minX && point.x <= maxX;
    const nearBottom = Math.abs(point.y - maxY) <= threshold && point.x >= minX && point.x <= maxX;

    return nearLeft || nearRight || nearTop || nearBottom;
  };

  const isPointOnFibonacci = (point: Point, p1: Point, p2: Point, threshold = 8): boolean => {
    const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
    const minX = Math.min(p1.x, p2.x);
    const maxX = Math.max(p1.x, p2.x);

    if (point.x < minX || point.x > maxX) return false;

    for (const level of levels) {
      const y = p1.y + (p2.y - p1.y) * level;
      if (Math.abs(point.y - y) <= threshold) {
        return true;
      }
    }

    return false;
  };

  const isPointOnRiskReward = (point: Point, p1: Point, p2: Point, threshold = 8): boolean => {
    const entry = p1.y;
    const riskLevel = p2.y;
    const riskDistance = Math.abs(riskLevel - entry);
    const isUpward = riskLevel < entry;

    const minX = Math.min(p1.x, p2.x);
    const maxX = Math.max(p1.x, p2.x);

    if (point.x < minX || point.x > maxX) return false;

    if (Math.abs(point.y - entry) <= threshold) return true;

    const ratios = [1, 2, 3];

    for (const ratio of ratios) {
      const rewardY = entry + (isUpward ? -riskDistance * ratio : riskDistance * ratio);
      if (Math.abs(point.y - rewardY) <= threshold) return true;

      const riskY = entry + (isUpward ? riskDistance * ratio : -riskDistance * ratio);
      if (Math.abs(point.y - riskY) <= threshold) return true;
    }

    return false;
  };

  const isPointOnFreehand = (point: Point, points: Point[], threshold = 8): boolean => {
    for (let i = 0; i < points.length - 1; i++) {
      if (isPointNearLine(point, points[i], points[i + 1], threshold)) {
        return true;
      }
    }
    return false;
  };

  const isPointOnText = (point: Point, p1: Point, text: string): boolean => {
    const canvas = canvasRef.current;
    if (!canvas) return false;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;

    ctx.font = 'bold 14px Inter, system-ui, sans-serif';
    const metrics = ctx.measureText(text);
    const width = metrics.width + 10;
    const height = 24;

    return point.x >= p1.x - 5 && point.x <= p1.x + width &&
      point.y >= p1.y - height + 5 && point.y <= p1.y + 5;
  };

  const isPointOnCallout = (point: Point, p1: Point, p2: Point, text: string, threshold = 8): boolean => {
    if (isPointNearLine(point, p1, p2, threshold)) return true;
    const canvas = canvasRef.current;
    if (!canvas) return false;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    ctx.font = 'bold 12px Inter, system-ui, sans-serif';
    const metrics = ctx.measureText(text || 'Note');
    const width = metrics.width + 16;
    const height = 24;
    return point.x >= p2.x - width / 2 && point.x <= p2.x + width / 2 &&
      point.y >= p2.y - height / 2 && point.y <= p2.y + height / 2;
  };

  const isPointOnDrawing = (point: Point, drawing: Drawing): boolean => {
    if (drawing.points.length === 0) return false;
    if (drawing.type !== 'text' && drawing.points.length < 2) return false;

    // Convert anchored points to pixels for hit detection
    const points = drawing.points.map(p => convertLogicalToPixel(p));
    const p1 = points[0];
    const p2 = points[1] || p1;

    switch (drawing.type) {
      case 'trendline':
        return isPointNearLine(point, p1, p2);
      case 'horizontal':
        return isPointNearHorizontalLine(point, p1);
      case 'rectangle':
        return isPointInRectangle(point, p1, p2);
      case 'fibonacci':
        return isPointOnFibonacci(point, p1, p2);
      case 'riskReward':
        return isPointOnRiskReward(point, p1, p2);
      case 'freehand':
        return isPointOnFreehand(point, points);
      case 'text':
        return isPointOnText(point, p1, drawing.text || '');
      case 'callout':
        return isPointOnCallout(point, p1, p2, drawing.text || '');
      default:
        return false;
    }
  };

  const findDrawingAtPoint = (point: Point, drawings: Drawing[]): Drawing | null => {
    for (let i = drawings.length - 1; i >= 0; i--) {
      if (isPointOnDrawing(point, drawings[i])) {
        return drawings[i];
      }
    }
    return null;
  };

  const deleteSelectedDrawing = useCallback(() => {
    if (!selectedDrawingId) return;
    setDrawings(prev => prev.filter(d => d.id !== selectedDrawingId));
    setSelectedDrawingId(null);
  }, [selectedDrawingId]);

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
      default: return '#000000';
    }
  }, []);

  const addTextDrawing = useCallback((point: Point, text: string) => {
    const newId = `drawing-${Date.now()}-${Math.random()}`;
    const newDrawing: Drawing = {
      id: newId,
      type: 'text',
      points: [point],
      text: text,
      color: getDrawingColor('text'),
    };
    setDrawings((prev) => [...prev, newDrawing]);
    setSelectedDrawingId(newId);
    onToolComplete?.();
  }, [getDrawingColor, onToolComplete]);

  const addCalloutDrawing = useCallback((p1: Point, p2: Point, text: string) => {
    const newId = `drawing-${Date.now()}-${Math.random()}`;
    const newDrawing: Drawing = {
      id: newId,
      type: 'callout',
      points: [p1, p2],
      text: text,
      color: getDrawingColor('callout'),
    };
    setDrawings((prev) => [...prev, newDrawing]);
    setSelectedDrawingId(newId);
    onToolComplete?.();
  }, [getDrawingColor, onToolComplete]);

  const handleMouseDown = useCallback((event: MouseEvent) => {
    if (!canvasRef.current) return;
    const point = getChartCoordinates(event, canvasRef.current);

    if (activeToolRef.current === 'none') return;

    const foundDrawing = findDrawingAtPoint(point, drawings);

    if (foundDrawing) {
      if (foundDrawing.id === selectedDrawingIdRef.current) {
        if (activeToolRef.current === 'select') {
          const points = foundDrawing.points.map(p => convertLogicalToPixel(p));
          const firstPoint = points[0];
          setDragOffset({
            x: point.x - firstPoint.x,
            y: point.y - firstPoint.y,
          });
          setIsDragging(true);
        }
      } else {
        setSelectedDrawingId(foundDrawing.id);
        setIsDragging(false);
      }
      if (activeToolRef.current === 'select') return;
      return;
    }

    if (activeToolRef.current === 'select') {
      setSelectedDrawingId(null);
      setIsDragging(false);
      return;
    }

    // Handle Text tool
    if (activeToolRef.current === 'text') {
      if (onTextToolTrigger) {
        onTextToolTrigger(point);
      } else {
        // Fallback if no trigger provided
        const text = prompt('Enter text:');
        if (text) {
          addTextDrawing(point, text);
        }
      }
      return;
    }

    setSelectedDrawingId(null);
    setIsDragging(false);

    setCurrentDrawing([point]);
    setIsDrawing(true);
  }, [drawings, getChartCoordinates, convertLogicalToPixel, onTextToolTrigger, addTextDrawing]);

  const handleMouseMove = useCallback((event: MouseEvent) => {
    if (!canvasRef.current || !chartApi || !seriesApi) return;

    const point = getChartCoordinates(event, canvasRef.current);

    if (isDraggingRef.current && activeToolRef.current === 'select' && selectedDrawingIdRef.current) {
      setDrawings((prevDrawings) => {
        return prevDrawings.map((drawing) => {
          if (drawing.id === selectedDrawingIdRef.current) {
            const currentPoints = drawing.points.map(p => convertLogicalToPixel(p));
            const newFirstPointPixel = {
              x: point.x - dragOffsetRef.current.x,
              y: point.y - dragOffsetRef.current.y,
            };

            const deltaX = newFirstPointPixel.x - currentPoints[0].x;
            const deltaY = newFirstPointPixel.y - currentPoints[0].y;

            const newPoints = currentPoints.map((p) => {
              const movedPixel = { x: p.x + deltaX, y: p.y + deltaY };
              const timeScale = chartApi.timeScale();
              const logical = timeScale.coordinateToLogical(movedPixel.x);
              const price = seriesApi.coordinateToPrice(movedPixel.y);

              return {
                ...movedPixel,
                time: logical !== null ? logical : p.time,
                price: price !== null ? price : p.price,
              };
            });

            return { ...drawing, points: newPoints };
          }
          return drawing;
        });
      });
      return;
    }

    if (activeToolRef.current === 'select' && selectedDrawingIdRef.current && !isDraggingRef.current) {
      const selectedDrawing = drawings.find(d => d.id === selectedDrawingIdRef.current);
      if (selectedDrawing && isPointOnDrawing(point, selectedDrawing)) {
        setIsHoveringSelected(true);
      } else {
        setIsHoveringSelected(false);
      }
    }

    if (!isDrawingRef.current || activeToolRef.current === 'none') return;

    setCurrentDrawing((prev) => {
      if (prev.length === 0) return [point];
      if (activeToolRef.current === 'freehand') return [...prev, point];
      if (['trendline', 'horizontal', 'rectangle', 'fibonacci', 'riskReward', 'callout'].includes(activeToolRef.current)) {
        return [prev[0], point];
      }
      return [...prev, point];
    });
  }, [drawings, getChartCoordinates, convertLogicalToPixel, chartApi, seriesApi]);

  const handleMouseUp = useCallback(() => {
    if (isDraggingRef.current) {
      setIsDragging(false);
      return;
    }

    if (!isDrawingRef.current || activeToolRef.current === 'none') return;

    if (currentDrawingRef.current.length >= 2) {
      if (activeToolRef.current === 'callout') {
        const p1 = currentDrawingRef.current[0];
        const p2 = currentDrawingRef.current[1];
        if (onCalloutTrigger) {
          onCalloutTrigger(p1, p2);
        } else {
          const text = prompt('Enter text:');
          if (text) addCalloutDrawing(p1, p2, text);
        }
        setCurrentDrawing([]);
        setIsDrawing(false);
        return;
      }

      const newId = `drawing-${Date.now()}-${Math.random()}`;
      const newDrawing: Drawing = {
        id: newId,
        type: activeToolRef.current,
        points: currentDrawingRef.current,
        color: getDrawingColor(activeToolRef.current),
      };
      setDrawings((prev) => [...prev, newDrawing]);
      setSelectedDrawingId(newId);
    }

    setCurrentDrawing([]);
    setIsDrawing(false);

    if (activeToolRef.current !== 'freehand') {
      onToolComplete?.();
    }
  }, [onToolComplete, getDrawingColor]);

  const drawLine = (ctx: CanvasRenderingContext2D, p1: Point, p2: Point, color: string, width = 2) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
  };

  const drawRectangle = (ctx: CanvasRenderingContext2D, p1: Point, p2: Point, color: string) => {
    ctx.fillStyle = color;
    ctx.strokeStyle = color.replace('40', '');
    ctx.lineWidth = 2;
    const width = p2.x - p1.x;
    const height = p2.y - p1.y;
    ctx.fillRect(p1.x, p1.y, width, height);
    ctx.strokeRect(p1.x, p1.y, width, height);
  };

  const drawFibonacci = (ctx: CanvasRenderingContext2D, p1: Point, p2: Point, color: string) => {
    const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
    const labels = ['0%', '23.6%', '38.2%', '50%', '61.8%', '78.6%', '100%'];
    ctx.font = '12px sans-serif';
    ctx.fillStyle = color;
    levels.forEach((level, i) => {
      const y = p1.y + (p2.y - p1.y) * level;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(p1.x, y);
      ctx.lineTo(p2.x, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillText(labels[i], p2.x + 5, y + 4);
    });
  };

  const drawRiskReward = (ctx: CanvasRenderingContext2D, p1: Point, p2: Point, _color: string) => {
    const entry = p1.y;
    const riskLevel = p2.y;
    const riskDistance = Math.abs(riskLevel - entry);
    const isUpward = riskLevel < entry;

    ctx.strokeStyle = '#FFC107';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(p1.x, entry);
    ctx.lineTo(p2.x, entry);
    ctx.stroke();

    ctx.font = '12px sans-serif';
    ctx.fillStyle = '#FFC107';
    ctx.fillText('Entry', p2.x + 5, entry + 4);

    const ratios = [
      { ratio: 1, color: '#4CAF50', label: '1:1' },
      { ratio: 2, color: '#2196F3', label: '1:2' },
      { ratio: 3, color: '#9C27B0', label: '1:3' }
    ];

    ratios.forEach(({ ratio, color, label }) => {
      const rewardY = entry + (isUpward ? -riskDistance * ratio : riskDistance * ratio);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(p1.x, rewardY);
      ctx.lineTo(p2.x, rewardY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = color;
      ctx.fillText(label, p2.x + 5, rewardY + 4);

      const riskY = entry + (isUpward ? riskDistance * ratio : -riskDistance * ratio);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(p1.x, riskY);
      ctx.lineTo(p2.x, riskY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = color;
      ctx.fillText(label, p2.x + 5, riskY + 4);
    });
  };

  const drawFreehand = (ctx: CanvasRenderingContext2D, points: Point[], color: string, width = 2) => {
    if (points.length < 2) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.stroke();
  };

  const drawText = (ctx: CanvasRenderingContext2D, p1: Point, text: string, color: string, isSelected: boolean) => {
    ctx.font = 'bold 14px Inter, system-ui, sans-serif';
    const metrics = ctx.measureText(text);
    const width = metrics.width;

    if (isSelected) {
      ctx.fillStyle = '#2196F320';
      ctx.fillRect(p1.x - 5, p1.y - 20, width + 10, 25);
      ctx.strokeStyle = '#2196F3';
      ctx.lineWidth = 1;
      ctx.strokeRect(p1.x - 5, p1.y - 20, width + 10, 25);
    }

    ctx.fillStyle = color;
    ctx.fillText(text, p1.x, p1.y);
  };

  const drawCallout = (ctx: CanvasRenderingContext2D, p1: Point, p2: Point, text: string, color: string, isSelected: boolean) => {
    ctx.strokeStyle = isSelected ? '#2196F3' : color;
    ctx.lineWidth = 1.5;
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
    ctx.fillStyle = isSelected ? '#2196F3' : color;
    const x = p2.x - width / 2;
    const y = p2.y - height / 2;
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, 4);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text || 'Note', p2.x, p2.y);
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
  };

  const drawSelectionHandles = (ctx: CanvasRenderingContext2D, points: Point[]) => {
    ctx.fillStyle = '#2196F3';
    points.forEach(point => {
      if (point.x < 0 || point.x > ctx.canvas.width || point.y < 0 || point.y > ctx.canvas.height) return;
      ctx.beginPath();
      ctx.arc(point.x, point.y, 5, 0, 2 * Math.PI);
      ctx.fill();
    });
  };

  const renderDrawing = useCallback((ctx: CanvasRenderingContext2D, drawing: Drawing, isSelected: boolean = false) => {
    if (drawing.points.length === 0) return;
    const points = drawing.points.map(p => convertLogicalToPixel(p));
    const p1 = points[0];
    const p2 = points[1] || p1;
    const color = drawing.color || '#000000';
    const lineWidth = isSelected ? 4 : 2;

    switch (drawing.type) {
      case 'freehand': drawFreehand(ctx, points, color, lineWidth); break;
      case 'trendline': drawLine(ctx, p1, p2, color, lineWidth); break;
      case 'horizontal': drawLine(ctx, { ...p1, x: 0 }, { ...p1, x: ctx.canvas.width }, color, lineWidth); break;
      case 'rectangle': drawRectangle(ctx, p1, p2, color); break;
      case 'fibonacci': drawFibonacci(ctx, p1, p2, color); break;
      case 'riskReward': drawRiskReward(ctx, p1, p2, color); break;
      case 'text': drawText(ctx, p1, drawing.text || '', color, isSelected); break;
      case 'callout': drawCallout(ctx, p1, p2, drawing.text || '', color, isSelected); break;
    }

    if (isSelected && drawing.type !== 'text') {
      drawSelectionHandles(ctx, points);
    }
  }, [convertLogicalToPixel]);

  const renderCanvas = useCallback(() => {
    if (!canvasRef.current || !chartApi || !seriesApi) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawings.forEach((drawing) => {
      renderDrawing(ctx, drawing, drawing.id === selectedDrawingId);
    });
    if (currentDrawing.length >= 2) {
      renderDrawing(ctx, { id: 'temp', type: activeTool, points: currentDrawing, color: getDrawingColor(activeTool) }, false);
    }
  }, [chartApi, seriesApi, drawings, currentDrawing, selectedDrawingId, activeTool, getDrawingColor, renderDrawing, canvasRef]);

  useEffect(() => {
    renderCanvas();
  }, [renderCanvas]);

  useEffect(() => {
    if (!chartApi || !seriesApi) return;
    const timeScale = chartApi.timeScale();
    const handleSync = () => requestAnimationFrame(() => renderCanvas());
    timeScale.subscribeVisibleLogicalRangeChange(handleSync);
    return () => timeScale.unsubscribeVisibleLogicalRangeChange(handleSync);
  }, [chartApi, seriesApi, renderCanvas]);

  const clearDrawings = () => {
    setDrawings([]);
    setCurrentDrawing([]);
    setSelectedDrawingId(null);
  };

  return {
    drawings,
    clearDrawings,
    addTextDrawing,
    addCalloutDrawing,
    deleteSelectedDrawing,
    selectedDrawingId,
    isHoveringSelected,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
  };
}
