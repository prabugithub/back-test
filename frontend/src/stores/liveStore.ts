import { create } from 'zustand';
import { io, Socket } from 'socket.io-client';
import { useSessionStore } from './sessionStore';
import { useNotificationStore } from './notificationStore';

interface LiveTick {
    token: string;
    price: number;
    timestamp: number;
    volume: number;
}

interface LiveState {
    socket: Socket | null;
    isConnected: boolean;
    isLiveMode: boolean;
    livePrice: number | null;
    lastTick: LiveTick | null;
    pendingSubscription: { token: string; segment: string } | null;

    // Actions
    connect: () => void;
    disconnect: () => void;
    setLiveMode: (isLive: boolean) => void;
    subscribe: (token: string, segment?: string) => void;
    unsubscribe: (token: string) => void;
}

const SOCKET_URL = 'http://localhost:3001';

export const useLiveStore = create<LiveState>((set, get) => ({
    socket: null,
    isConnected: false,
    isLiveMode: false,
    livePrice: null,
    lastTick: null,
    pendingSubscription: null,

    connect: () => {
        // If already connected and socket exists, skip
        const existing = get().socket;
        if (existing && existing.connected) return;

        // Reuse existing socket if it just isn't connected yet (avoid double-connect)
        if (existing) {
            console.log('[LiveStore] Socket exists but not yet connected — will subscribe on connect event');
            return;
        }

        console.log('[LiveStore] Creating new Socket.IO connection...');
        const socket = io(SOCKET_URL, {
            transports: ['websocket'],
            reconnection: true,
            reconnectionDelay: 2000,
            reconnectionAttempts: 10,
        });

        socket.on('connect', () => {
            console.log('[LiveStore] Socket connected:', socket.id);
            set({ isConnected: true });

            // Flush any pending subscription
            const { pendingSubscription, isLiveMode } = get();
            if (isLiveMode && pendingSubscription) {
                console.log('[LiveStore] Flushing pending subscription:', pendingSubscription);
                socket.emit('subscribe:instrument', pendingSubscription);
                set({ pendingSubscription: null });
            } else if (isLiveMode) {
                // Re-subscribe on reconnect
                const session = useSessionStore.getState();
                if (session.sessionConfig) {
                    const { securityId, exchangeSegment } = session.sessionConfig;
                    console.log('[LiveStore] Re-subscribing on reconnect:', securityId);
                    socket.emit('subscribe:instrument', { token: securityId, segment: exchangeSegment });
                }
            }
        });

        socket.on('disconnect', (reason) => {
            console.warn('[LiveStore] Socket disconnected:', reason);
            set({ isConnected: false });
        });

        socket.on('connect_error', (err) => {
            console.error('[LiveStore] Socket connection error:', err.message);
        });

        socket.on('tick', (tick: LiveTick) => {
            console.log('[LiveStore] Tick received:', tick);
            set({
                livePrice: tick.price,
                lastTick: { ...tick }, // New object reference to trigger zustand subscribers
            });

            if (get().isLiveMode) {
                useSessionStore.getState().updateLivePrice(tick.price);
            }
        });

        set({ socket });
    },

    disconnect: () => {
        const { socket } = get();
        if (socket) {
            socket.disconnect();
            set({ socket: null, isConnected: false, pendingSubscription: null });
        }
    },

    setLiveMode: (isLive) => {
        set({ isLiveMode: isLive });

        if (isLive) {
            const session = useSessionStore.getState();
            const config = session.sessionConfig;

            if (config) {
                const { securityId, exchangeSegment } = config;
                // Queue the subscription — connect() will flush it once socket is ready
                set({ pendingSubscription: { token: securityId, segment: exchangeSegment } });
            }

            // Connect (or reuse socket). The 'connect' event handler will flush pendingSubscription.
            get().connect();

            // If already connected, flush immediately
            const { socket, isConnected } = get();
            if (socket && isConnected && get().pendingSubscription) {
                const pending = get().pendingSubscription!;
                console.log('[LiveStore] Already connected — subscribing immediately:', pending);
                socket.emit('subscribe:instrument', pending);
                set({ pendingSubscription: null });
            }

            useNotificationStore.getState().notify('Live Trading Mode Activated', 'success');
        } else {
            const session = useSessionStore.getState();
            if (session.sessionConfig) {
                const { socket, isConnected } = get();
                if (socket && isConnected) {
                    socket.emit('unsubscribe:instrument', { token: session.sessionConfig.securityId });
                }
            }
            set({ pendingSubscription: null });
            useNotificationStore.getState().notify('Backtesting Mode Activated', 'warning');
        }
    },

    subscribe: (token, segment = 'NSE_EQ') => {
        const { socket, isConnected } = get();
        if (socket && isConnected) {
            socket.emit('subscribe:instrument', { token, segment });
            console.log('[LiveStore] Subscribed to:', token);
        } else {
            // Queue it
            console.log('[LiveStore] Not connected yet — queueing subscription for:', token);
            set({ pendingSubscription: { token, segment } });
        }
    },

    unsubscribe: (token) => {
        const { socket, isConnected } = get();
        if (socket && isConnected) {
            socket.emit('unsubscribe:instrument', { token });
            console.log('[LiveStore] Unsubscribed from:', token);
        }
    }
}));
