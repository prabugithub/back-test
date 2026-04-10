"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initDhanMarketFeed = initDhanMarketFeed;
exports.setInternalTickCallback = setInternalTickCallback;
exports.emitSimulationTick = emitSimulationTick;
exports.simulateDisconnect = simulateDisconnect;
exports.simulateReconnect = simulateReconnect;
exports.subscribeToInstrument = subscribeToInstrument;
exports.unsubscribeFromInstrument = unsubscribeFromInstrument;
exports.handleSocketSubscription = handleSocketSubscription;
exports.getFeedStatus = getFeedStatus;
exports.emitTestTick = emitTestTick;
exports.setInitialPrice = setInitialPrice;
exports.getCurrentPrices = getCurrentPrices;
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
const logger_1 = __importDefault(require("../utils/logger"));
const mockDhan_service_1 = require("./mockDhan.service");
let io = null;
let internalTickCallback = null;
const subscribedTokens = new Set();
const currentPrices = new Map();
let feedConnected = true;
let heartbeatInterval = null;
let restPollInterval = null;
// ─── Core init ────────────────────────────────────────────────────────────────
function initDhanMarketFeed(serverIo) {
    io = serverIo;
    startHeartbeat();
    logger_1.default.info('[MockFeed] Simulation market feed initialized — WebSocket replaced by tick engine');
}
// ─── Internal callback (wires to positionMonitor) ────────────────────────────
function setInternalTickCallback(cb) {
    internalTickCallback = cb;
}
// ─── Primary tick injection ───────────────────────────────────────────────────
/**
 * Called by scenarioRunner to push a price to a token.
 * Emits via Socket.io AND calls the positionMonitor callback.
 */
function emitSimulationTick(token, price) {
    currentPrices.set(token, price);
    (0, mockDhan_service_1.setSimPrice)(token, price); // keep mockDhan in sync for order fills
    const tick = {
        token,
        price,
        timestamp: Math.floor(Date.now() / 1000),
        volume: Math.floor(Math.random() * 5000) + 100,
    };
    io?.to(`instrument:${token}`).emit('tick', tick);
    internalTickCallback?.(token, price);
    logger_1.default.debug(`[MockFeed] tick → token:${token} price:${price}`);
}
// ─── Heartbeat (keeps price stream alive between scenario ticks) ──────────────
function startHeartbeat() {
    if (heartbeatInterval)
        return;
    heartbeatInterval = setInterval(() => {
        for (const token of subscribedTokens) {
            const price = currentPrices.get(token);
            if (price !== undefined) {
                emitSimulationTick(token, price);
            }
        }
    }, 500);
}
function stopHeartbeat() {
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
function simulateDisconnect() {
    feedConnected = false;
    stopHeartbeat();
    io?.emit('feedStatus', { connected: false, reason: 'Simulated disconnect (code 1006)' });
    logger_1.default.warn('[MockFeed] Simulated WebSocket disconnect — switching to REST poll mode');
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
function simulateReconnect() {
    if (restPollInterval) {
        clearInterval(restPollInterval);
        restPollInterval = null;
    }
    feedConnected = true;
    io?.emit('feedStatus', { connected: true });
    logger_1.default.info('[MockFeed] Simulated WebSocket reconnect — re-emitting all subscriptions');
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
function subscribeToInstrument(token, _segment = 'NSE_EQ') {
    subscribedTokens.add(token);
    logger_1.default.info(`[MockFeed] Subscribed to token: ${token}`);
    // Immediately emit current price so subscriber gets a tick right away
    const price = currentPrices.get(token);
    if (price !== undefined) {
        emitSimulationTick(token, price);
    }
}
function unsubscribeFromInstrument(token, _segment = 'NSE_EQ') {
    subscribedTokens.delete(token);
    logger_1.default.info(`[MockFeed] Unsubscribed from token: ${token}`);
}
function handleSocketSubscription(socket) {
    socket.on('subscribe:instrument', (data) => {
        const token = String(data.token);
        socket.join(`instrument:${token}`);
        subscribeToInstrument(token, data.segment || 'NSE_EQ');
        logger_1.default.info(`[MockFeed] Socket ${socket.id} subscribed to instrument:${token}`);
    });
    socket.on('unsubscribe:instrument', (data) => {
        socket.leave(`instrument:${data.token}`);
    });
}
// ─── Status & dev helpers (same API as real service) ─────────────────────────
function getFeedStatus() {
    return {
        feedConnected,
        feedInitialized: true,
        subscribedTokens: Array.from(subscribedTokens),
        pendingSubscriptions: [],
        simulationMode: true,
    };
}
/** Same name as real service — used by /api/live/test-tick route */
function emitTestTick(token, price) {
    emitSimulationTick(token, price);
}
/** Expose current prices for scenarioRunner (to seed initial state) */
function setInitialPrice(token, price) {
    currentPrices.set(token, price);
    (0, mockDhan_service_1.setSimPrice)(token, price);
}
function getCurrentPrices() {
    return new Map(currentPrices);
}
