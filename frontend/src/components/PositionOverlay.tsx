import { useState, useRef, useEffect } from 'react';
import { useSessionStore } from '../stores/sessionStore';
import { formatCurrency } from '../utils/formatters';
import { AlertCircle, X, Pencil, Check, ChevronDown, ChevronUp } from 'lucide-react';


export function PositionOverlay({ onOpenDetail }: { onOpenDetail?: () => void }) {
    const position = useSessionStore((s) => s.position);
    const openPositions = useSessionStore((s) => s.openPositions);
    const candles = useSessionStore((s) => s.candles);
    const currentIndex = useSessionStore((s) => s.currentIndex);
    const initiateTrade = useSessionStore((s) => s.initiateTrade);
    const getUnrealizedPnL = useSessionStore((s) => s.getUnrealizedPnL);
    const updatePositionTarget = useSessionStore((s) => s.updatePositionTarget);
    const closeIndependentPosition = useSessionStore((s) => s.closeIndependentPosition);

    // State for dragging
    // We use offset to store the X/Y translation from the top-right corner or absolute position
    const [offset, setOffset] = useState<{ x: number, y: number } | null>(null);

    // Multi-trade mode: per-trade rows, collapsed by default
    const [expanded, setExpanded] = useState(true);

    // State for inline target editing
    const [editingTarget, setEditingTarget] = useState(false);
    const [targetInput, setTargetInput] = useState('');

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

    const handleExit = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!position) return;
        const type = position.quantity > 0 ? 'SELL' : 'BUY';
        initiateTrade(type, Math.abs(position.quantity));
    };

    const handleStartEditTarget = (e: React.MouseEvent) => {
        e.stopPropagation();
        setTargetInput(position?.target ? String(position.target) : '');
        setEditingTarget(true);
    };

    const handleConfirmTarget = (e: React.MouseEvent) => {
        e.stopPropagation();
        const val = Number(targetInput);
        if (!isNaN(val) && val > 0) {
            updatePositionTarget(val);
        }
        setEditingTarget(false);
    };

    const handleCancelEdit = (e: React.MouseEvent) => {
        e.stopPropagation();
        setEditingTarget(false);
    };

    const isMulti = openPositions.length > 0;
    // In multi-trade mode the net quantity can legitimately be 0 while several
    // trades are open (an equal-sized long and short), so gate on the trade list.
    if (!position || (!isMulti && position.quantity === 0)) return null;

    const currentCandle = candles[currentIndex];
    if (!currentCandle) return null;

    const unrealizedPnL = getUnrealizedPnL();

    const direction = position.quantity > 0 ? "LONG" : "SHORT";
    const absQty = Math.abs(position.quantity);

    const isAgainst = position.trendReversed;

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

    const hasSL = position.stopLoss && position.stopLoss > 0;
    const hasTP = position.target && position.target > 0;

    // ── Multi-trade mode ────────────────────────────────────────────────────────
    // Each trade is managed independently, so the panel lists them rather than
    // pretending there is a single position with one SL/TP to edit.
    if (isMulti) {
        const price = currentCandle.close;
        return (
            <div
                className="bg-white border-2 border-gray-400 shadow-2xl rounded-lg p-3 z-[150] min-w-[320px] cursor-move select-none"
                onMouseDown={handleMouseDown}
                style={style}
            >
                <div className="flex justify-between items-center mb-2 border-b-2 border-gray-200 pb-2">
                    <span className="text-xs font-bold px-2 py-1 rounded bg-indigo-600 text-white">
                        NET {position.quantity > 0 ? '+' : ''}{position.quantity}
                    </span>
                    <button
                        onClick={(e) => { e.stopPropagation(); setExpanded(v => !v); }}
                        onMouseDown={(e) => e.stopPropagation()}
                        className="text-xs text-gray-700 font-bold flex items-center gap-1 hover:text-indigo-700"
                        title={expanded ? 'Collapse trade list' : 'Expand trade list'}
                    >
                        {openPositions.length} trade{openPositions.length > 1 ? 's' : ''}
                        {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                    </button>
                </div>

                <div className="flex justify-between text-xs mb-1">
                    <span className="text-gray-600 font-medium">Avg Price:</span>
                    <span className="font-bold text-gray-900">{formatCurrency(position.averagePrice)}</span>
                </div>
                <div className="flex justify-between text-sm items-end mb-2">
                    <div>
                        <span className="font-semibold text-gray-600 block text-[10px] leading-tight mb-0.5">Unrealized P&L</span>
                        <span className={`font-bold text-base ${isProfit ? 'text-green-600' : 'text-red-600'}`}>
                            {formatCurrency(unrealizedPnL)}
                        </span>
                    </div>
                    {onOpenDetail && (
                        <button
                            onClick={(e) => { e.stopPropagation(); onOpenDetail(); }}
                            className="text-[10px] px-2 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 font-semibold"
                        >
                            Analysis
                        </button>
                    )}
                </div>

                {expanded && (
                    <div className="border-t border-gray-200 pt-2 flex flex-col gap-1">
                        {openPositions.map((p) => {
                            const long = p.quantity > 0;
                            const pnl = (price - p.averagePrice) * p.quantity;
                            return (
                                <div key={p.id} className="flex items-center gap-2 text-[11px] font-mono">
                                    <span className={`px-1 rounded font-bold ${long ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                        {long ? 'L' : 'S'}
                                    </span>
                                    <span className="w-10 text-right text-gray-700">{Math.abs(p.quantity)}</span>
                                    <span className="w-16 text-right text-gray-900">@{p.averagePrice.toFixed(2)}</span>
                                    <span className="w-16 text-right text-red-600" title="Stop Loss">
                                        {p.stopLoss ? p.stopLoss.toFixed(2) : '—'}
                                    </span>
                                    <span className="w-16 text-right text-green-600" title="Target">
                                        {p.target ? p.target.toFixed(2) : '—'}
                                    </span>
                                    <span className={`w-20 text-right font-bold ${pnl >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                        {formatCurrency(pnl)}
                                    </span>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); closeIndependentPosition(p.id, 'MANUAL'); }}
                                        onMouseDown={(e) => e.stopPropagation()}
                                        className="text-red-600 hover:text-red-800"
                                        title="Exit this trade only"
                                    >
                                        <X size={12} />
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        );
    }

    return (
        <div
            className="bg-white border-2 border-gray-400 shadow-2xl rounded-lg p-3 z-[150] min-w-[220px] cursor-move select-none"
            onMouseDown={handleMouseDown}
            style={style}
        >
            <div className="flex justify-between items-center mb-2 border-b-2 border-gray-200 pb-2">
                <span className={`text-xs font-bold px-2 py-1 rounded ${direction === 'LONG' ? 'bg-green-500 text-white' : 'bg-red-500 text-white'}`}>
                    {direction}
                </span>
                <span className="text-xs text-gray-700 font-bold font-mono flex items-center gap-1">
                    {position.pendingOrderId ? (
                        // Order placed but fill not yet confirmed
                        <span className="text-orange-500 animate-pulse font-semibold">Pending…</span>
                    ) : position.filledQty !== undefined && position.filledQty < absQty ? (
                        // Partially filled
                        <span className="text-yellow-600 font-semibold">{position.filledQty}/{absQty} Filled</span>
                    ) : (
                        <span>{absQty} Qty</span>
                    )}
                </span>
            </div>

            <div className="flex flex-col gap-1.5">
                <div className="flex justify-between text-xs">
                    <span className="text-gray-600 font-medium">Avg Price:</span>
                    <span className="font-bold text-gray-900">{formatCurrency(position.averagePrice)}</span>
                </div>

                {/* SL — read-only, strict */}
                {hasSL && (
                    <div className="flex justify-between text-xs items-center">
                        <span className="text-gray-600 font-medium">SL:</span>
                        <span className="font-bold text-red-600 font-mono">{position.stopLoss!.toFixed(2)}</span>
                    </div>
                )}

                {/* Target — editable */}
                {(hasTP || !hasSL) && (
                    <div className="flex justify-between text-xs items-center gap-1">
                        <span className="text-gray-600 font-medium">Target:</span>
                        {editingTarget ? (
                            <div className="flex items-center gap-1" onMouseDown={(e) => e.stopPropagation()}>
                                <input
                                    type="number"
                                    value={targetInput}
                                    onChange={(e) => setTargetInput(e.target.value)}
                                    className="w-20 px-1 py-0.5 text-xs border border-green-400 rounded focus:outline-none focus:ring-1 focus:ring-green-500 font-mono"
                                    autoFocus
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') handleConfirmTarget(e as any);
                                        if (e.key === 'Escape') handleCancelEdit(e as any);
                                    }}
                                />
                                <button onClick={handleConfirmTarget} className="text-green-600 hover:text-green-800" title="Confirm">
                                    <Check size={13} />
                                </button>
                                <button onClick={handleCancelEdit} className="text-gray-500 hover:text-gray-700" title="Cancel">
                                    <X size={13} />
                                </button>
                            </div>
                        ) : (
                            <div className="flex items-center gap-1">
                                <span className="font-bold text-green-600 font-mono">
                                    {hasTP ? position.target!.toFixed(2) : '—'}
                                </span>
                                <button
                                    onClick={handleStartEditTarget}
                                    className="text-gray-400 hover:text-green-600"
                                    title="Update target"
                                >
                                    <Pencil size={11} />
                                </button>
                            </div>
                        )}
                    </div>
                )}

                <div className="flex justify-between text-sm mt-1 items-end">
                    <div>
                        <span className="font-semibold text-gray-600 block text-[10px] leading-tight mb-0.5">Unrealized P&L</span>
                        <span className={`font-bold text-base ${isProfit ? 'text-green-600' : 'text-red-600'}`}>
                            {formatCurrency(unrealizedPnL)}
                        </span>
                    </div>

                    {isAgainst && (
                        <div className="flex items-center gap-1 bg-red-50 px-2 py-1 rounded border border-red-200 animate-pulse">
                            <AlertCircle size={14} className="text-red-600" />
                            <span className="text-[10px] font-bold text-red-700 uppercase">
                                Trend Reverse
                            </span>
                        </div>
                    )}

                    <div className="flex gap-1.5 items-end">
                        {onOpenDetail && (
                            <button
                                onClick={(e) => { e.stopPropagation(); onOpenDetail(); }}
                                className="text-[10px] px-2 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 font-semibold"
                            >
                                Analysis
                            </button>
                        )}
                        <button
                            onClick={handleExit}
                            className="text-[10px] px-2 py-1 bg-red-600 text-white rounded hover:bg-red-700 font-bold flex items-center gap-1 shadow-sm transition-colors"
                            title="Exit Entire Position"
                        >
                            <X size={12} />
                            Exit
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
