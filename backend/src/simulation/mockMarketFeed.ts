/**
 * Mock Market Feed — Simulation Mode
 *
 * Implements the same exported interface as dhanMarketFeed.service.ts but
 * drives price ticks from in-memory scripted sequences instead of Dhan WebSocket.
 *
 * Exposes extra simulation-only helpers:
 *   emitSimulationTick()  — inject a price tick (called by scenarioRunner)
 *   simulateDisconnect()  — simulate WS going down (REST poll mode kicks in)
 *   simulateReconnect()   — restore WS mode
 */
import logger from '../utils/logger';
import { Server } from 'socket.io';
import { setSimPrice } from './mockDhan.service';

let io: Server | null = null;
let internalTickCallback: ((token: string, price: number) => void) | null = null;

const subscribedTokens = new Set<string>();
const currentPrices = new Map<string, number>();

let feedConnected = true;
let heartbeatInterval: NodeJS.Timeout | null = null;
let restPollInterval: NodeJS.Timeout | null = null;

// ─── Core init ────────────────────────────────────────────────────────────────

export function initDhanMarketFeed(serverIo: Server): void {
    io = serverIo;
    startHeartbeat();
    logger.info('[MockFeed] Simulation market feed initialized — WebSocket replaced by tick engine');
}

// ─── Internal callback (wires to positionMonitor) ────────────────────────────

export function setInternalTickCallback(cb: (token: string, price: number) => void): void {
    internalTickCallback = cb;
}

// ─── Primary tick injection ───────────────────────────────────────────────────

/**
 * Called by scenarioRunner to push a price to a token.
 * Emits via Socket.io AND calls the positionMonitor callback.
 */
export function emitSimulationTick(token: string, price: number): void {
    currentPrices.set(token, price);
    setSimPrice(token, price); // keep mockDhan in sync for order fills

    const tick = {
        token,
        price,
        timestamp: Math.floor(Date.now() / 1000),
        volume: Math.floor(Math.random() * 5000) + 100,
    };

    io?.to(`instrument:${token}`).emit('tick', tick);
    internalTickCallback?.(token, price);
    logger.debug(`[MockFeed] tick → token:${token} price:${price}`);
}

// ─── Heartbeat (keeps price stream alive between scenario ticks) ──────────────

function startHeartbeat(): void {
    if (heartbeatInterval) return;
    heartbeatInterval = setInterval(() => {
        for (const token of subscribedTokens) {
            const price = currentPrices.get(token);
            if (price !== undefined) {
                emitSimulationTick(token, price);
            }
        }
    }, 500);
}

function stopHeartbeat(): void {
    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
    }
}

// ─── WS disconnect / reconnect simulation ────────────────────────────────────

/**
 * Simulates a WebSocket disconnect (e.g. access token expired, code 1006).
 * Switches to 2-second REST poll mode — same as the real service.
 */
export function simulateDisconnect(): void {
    feedConnected = false;
    stopHeartbeat();
    io?.emit('feedStatus', { connected: false, reason: 'Simulated disconnect (code 1006)' });
    logger.warn('[MockFeed] Simulated WebSocket disconnect — switching to REST poll mode');

    // Simulate REST polling: re-emit current prices every 2s
    if (!restPollInterval) {
        restPollInterval = setInterval(() => {
            for (const token of subscribedTokens) {
                const price = currentPrices.get(token);
                if (price !== undefined) {
                    emitSimulationTick(token, price);
                }
            }
        }, 2000);
    }
}

/**
 * Simulates WebSocket reconnection.
 * Flushes all subscribed tokens and resumes heartbeat.
 */
export function simulateReconnect(): void {
    if (restPollInterval) {
        clearInterval(restPollInterval);
        restPollInterval = null;
    }
    feedConnected = true;
    io?.emit('feedStatus', { connected: true });
    logger.info('[MockFeed] Simulated WebSocket reconnect — re-emitting all subscriptions');

    // Re-emit current prices so frontend re-syncs
    for (const token of subscribedTokens) {
        const price = currentPrices.get(token);
        if (price !== undefined) {
            emitSimulationTick(token, price);
        }
    }
    startHeartbeat();
}

// ─── Subscription management (same API as real service) ──────────────────────

export function subscribeToInstrument(token: string, _segment: string = 'NSE_EQ'): void {
    subscribedTokens.add(token);
    logger.info(`[MockFeed] Subscribed to token: ${token}`);

    // Immediately emit current price so subscriber gets a tick right away
    const price = currentPrices.get(token);
    if (price !== undefined) {
        emitSimulationTick(token, price);
    }
}

export function unsubscribeFromInstrument(token: string, _segment: string = 'NSE_EQ'): void {
    subscribedTokens.delete(token);
    logger.info(`[MockFeed] Unsubscribed from token: ${token}`);
}

export function handleSocketSubscription(socket: any): void {
    socket.on('subscribe:instrument', (data: { token: string; segment?: string }) => {
        const token = String(data.token);
        socket.join(`instrument:${token}`);
        subscribeToInstrument(token, data.segment || 'NSE_EQ');
        logger.info(`[MockFeed] Socket ${socket.id} subscribed to instrument:${token}`);
    });

    socket.on('unsubscribe:instrument', (data: { token: string }) => {
        socket.leave(`instrument:${data.token}`);
    });
}

// ─── Status & dev helpers (same API as real service) ─────────────────────────

export function getFeedStatus() {
    return {
        feedConnected,
        feedInitialized: true,
        subscribedTokens: Array.from(subscribedTokens),
        pendingSubscriptions: [],
        simulationMode: true,
    };
}

/** Same name as real service — used by /api/live/test-tick route */
export function emitTestTick(token: string, price: number): void {
    emitSimulationTick(token, price);
}

/** Expose current prices for scenarioRunner (to seed initial state) */
export function setInitialPrice(token: string, price: number): void {
    currentPrices.set(token, price);
    setSimPrice(token, price);
}

export function getCurrentPrices(): Map<string, number> {
    return new Map(currentPrices);
}
