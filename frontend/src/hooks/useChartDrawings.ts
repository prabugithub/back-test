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
  chartRef: React.MutableRefObject<any>;
  canvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  activeTool: DrawingTool;
  onToolComplete?: () => void;
}

export function useChartDrawings({ chartRef, canvasRef, activeTool, onToolComplete }: UseChartDrawingsProps) {
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [currentDrawing, setCurrentDrawing] = useState<Point[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);

  // Use refs to track current values without causing re-renders
  const activeToolRef = useRef(activeTool);
  const isDrawingRef = useRef(isDrawing);
  const currentDrawingRef = useRef(currentDrawing);

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

  const getChartCoordinates = useCallback((event: MouseEvent, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    return { x, y };
  }, []);

  const handleMouseDown = useCallback((event: MouseEvent) => {
    console.log('handleMouseDown called', { activeTool: activeToolRef.current, hasCanvas: !!canvasRef.current });
    if (activeToolRef.current === 'none' || !canvasRef.current) return;

    const point = getChartCoordinates(event, canvasRef.current);
    console.log('Drawing started at:', point);
    setCurrentDrawing([point]);
    setIsDrawing(true);
  }, []);

  const handleMouseMove = useCallback((event: MouseEvent) => {
    if (!isDrawingRef.current || activeToolRef.current === 'none' || !canvasRef.current) return;

    const point = getChartCoordinates(event, canvasRef.current);
    setCurrentDrawing((prev) => {
      // For most tools, we only need start and end point
      if (prev.length === 0) return [point];
      if (activeToolRef.current === 'trendline' || activeToolRef.current === 'horizontal' ||
          activeToolRef.current === 'rectangle' || activeToolRef.current === 'fibonacci' ||
          activeToolRef.current === 'riskReward') {
        return [prev[0], point];
      }
      return [...prev, point];
    });
  }, []);

  const handleMouseUp = useCallback(() => {
    if (!isDrawingRef.current || activeToolRef.current === 'none') return;

    if (currentDrawingRef.current.length >= 2) {
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

  const drawRiskReward = (ctx: CanvasRenderingContext2D, p1: Point, p2: Point, color: string) => {
    // Entry at p1, target at p2
    const entry = p1.y;
    const target = p2.y;
    const distance = Math.abs(target - entry);

    // Stop loss is same distance in opposite direction
    const stopLoss = entry + (entry > target ? distance : -distance);

    // Draw entry line (green)
    ctx.strokeStyle = '#4CAF50';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(p1.x, entry);
    ctx.lineTo(p2.x, entry);
    ctx.stroke();

    // Draw target line (blue)
    ctx.strokeStyle = '#2196F3';
    ctx.beginPath();
    ctx.moveTo(p1.x, target);
    ctx.lineTo(p2.x, target);
    ctx.stroke();

    // Draw stop loss line (red)
    ctx.strokeStyle = '#F44336';
    ctx.beginPath();
    ctx.moveTo(p1.x, stopLoss);
    ctx.lineTo(p2.x, stopLoss);
    ctx.stroke();

    // Draw labels
    ctx.font = '12px sans-serif';
    ctx.fillStyle = '#4CAF50';
    ctx.fillText('Entry', p2.x + 5, entry + 4);
    ctx.fillStyle = '#2196F3';
    ctx.fillText('Target (1:1)', p2.x + 5, target + 4);
    ctx.fillStyle = '#F44336';
    ctx.fillText('Stop Loss', p2.x + 5, stopLoss + 4);

    // Calculate R:R ratio
    const reward = Math.abs(target - entry);
    const risk = Math.abs(entry - stopLoss);
    const ratio = (reward / risk).toFixed(2);

    ctx.fillStyle = '#000';
    ctx.fillText(`R:R = 1:${ratio}`, (p1.x + p2.x) / 2, entry - 10);
  };

  const renderDrawing = (ctx: CanvasRenderingContext2D, drawing: Drawing) => {
    if (drawing.points.length < 2) return;

    // Use pixel coordinates directly
    const p1 = drawing.points[0];
    const p2 = drawing.points[1];
    const color = drawing.color || '#000000';

    switch (drawing.type) {
      case 'trendline':
        drawLine(ctx, p1, p2, color);
        break;
      case 'horizontal':
        drawLine(ctx, { ...p1, x: 0 }, { ...p2, x: ctx.canvas.width }, color);
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
  };

  const renderCanvas = () => {
    if (!canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw all completed drawings
    drawings.forEach((drawing) => renderDrawing(ctx, drawing));

    // Draw current drawing in progress
    if (currentDrawingRef.current.length >= 2) {
      const tempDrawing: Drawing = {
        id: 'temp',
        type: activeToolRef.current,
        points: currentDrawingRef.current,
        color: getDrawingColor(activeToolRef.current),
      };
      renderDrawing(ctx, tempDrawing);
    }
  };

  useEffect(() => {
    renderCanvas();
  }, [drawings, currentDrawing]);

  const clearDrawings = () => {
    setDrawings([]);
    setCurrentDrawing([]);
  };

  return {
    drawings,
    clearDrawings,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
  };
}
