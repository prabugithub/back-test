import React, { useEffect, useState } from 'react';
import { X, Clock, RotateCcw, AlertCircle, Trash2 } from 'lucide-react';
import { useSessionStore } from '../stores/sessionStore';
import type { SessionState } from '../services/firebaseSessionService';

interface BackupHistoryDialogProps {
    isOpen: boolean;
    onClose: () => void;
}

export const BackupHistoryDialog: React.FC<BackupHistoryDialogProps> = ({ isOpen, onClose }) => {
    const [backups, setBackups] = useState<SessionState[]>([]);
    const [snapshots, setSnapshots] = useState<SessionState[]>([]);
    const [activeTab, setActiveTab] = useState<'backups' | 'snapshots'>('backups');
    const [loading, setLoading] = useState(false);

    const getRemoteHistory = useSessionStore(s => s.getRemoteHistory);
    const getRemoteSnapshots = useSessionStore(s => s.getRemoteSnapshots);
    const restoreRemoteBackup = useSessionStore(s => s.restoreRemoteBackup);
    const deleteRemoteSnapshot = useSessionStore(s => s.deleteRemoteSnapshot);

    useEffect(() => {
        if (isOpen) {
            loadData();
        }
    }, [isOpen]);

    const loadData = async () => {
        setLoading(true);
        try {
            const [hist, snaps] = await Promise.all([
                getRemoteHistory(),
                getRemoteSnapshots()
            ]);
            setBackups(hist);
            setSnapshots(snaps);
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

    const handleDelete = async (e: React.MouseEvent, id: string, name: string) => {
        e.stopPropagation();
        if (window.confirm(`Delete snapshot "${name}" permanently?`)) {
            await deleteRemoteSnapshot(id);
            loadData(); // Reload list
        }
    };

    if (!isOpen) return null;

    const currentList = activeTab === 'backups' ? backups : snapshots;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[95vh] flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">
                {/* Header */}
                <div className="px-6 py-4 bg-amber-50 border-b border-amber-100 flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-2 text-amber-800">
                        <RotateCcw size={20} />
                        <h2 className="text-lg font-bold">Restore Session</h2>
                    </div>
                    <button onClick={onClose} className="text-amber-400 hover:text-amber-600 transition-colors">
                        <X size={24} />
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-gray-200 shrink-0">
                    <button
                        onClick={() => setActiveTab('backups')}
                        className={`flex-1 py-3 text-sm font-medium transition-colors ${activeTab === 'backups'
                                ? 'bg-white text-blue-600 border-b-2 border-blue-600'
                                : 'bg-gray-50 text-gray-500 hover:bg-gray-100'
                            }`}
                    >
                        Auto History
                    </button>
                    <button
                        onClick={() => setActiveTab('snapshots')}
                        className={`flex-1 py-3 text-sm font-medium transition-colors ${activeTab === 'snapshots'
                                ? 'bg-white text-purple-600 border-b-2 border-purple-600'
                                : 'bg-gray-50 text-gray-500 hover:bg-gray-100'
                            }`}
                    >
                        Saved Snapshots
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 overflow-y-auto">
                    <div className="mb-4 flex items-start gap-3 p-3 rounded-lg text-sm bg-blue-50 text-blue-800">
                        <AlertCircle size={18} className="shrink-0 mt-0.5" />
                        <p>
                            {activeTab === 'backups'
                                ? "We automatically save your last 4 sessions. Use these to undo recent mistakes."
                                : "Permanent checkpoints you created manually. Deleting them is irreversible."}
                        </p>
                    </div>

                    <div className="space-y-3">
                        {loading ? (
                            <div className="py-8 text-center text-gray-500">
                                <div className="animate-spin w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-2"></div>
                                Loading...
                            </div>
                        ) : currentList.length === 0 ? (
                            <div className="py-8 text-center text-gray-500 border-2 border-dashed rounded-lg">
                                No {activeTab} found.
                            </div>
                        ) : (
                            currentList.map((item, index) => (
                                <button
                                    key={item.id || index}
                                    onClick={() => handleRestore(item.id!, item.name)}
                                    className={`w-full text-left p-4 border rounded-xl transition-all group relative ${activeTab === 'backups'
                                            ? 'border-gray-200 hover:border-amber-500 hover:bg-amber-50'
                                            : 'border-purple-200 hover:border-purple-500 hover:bg-purple-50'
                                        }`}
                                >
                                    <div className="flex justify-between items-start mb-1">
                                        <div className="flex-1 pr-8">
                                            <span className="font-bold text-gray-900 block truncate">{item.name || `Backup ${index + 1}`}</span>
                                        </div>
                                        {activeTab === 'backups' && (
                                            <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded shrink-0">
                                                {index === 0 ? 'Latest' : `${index + 1} Saves Ago`}
                                            </span>
                                        )}
                                        {activeTab === 'snapshots' && (
                                            <div
                                                onClick={(e) => handleDelete(e, item.id!, item.name)}
                                                className="absolute top-4 right-4 p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors z-10"
                                                title="Delete Snapshot"
                                            >
                                                <Trash2 size={16} />
                                            </div>
                                        )}
                                    </div>

                                    <div className="flex items-center gap-2 text-sm text-gray-600 mb-2">
                                        <Clock size={14} />
                                        <span>{item.archivedAt ? new Date(item.archivedAt).toLocaleString() : 'Unknown Time'}</span>
                                    </div>

                                    <div className="flex gap-4 text-xs font-medium">
                                        <div className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
                                            {item.trades.length} Trades
                                        </div>
                                        <div className="bg-purple-100 text-purple-700 px-2 py-0.5 rounded">
                                            {item.instrument}
                                        </div>
                                    </div>

                                    <div className="absolute right-4 bottom-4 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <RotateCcw size={18} className={activeTab === 'backups' ? "text-amber-600" : "text-purple-600"} />
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
