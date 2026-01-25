import { useNotificationStore } from '../stores/notificationStore';
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react';

export function NotificationToast() {
    const { notifications, remove } = useNotificationStore();

    if (notifications.length === 0) return null;

    return (
        <div className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-3 max-w-md w-full pointer-events-none">
            {notifications.map((n) => (
                <div
                    key={n.id}
                    className={`pointer-events-auto p-4 rounded-xl shadow-2xl flex items-start gap-3 animate-in slide-in-from-right-full duration-300 border-l-4 ${n.type === 'success' ? 'bg-green-50 border-green-500 text-green-800' :
                            n.type === 'error' ? 'bg-red-50 border-red-500 text-red-800' :
                                n.type === 'warning' ? 'bg-amber-50 border-amber-500 text-amber-800' :
                                    'bg-blue-50 border-blue-500 text-blue-800'
                        }`}
                >
                    <div className="mt-0.5">
                        {n.type === 'success' && <CheckCircle size={18} />}
                        {n.type === 'error' && <AlertCircle size={18} />}
                        {n.type === 'warning' && <AlertTriangle size={18} />}
                        {n.type === 'info' && <Info size={18} />}
                    </div>

                    <div className="flex-1 text-sm font-medium">
                        {n.message}
                    </div>

                    <button
                        onClick={() => remove(n.id)}
                        className="text-gray-400 hover:text-gray-600 transition-colors"
                    >
                        <X size={16} />
                    </button>
                </div>
            ))}
        </div>
    );
}
