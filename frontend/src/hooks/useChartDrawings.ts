import { useRef, useEffect, useState } from 'react';
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
  activeTool: DrawingTool;
  onToolComplete?: () => void;
}

export function useChartDrawings({ chartRef, activeTool, onToolComplete }: UseChartDrawingsProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [currentDrawing, setCurrentDrawing] = useState<Point[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);

  const getChartCoordinates = (event: MouseEvent, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    // Try to convert to price and time if chart is available
    let price, time;
    try {
      if (chartRef.current) {
        const timeScale = chartRef.current.timeScale();
        const priceScale = chartRef.current.priceScale();

        time = timeScale.coordinateToTime(x);
        price = priceScale.coordinateToPrice(y);
      }
    } catch (e) {
      // If conversion fails, just use pixel coordinates
    }

    return { x, y, price, time };
  };

  const handleMouseDown = (event: MouseEvent) => {
    if (activeTool === 'none' || !canvasRef.current) return;

    const point = getChartCoordinates(event, canvasRef.current);
    setCurrentDrawing([point]);
    setIsDrawing(true);
  };

  const handleMouseMove = (event: MouseEvent) => {
    if (!isDrawing || activeTool === 'none' || !canvasRef.current) return;

    const point = getChartCoordinates(event, canvasRef.current);
    setCurrentDrawing((prev) => {
      // For most tools, we only need start and end point
      if (prev.length === 0) return [point];
      if (activeTool === 'trendline' || activeTool === 'horizontal' ||
          activeTool === 'rectangle' || activeTool === 'fibonacci' ||
          activeTool === 'riskReward') {
        return [prev[0], point];
      }
      return [...prev, point];
    });
  };

  const handleMouseUp = () => {
    if (!isDrawing || activeTool === 'none') return;

    if (currentDrawing.length >= 2) {
      const newDrawing: Drawing = {
        id: `drawing-${Date.now()}-${Math.random()}`,
        type: activeTool,
        points: currentDrawing,
        color: getDrawingColor(activeTool),
      };
      setDrawings((prev) => [...prev, newDrawing]);
    }

    setCurrentDrawing([]);
    setIsDrawing(false);
    onToolComplete?.();
  };

  const getDrawingColor = (tool: DrawingTool): string => {
    switch (tool) {
      case 'trendline': return '#2962FF';
      case 'horizontal': return '#FF6D00';
      case 'rectangle': return '#00897B40';
      case 'fibonacci': return '#9C27B0';
      case 'riskReward': return '#F44336';
      default: return '#000000';
    }
  };

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

    const [p1, p2] = drawing.points;
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
    if (currentDrawing.length >= 2) {
      const tempDrawing: Drawing = {
        id: 'temp',
        type: activeTool,
        points: currentDrawing,
        color: getDrawingColor(activeTool),
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
    canvasRef,
    drawings,
    clearDrawings,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
  };
}
