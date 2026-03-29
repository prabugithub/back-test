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

    connect: () => {
        if (get().socket) return;

        const socket = io(SOCKET_URL);

        socket.on('connect', () => {
            set({ isConnected: true });
            console.log('Connected to Backend Live Socket');
            
            // Re-subscribe if we had an active token
            const session = useSessionStore.getState();
            if (session.sessionConfig && get().isLiveMode) {
                get().subscribe(session.sessionConfig.securityId, session.sessionConfig.exchangeSegment);
            }
        });

        socket.on('disconnect', () => {
            set({ isConnected: false });
            console.log('Disconnected from Backend Live Socket');
        });

        socket.on('tick', (tick: LiveTick) => {
            set({ 
                livePrice: tick.price,
                lastTick: tick 
            });

            // If in live mode, update session store with current price
            // This triggers SL/TP checks and PnL updates
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
            set({ socket: null, isConnected: false });
        }
    },

    setLiveMode: (isLive) => {
        set({ isLiveMode: isLive });
        if (isLive) {
            get().connect();
            const session = useSessionStore.getState();
            if (session.sessionConfig) {
               get().subscribe(session.sessionConfig.securityId, session.sessionConfig.exchangeSegment);
            }
            useNotificationStore.getState().notify('Live Trading Mode Activated', 'success');
        } else {
            const session = useSessionStore.getState();
            if (session.sessionConfig) {
               get().unsubscribe(session.sessionConfig.securityId);
            }
            useNotificationStore.getState().notify('Backtesting Mode Activated', 'warning');
        }
    },

    subscribe: (token, segment = 'NSE_EQ') => {
        const { socket, isConnected } = get();
        if (socket && isConnected) {
            socket.emit('subscribe:instrument', { token, segment });
            console.log(`Socket request subscribe: ${token}`);
        }
    },

    unsubscribe: (token) => {
        const { socket, isConnected } = get();
        if (socket && isConnected) {
            socket.emit('unsubscribe:instrument', { token });
            console.log(`Socket request unsubscribe: ${token}`);
        }
    }
}));
