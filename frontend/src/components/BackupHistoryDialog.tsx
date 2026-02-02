import React, { useEffect, useState } from 'react';
import { X, Clock, RotateCcw, AlertCircle } from 'lucide-react';
import { useSessionStore } from '../stores/sessionStore';
import type { SessionState } from '../services/firebaseSessionService';

interface BackupHistoryDialogProps {
    isOpen: boolean;
    onClose: () => void;
}

export const BackupHistoryDialog: React.FC<BackupHistoryDialogProps> = ({ isOpen, onClose }) => {
    const [backups, setBackups] = useState<SessionState[]>([]);
    const [loading, setLoading] = useState(false);
    const getRemoteHistory = useSessionStore(s => s.getRemoteHistory);
    const restoreRemoteBackup = useSessionStore(s => s.restoreRemoteBackup);

    useEffect(() => {
        if (isOpen) {
            loadHistory();
        }
    }, [isOpen]);

    const loadHistory = async () => {
        setLoading(true);
        try {
            const history = await getRemoteHistory();
            setBackups(history);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const handleRestore = async (id: string, name: string) => {
        if (window.confirm(`Are you sure you want to restore "${name}"? Current unsaved progress will be lost.`)) {
            await restoreRemoteBackup(id);
            onClose();
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[95vh] flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">
                {/* Header */}
                <div className="px-6 py-4 bg-amber-50 border-b border-amber-100 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-amber-800">
                        <RotateCcw size={20} />
                        <h2 className="text-lg font-bold">Restore Backup</h2>
                    </div>
                    <button onClick={onClose} className="text-amber-400 hover:text-amber-600 transition-colors">
                        <X size={24} />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 overflow-y-auto">
                    <div className="mb-4 flex items-start gap-3 p-3 bg-blue-50 text-blue-800 rounded-lg text-sm">
                        <AlertCircle size={18} className="shrink-0 mt-0.5" />
                        <p>
                            We've saved the last 4 versions of your journal. Choose a point to go back to if a recent save was accidental.
                        </p>
                    </div>

                    <div className="space-y-3">
                        {loading ? (
                            <div className="py-8 text-center text-gray-500">
                                <div className="animate-spin w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-2"></div>
                                Loading history...
                            </div>
                        ) : backups.length === 0 ? (
                            <div className="py-8 text-center text-gray-500 border-2 border-dashed rounded-lg">
                                No backup history found.
                            </div>
                        ) : (
                            backups.map((backup, index) => (
                                <button
                                    key={backup.id || index}
                                    onClick={() => handleRestore(backup.id!, backup.name)}
                                    className="w-full text-left p-4 border border-gray-200 rounded-xl hover:border-amber-500 hover:bg-amber-50 transition-all group relative"
                                >
                                    <div className="flex justify-between items-start mb-1">
                                        <span className="font-bold text-gray-900">Backup {index + 1}</span>
                                        <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded">
                                            {index === 0 ? 'Most Recent' : `${index + 1} Saves Ago`}
                                        </span>
                                    </div>

                                    <div className="flex items-center gap-2 text-sm text-gray-600 mb-2">
                                        <Clock size={14} />
                                        <span>{backup.archivedAt ? new Date(backup.archivedAt).toLocaleString() : 'Unknown Time'}</span>
                                    </div>

                                    <div className="flex gap-4 text-xs font-medium">
                                        <div className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
                                            {backup.trades.length} Trades
                                        </div>
                                        <div className="bg-purple-100 text-purple-700 px-2 py-0.5 rounded">
                                            {backup.instrument}
                                        </div>
                                    </div>

                                    <div className="absolute right-4 bottom-4 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <RotateCcw size={18} className="text-amber-600" />
                                    </div>
                                </button>
                            ))
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="px-6 py-4 bg-gray-50 border-t flex justify-end">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-semibold text-gray-600 hover:text-gray-800"
                    >
                        Cancel
                    </button>
                </div>
            </div>
        </div>
    );
};
