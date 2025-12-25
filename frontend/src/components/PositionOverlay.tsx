import { useState, useRef, useEffect } from 'react';
import { useSessionStore } from '../stores/sessionStore';
import { formatCurrency } from '../utils/formatters';

export function PositionOverlay() {
    const position = useSessionStore((s) => s.position);
    const candles = useSessionStore((s) => s.candles);
    const currentIndex = useSessionStore((s) => s.currentIndex);

    // State for dragging
    // We use offset to store the X/Y translation from the top-right corner or absolute position
    const [offset, setOffset] = useState<{ x: number, y: number } | null>(null);

    const isDragging = useRef(false);
    const dragStart = useRef({ x: 0, y: 0 });
    const startOffset = useRef({ x: 0, y: 0 });

    const handleMouseDown = (e: React.MouseEvent) => {
        isDragging.current = true;
        dragStart.current = { x: e.clientX, y: e.clientY };

        // If we haven't dragged yet, our offset is effectively 0,0 relative to the CSS positioning (top: 50, right: 10)
        // BUT, switching to fixed positioning is tricky if we don't know the exact starting rect.
        // Let's grab the current rect.
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();

        // We will switch to direct 'left/top' positioning to make it easy.
        // If offset is null, we are in initial state.
        if (!offset) {
            startOffset.current = { x: rect.left, y: rect.top };
            setOffset({ x: rect.left, y: rect.top });
        } else {
            startOffset.current = { x: offset.x, y: offset.y };
        }
    };

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isDragging.current) return;

            const dx = e.clientX - dragStart.current.x;
            const dy = e.clientY - dragStart.current.y;

            setOffset({
                x: startOffset.current.x + dx,
                y: startOffset.current.y + dy
            });
        };

        const handleMouseUp = () => {
            isDragging.current = false;
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, []);


    if (!position || position.quantity === 0) return null;

    const currentCandle = candles[currentIndex];
    if (!currentCandle) return null;

    const unrealizedPnL = (currentCandle.close - position.averagePrice) * position.quantity;

    // Direction inference based on Quantity sign
    const direction = position.quantity > 0 ? "LONG" : "SHORT";
    const absQty = Math.abs(position.quantity);

    // Unrealized P&L logic:
    // Long (Qty > 0): (Current - Entry) * Qty
    // Short (Qty < 0): (Current - Entry) * NegQty = (Entry - Current) * PosQty.
    const isProfit = unrealizedPnL >= 0;

    // Style object: use 'offset' if available (after first drag or click), otherwise default CSS
    const style: React.CSSProperties = offset ? {
        left: `${offset.x}px`,
        top: `${offset.y}px`,
        position: 'fixed' as const
    } : {
        right: '80px',
        top: '60px',
        position: 'absolute' as const
    };

    return (
        <div
            className="bg-white/95 backdrop-blur-sm border border-gray-300 shadow-xl rounded-lg p-3 z-[150] min-w-[200px] cursor-move select-none"
            onMouseDown={handleMouseDown}
            style={style}
        >
            <div className="flex justify-between items-center mb-2 border-b pb-1">
                <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${direction === 'LONG' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {direction}
                </span>
                <span className="text-xs text-gray-500 font-mono">
                    {absQty} Qty
                </span>
            </div>

            <div className="flex flex-col gap-1">
                <div className="flex justify-between text-xs">
                    <span className="text-gray-600">Avg Price:</span>
                    <span className="font-medium">{formatCurrency(position.averagePrice)}</span>
                </div>
                <div className="flex justify-between text-sm mt-1">
                    <span className="font-semibold text-gray-700">P&L:</span>
                    <span className={`font-bold ${isProfit ? 'text-green-600' : 'text-red-600'}`}>
                        {formatCurrency(unrealizedPnL)}
                    </span>
                </div>
            </div>
        </div>
    );
}
