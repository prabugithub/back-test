import { create } from 'zustand';
import { io, Socket } from 'socket.io-client';
import { useSessionStore } from './sessionStore';
import { useNotificationStore } from './notificationStore';
import { getMonitoredPositions } from '../services/api';

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

const SOCKET_URL = 'http://168.144.78.61';

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
            return;
        }


        const socket = io(SOCKET_URL, {
            transports: ['websocket'],
            reconnection: true,
            reconnectionDelay: 2000,
            reconnectionAttempts: 10,
        });

        socket.on('connect', () => {
            set({ isConnected: true });

            // Flush any pending subscription
            const { pendingSubscription, isLiveMode } = get();
            if (isLiveMode && pendingSubscription) {
                socket.emit('subscribe:instrument', pendingSubscription);
                set({ pendingSubscription: null });
            } else if (isLiveMode) {
                // Re-subscribe on reconnect
                const session = useSessionStore.getState();
                if (session.sessionConfig) {
                    const { securityId, exchangeSegment } = session.sessionConfig;
                    socket.emit('subscribe:instrument', { token: securityId, segment: exchangeSegment });
                }
            }

            // On reconnect, check if the backend already triggered an exit while we were offline
            if (isLiveMode) {
                getMonitoredPositions().then((resp) => {
                    const session = useSessionStore.getState();
                    if (!session.position) return;

                    const currentToken = session.position.liveOptionToken;
                    if (!currentToken) return;

                    const stillMonitored = resp?.data?.some((p: any) => p.id === currentToken);
                    if (!stillMonitored) {
                        // Backend already exited this position while we were offline
                        useNotificationStore.getState().notify(
                            'Backend exited your position (SL/TP hit while offline). Syncing state.',
                            'warning'
                        );
                        // Clear local position — syncLivePositions will reconcile with broker next tick
                        session.syncLivePositions();
                    }
                }).catch((e) => console.warn('[LiveStore] Monitor sync on reconnect failed:', e));
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
            set({
                livePrice: tick.price,
                lastTick: { ...tick }, // New object reference to trigger zustand subscribers
            });

            if (get().isLiveMode) {
                useSessionStore.getState().updateLivePrice(tick.price);
            }
        });

        // Backend fired an exit order (SL or TP hit while frontend may have been offline)
        socket.on('position:exit-triggered', (data: { positionId: string; reason: 'SL' | 'TP'; triggerPrice: number; stopLoss: number; target: number }) => {
            const level = data.reason === 'SL' ? data.stopLoss : data.target;
            useNotificationStore.getState().notify(
                `${data.reason} Hit at ${level.toFixed(2)} — Backend is exiting position automatically.`,
                data.reason === 'SL' ? 'warning' : 'success'
            );
            // Mark position so checkSLTPHits skips placing a duplicate exit order
            useSessionStore.setState((s) => ({
                position: s.position?.liveOptionToken === data.positionId
                    ? { ...s.position, exitTriggeredByBackend: true }
                    : s.position,
            }));
        });

        // Backend confirmed the exit order was placed with the broker
        socket.on('position:exit-placed', (data: { positionId: string; reason: 'SL' | 'TP'; triggerPrice: number }) => {
            useNotificationStore.getState().notify(
                `${data.reason} exit order placed by backend at ${data.triggerPrice.toFixed(2)}. Syncing position.`,
                'info'
            );
            // Sync local state with broker to reflect the closed position
            useSessionStore.getState().syncLivePositions();
        });

        // Backend exit order failed — alert user to act manually
        socket.on('position:exit-failed', (data: { positionId: string; reason: 'SL' | 'TP'; error: string }) => {
            console.error('[LiveStore] Backend exit failed:', data);
            useNotificationStore.getState().notify(
                `CRITICAL: Backend ${data.reason} exit FAILED (${data.error}). Please close position manually!`,
                'error'
            );
            // Reset the dialog-shown flag so checkSLTPHits can re-fire on the next tick.
            // Without this, the frontend permanently suppresses SL/TP notifications after one failure.
            useSessionStore.setState((s) => {
                if (s.position?.liveOptionToken !== data.positionId) return {};
                return {
                    position: {
                        ...s.position,
                        slDialogShown: data.reason === 'SL' ? false : s.position.slDialogShown,
                        tpDialogShown: data.reason === 'TP' ? false : s.position.tpDialogShown,
                    },
                };
            });
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
        } else {
            set({ pendingSubscription: { token, segment } });
        }
    },

    unsubscribe: (token) => {
        const { socket, isConnected } = get();
        if (socket && isConnected) {
            socket.emit('unsubscribe:instrument', { token });
        }
    }
}));
