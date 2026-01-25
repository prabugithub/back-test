import { create } from 'zustand';

export type NotificationType = 'success' | 'error' | 'info' | 'warning';

interface Notification {
    id: string;
    message: string;
    type: NotificationType;
}

interface NotificationStore {
    notifications: Notification[];
    notify: (message: string, type?: NotificationType) => void;
    remove: (id: string) => void;
}

export const useNotificationStore = create<NotificationStore>((set) => ({
    notifications: [],
    notify: (message, type = 'info') => {
        const id = Math.random().toString(36).substring(2, 9);
        set((state) => ({
            notifications: [...state.notifications, { id, message, type }]
        }));

        // Auto remove after 5 seconds
        setTimeout(() => {
            set((state) => ({
                notifications: state.notifications.filter((n) => n.id !== id)
            }));
        }, 5000);
    },
    remove: (id) => {
        set((state) => ({
            notifications: state.notifications.filter((n) => n.id !== id)
        }));
    }
}));
