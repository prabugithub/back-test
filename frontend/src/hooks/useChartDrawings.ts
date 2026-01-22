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
}

interface UseChartDrawingsProps {
  canvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  activeTool: DrawingTool;
  onToolComplete?: () => void;
}

export function useChartDrawings({ canvasRef, activeTool, onToolComplete }: UseChartDrawingsProps) {
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

  const getChartCoordinates = useCallback((event: MouseEvent, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    return { x, y };
  }, []);

  // Hit detection helper functions
  const isPointNearLine = (point: Point, p1: Point, p2: Point, threshold = 8): boolean => {
    // Calculate perpendicular distance from point to line segment
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const lengthSquared = dx * dx + dy * dy;

    if (lengthSquared === 0) return Math.hypot(point.x - p1.x, point.y - p1.y) <= threshold;

    // Project point onto line segment
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

    // Check if inside bounds
    if (point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY) {
      return true;
    }

    // Check if near edges
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

    // Check if point is within X bounds
    if (point.x < minX || point.x > maxX) return false;

    // Check if near any fibonacci level
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

    // Check if point is within X bounds
    if (point.x < minX || point.x > maxX) return false;

    // Check entry line
    if (Math.abs(point.y - entry) <= threshold) return true;

    // Check all reward and risk levels (1:1, 1:2, 1:3 on both sides)
    const ratios = [1, 2, 3];

    for (const ratio of ratios) {
      // Reward levels (opposite direction from risk)
      const rewardY = entry + (isUpward ? -riskDistance * ratio : riskDistance * ratio);
      if (Math.abs(point.y - rewardY) <= threshold) return true;

      // Risk levels (same direction as p2)
      const riskY = entry + (isUpward ? riskDistance * ratio : -riskDistance * ratio);
      if (Math.abs(point.y - riskY) <= threshold) return true;
    }

    return false;
  };

  const isPointOnFreehand = (point: Point, points: Point[], threshold = 8): boolean => {
    // Check if point is near any segment of the freehand path
    for (let i = 0; i < points.length - 1; i++) {
      if (isPointNearLine(point, points[i], points[i + 1], threshold)) {
        return true;
      }
    }
    return false;
  };

  const isPointOnDrawing = (point: Point, drawing: Drawing): boolean => {
    if (drawing.points.length < 2) return false;

    const p1 = drawing.points[0];
    const p2 = drawing.points[1];

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
        return isPointOnFreehand(point, drawing.points);
      default:
        return false;
    }
  };

  const findDrawingAtPoint = (point: Point, drawings: Drawing[]): Drawing | null => {
    // Iterate in reverse to select top-most (newest) drawing first
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

  const handleMouseDown = useCallback((event: MouseEvent) => {
    if (!canvasRef.current) return;
    const point = getChartCoordinates(event, canvasRef.current);

    // Handle selection mode
    if (activeToolRef.current === 'select') {
      const foundDrawing = findDrawingAtPoint(point, drawings);
      if (foundDrawing) {
        if (foundDrawing.id === selectedDrawingIdRef.current) {
          const firstPoint = foundDrawing.points[0];
          setDragOffset({
            x: point.x - firstPoint.x,
            y: point.y - firstPoint.y,
          });
          setIsDragging(true);
        } else {
          setSelectedDrawingId(foundDrawing.id);
          setIsDragging(false);
        }
      } else {
        setSelectedDrawingId(null);
        setIsDragging(false);
      }
      return;
    }

    // Handle drawing mode
    if (activeToolRef.current === 'none') return;

    // Clear selection when starting a new drawing
    setSelectedDrawingId(null);
    setIsDragging(false);

    setCurrentDrawing([point]);
    setIsDrawing(true);
  }, [drawings, getChartCoordinates]);

  const handleMouseMove = useCallback((event: MouseEvent) => {
    if (!canvasRef.current) return;

    const point = getChartCoordinates(event, canvasRef.current);

    // Handle dragging selected drawing
    if (isDraggingRef.current && activeToolRef.current === 'select' && selectedDrawingIdRef.current) {

      setDrawings((prevDrawings) => {
        return prevDrawings.map((drawing) => {
          if (drawing.id === selectedDrawingIdRef.current) {
            // Calculate new position based on drag offset
            const newFirstPoint = {
              x: point.x - dragOffsetRef.current.x,
              y: point.y - dragOffsetRef.current.y,
            };

            // Calculate the delta from original position
            const deltaX = newFirstPoint.x - drawing.points[0].x;
            const deltaY = newFirstPoint.y - drawing.points[0].y;

            // Move all points by the same delta
            const newPoints = drawing.points.map((p) => ({
              x: p.x + deltaX,
              y: p.y + deltaY,
            }));

            return { ...drawing, points: newPoints };
          }
          return drawing;
        });
      });
      return;
    }

    // Check if hovering over selected drawing in select mode
    if (activeToolRef.current === 'select' && selectedDrawingIdRef.current && !isDraggingRef.current) {
      const selectedDrawing = drawings.find(d => d.id === selectedDrawingIdRef.current);
      if (selectedDrawing && isPointOnDrawing(point, selectedDrawing)) {
        setIsHoveringSelected(true);
      } else {
        setIsHoveringSelected(false);
      }
    }

    // Handle normal drawing
    if (!isDrawingRef.current || activeToolRef.current === 'none') return;

    setCurrentDrawing((prev) => {
      // For most tools, we only need start and end point
      if (prev.length === 0) return [point];

      // For freehand, continuously add points
      if (activeToolRef.current === 'freehand') {
        return [...prev, point];
      }

      // For other tools, only keep start and current end point
      if (activeToolRef.current === 'trendline' || activeToolRef.current === 'horizontal' ||
        activeToolRef.current === 'rectangle' || activeToolRef.current === 'fibonacci' ||
        activeToolRef.current === 'riskReward') {
        return [prev[0], point];
      }
      return [...prev, point];
    });
  }, [drawings, getChartCoordinates]);

  const handleMouseUp = useCallback(() => {
    // Stop dragging if in drag mode
    // Stop dragging if in drag mode
    if (isDraggingRef.current) {
      setIsDragging(false);
      return;
    }

    // Handle normal drawing completion
    if (!isDrawingRef.current || activeToolRef.current === 'none') return;

    // For freehand, accept any drawing with at least 2 points
    // For other tools, require at least 2 points
    const minPoints = activeToolRef.current === 'freehand' ? 2 : 2;

    if (currentDrawingRef.current.length >= minPoints) {
      const newDrawing: Drawing = {
        id: `drawing-${Date.now()}-${Math.random()}`,
        type: activeToolRef.current,
        points: currentDrawingRef.current,
        color: getDrawingColor(activeToolRef.current),
      };
      setDrawings((prev) => [...prev, newDrawing]);
    }

    setCurrentDrawing([]);
    setIsDrawing(false);
    onToolComplete?.();
  }, [onToolComplete]);

  const getDrawingColor = useCallback((tool: DrawingTool): string => {
    switch (tool) {
      case 'freehand': return '#E91E63';
      case 'trendline': return '#2962FF';
      case 'horizontal': return '#FF6D00';
      case 'rectangle': return '#00897B40';
      case 'fibonacci': return '#9C27B0';
      case 'riskReward': return '#F44336';
      default: return '#000000';
    }
  }, []);

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

      // Draw horizontal line
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(p1.x, y);
      ctx.lineTo(p2.x, y);
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw label
      ctx.fillText(labels[i], p2.x + 5, y + 4);
    });
  };

  const drawRiskReward = (ctx: CanvasRenderingContext2D, p1: Point, p2: Point, _color: string) => {
    // Entry at p1, risk level at p2
    const entry = p1.y;
    const riskLevel = p2.y;
    const riskDistance = Math.abs(riskLevel - entry);

    // Determine direction (true = upward targets, false = downward targets)
    const isUpward = riskLevel < entry;

    // Draw entry line (yellow/gold)
    ctx.strokeStyle = '#FFC107';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(p1.x, entry);
    ctx.lineTo(p2.x, entry);
    ctx.stroke();

    // Draw entry label
    ctx.font = '12px sans-serif';
    ctx.fillStyle = '#FFC107';
    ctx.fillText('Entry', p2.x + 5, entry + 4);

    // Risk-reward ratios to display
    const ratios = [
      { ratio: 1, color: '#4CAF50', label: '1:1' },
      { ratio: 2, color: '#2196F3', label: '1:2' },
      { ratio: 3, color: '#9C27B0', label: '1:3' }
    ];

    // Draw reward levels (in the direction opposite to risk)
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

      // Draw label
      ctx.fillStyle = color;
      ctx.fillText(label, p2.x + 5, rewardY + 4);
    });

    // Draw risk levels (in the same direction as p2)
    ratios.forEach(({ ratio, color, label }) => {
      const riskY = entry + (isUpward ? riskDistance * ratio : -riskDistance * ratio);

      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(p1.x, riskY);
      ctx.lineTo(p2.x, riskY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw label
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

    // Draw smooth path through all points
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }

    ctx.stroke();
  };

  const drawSelectionHandles = (ctx: CanvasRenderingContext2D, points: Point[]) => {
    ctx.fillStyle = '#2196F3';
    points.forEach(point => {
      ctx.beginPath();
      ctx.arc(point.x, point.y, 5, 0, 2 * Math.PI);
      ctx.fill();
    });
  };

  const renderDrawing = (ctx: CanvasRenderingContext2D, drawing: Drawing, isSelected: boolean = false) => {
    if (drawing.points.length < 2) return;

    // Use pixel coordinates directly
    const p1 = drawing.points[0];
    const p2 = drawing.points[1];
    const color = drawing.color || '#000000';

    // Use thicker line for selected drawings
    const lineWidth = isSelected ? 4 : 2;

    switch (drawing.type) {
      case 'freehand':
        drawFreehand(ctx, drawing.points, color, lineWidth);
        break;
      case 'trendline':
        drawLine(ctx, p1, p2, color, lineWidth);
        break;
      case 'horizontal':
        drawLine(ctx, { ...p1, x: 0 }, { ...p2, x: ctx.canvas.width }, color, lineWidth);
        break;
      case 'rectangle':
        drawRectangle(ctx, p1, p2, color);
        break;
      case 'fibonacci':
        drawFibonacci(ctx, p1, p2, color);
        break;
      case 'riskReward':
        drawRiskReward(ctx, p1, p2, color);
        break;
    }

    // Draw selection handles for selected drawing
    if (isSelected) {
      drawSelectionHandles(ctx, drawing.points);
    }
  };

  const renderCanvas = () => {
    if (!canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw all completed drawings
    drawings.forEach((drawing) => {
      const isSelected = drawing.id === selectedDrawingId;
      renderDrawing(ctx, drawing, isSelected);
    });

    // Draw current drawing in progress
    if (currentDrawingRef.current.length >= 2) {
      const tempDrawing: Drawing = {
        id: 'temp',
        type: activeToolRef.current,
        points: currentDrawingRef.current,
        color: getDrawingColor(activeToolRef.current),
      };
      renderDrawing(ctx, tempDrawing, false);
    }
  };

  useEffect(() => {
    renderCanvas();
  }, [drawings, currentDrawing, selectedDrawingId]);

  const clearDrawings = () => {
    setDrawings([]);
    setCurrentDrawing([]);
    setSelectedDrawingId(null);
  };

  return {
    drawings,
    clearDrawings,
    deleteSelectedDrawing,
    selectedDrawingId,
    isHoveringSelected,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
  };
}
