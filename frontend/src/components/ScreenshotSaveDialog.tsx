import { useState, useEffect, useRef } from 'react';
import { X, Camera, Save } from 'lucide-react';

interface ScreenshotSaveDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmit: (name: string) => void;
    defaultName: string;
    isUploading: boolean;
}

export function ScreenshotSaveDialog({ isOpen, onClose, onSubmit, defaultName, isUploading }: ScreenshotSaveDialogProps) {
    const [name, setName] = useState(defaultName);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (isOpen) {
            setName(defaultName);
            setTimeout(() => {
                inputRef.current?.focus();
                inputRef.current?.select();
            }, 100);
        }
    }, [isOpen, defaultName]);

    if (!isOpen) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (name.trim()) {
            onSubmit(name.trim());
        }
    };

    return (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 self-center">
                <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                    <div className="flex items-center gap-2 text-gray-700">
                        <Camera size={20} className="text-blue-500" />
                        <h3 className="font-bold text-lg">Save Screenshot</h3>
                    </div>
                    <button onClick={onClose} className="p-1 hover:bg-gray-200 rounded-full transition-colors text-gray-400">
                        <X size={20} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    <div>
                        <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-1.5">
                            File Name
                        </label>
                        <div className="relative group">
                            <input
                                ref={inputRef}
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="e.g. 25-01-2024_Trade-1"
                                className="w-full px-4 py-3 bg-gray-50 border-2 border-gray-200 rounded-xl outline-none focus:border-blue-500 transition-all font-medium text-gray-700"
                            />
                            <div className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs">.png</div>
                        </div>
                    </div>

                    <div className="flex gap-3 pt-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 px-4 py-3 border-2 border-gray-200 text-gray-600 font-bold rounded-xl hover:bg-gray-50 transition-all active:scale-95"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={isUploading || !name.trim()}
                            className={`flex-[2] px-4 py-3 bg-blue-600 text-white font-bold rounded-xl shadow-lg shadow-blue-200 flex items-center justify-center gap-2 hover:bg-blue-700 transition-all active:scale-95 disabled:opacity-50 disabled:pointer-events-none`}
                        >
                            {isUploading ? (
                                <>
                                    <div className="w-5 h-5 border-3 border-white/30 border-t-white rounded-full animate-spin" />
                                    <span>Uploading...</span>
                                </>
                            ) : (
                                <>
                                    <Save size={18} />
                                    <span>Upload & Copy Link</span>
                                </>
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
