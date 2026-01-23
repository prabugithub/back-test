import { useState, useEffect, useRef } from 'react';

interface TextInputDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (text: string) => void;
    position: { x: number; y: number } | null;
}

export function TextInputDialog({ isOpen, onClose, onSubmit, position }: TextInputDialogProps) {
    const [text, setText] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (isOpen) {
            setText('');
            setTimeout(() => inputRef.current?.focus(), 10);
        }
    }, [isOpen]);

    if (!isOpen || !position) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (text.trim()) {
            onSubmit(text);
            onClose();
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Escape') {
            onClose();
            return;
        }
        // Ensure spacebar stays within the input
        if (e.key === ' ') {
            e.stopPropagation();
        }
    };

    return (
        <div
            className="absolute z-[200] animate-in fade-in zoom-in duration-100"
            style={{
                left: position.x,
                top: position.y,
                transform: 'translate(0, -50%)'
            }}
        >
            <form onSubmit={handleSubmit}>
                <input
                    ref={inputRef}
                    type="text"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onBlur={() => {
                        // If user clicks away without text, just close
                        if (!text.trim()) onClose();
                    }}
                    placeholder="Type note & hit Enter..."
                    className="w-64 px-3 py-1.5 bg-white/90 backdrop-blur-sm border-2 border-blue-500 rounded-md shadow-xl outline-none text-sm font-semibold text-gray-800 placeholder:text-gray-400"
                />
            </form>
        </div>
    );
}
