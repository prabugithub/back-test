"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setInternalTickCallback = setInternalTickCallback;
exports.initDhanMarketFeed = initDhanMarketFeed;
exports.subscribeToInstrument = subscribeToInstrument;
exports.unsubscribeFromInstrument = unsubscribeFromInstrument;
exports.handleSocketSubscription = handleSocketSubscription;
exports.getFeedStatus = getFeedStatus;
exports.emitTestTick = emitTestTick;
const dhanhq_1 = require("dhanhq");
const logger_1 = __importDefault(require("../utils/logger"));
const axios_1 = __importDefault(require("axios"));
let feedInstance = null;
let io = null;
const subscribedTokens = new Set();
// Queue for subscriptions that arrive before the Dhan WS is open
const pendingSubscriptions = [];
let feedConnected = false;
/** Internal tick callback — used by positionMonitor to receive prices without Socket.io */
let internalTickCallback = null;
/**
 * Register a callback that fires on every price tick (both WS and REST polling).
 * Used by positionMonitor.service to check SL/TP without needing a socket connection.
 */
function setInternalTickCallback(cb) {
    internalTickCallback = cb;
}
// Map string segments to Dhan numeric codes
const SEGMENT_MAP = {
    'INDEX': 0, // Nifty/Bank Nifty Spot (IDX)
    'IDX_I': 0, // Nifty/Bank Nifty Spot (Dhan format)
    'NSE_INDEX': 0,
    'NSE_EQ': 1,
    'NSE_FNO': 2,
    'NSE_CURR': 3,
    'BSE_EQ': 4,
    'MCX': 5,
    'BSE_CURR': 7,
    'BSE_FNO': 8
};
/**
 * Flush any pending subscriptions once the Dhan WS is connected
 */
function flushPendingSubscriptions() {
    if (pendingSubscriptions.length === 0)
        return;
    logger_1.default.info(`Flushing ${pendingSubscriptions.length} pending Dhan subscriptions`);
    for (const { token, segment } of pendingSubscriptions) {
        subscribeToInstrument(token, segment);
    }
    pendingSubscriptions.length = 0;
}
// Control for REST polling to avoid overlapping requests
let isPollingInProgress = false;
// Holds the pending setTimeout handle for the next REST poll iteration.
// null = polling is stopped; truthy = polling loop is active (waiting or running).
let restPollHandle = null;
/**
 * Poll the Dhan intraday chart API for the latest price.
 * Used as fallback when the WebSocket feed fails (e.g. expired token).
 */
async function performRestPoll(clientID) {
    if (isPollingInProgress)
        return;
    isPollingInProgress = true;
    try {
        if (subscribedTokens.size === 0)
            return; // Silent return, will reschedule in finally
        // Always read fresh token — loginDhan() may have refreshed it since polling started
        const accessToken = process.env.DHAN_ACCESS_TOKEN;
        if (!accessToken) {
            logger_1.default.warn('[REST Poll] No access token available, skipping poll');
            return;
        }
        const today = new Date().toISOString().split('T')[0];
        // Loop through tokens sequentially to avoid swamping the event loop
        for (const token of Array.from(subscribedTokens)) {
            try {
                const response = await axios_1.default.post('https://api.dhan.co/v2/charts/intraday', {
                    securityId: token,
                    exchangeSegment: 'IDX_I',
                    instrument: 'INDEX',
                    interval: '1',
                    fromDate: today,
                    toDate: today,
                }, {
                    headers: {
                        'access-token': accessToken,
                        'client-id': clientID,
                        'Content-Type': 'application/json',
                    },
                    timeout: 5000, // Reasonable timeout
                });
                const d = response.data;
                const times = d.start_time || d.start_Time || d.timestamp || [];
                const closes = d.close || [];
                if (times.length > 0 && closes.length > 0) {
                    const lastTs = times[times.length - 1];
                    const lastClose = Number(closes[closes.length - 1]);
                    logger_1.default.debug(`[REST Poll] token:${token} price:${lastClose} ts:${lastTs}`);
                    io?.to(`instrument:${token}`).emit('tick', {
                        token,
                        price: lastClose,
                        timestamp: Number(lastTs),
                        volume: 0,
                    });
                    // Notify position monitor (runs even when no frontend is connected)
                    internalTickCallback?.(token, lastClose);
                }
            }
            catch (err) {
                logger_1.default.warn(`[REST Poll] Failed for token ${token}: ${err.message}`);
            }
        }
    }
    finally {
        isPollingInProgress = false;
        // Schedule next poll ONLY after this one is finished; stop if handle was cleared by stopRestPolling()
        if (restPollHandle !== null) {
            restPollHandle = setTimeout(() => performRestPoll(clientID), 2000);
        }
    }
}
function startRestPolling(clientID) {
    if (restPollHandle !== null)
        return; // already running
    logger_1.default.info('🔄 Starting REST polling fallback (Safe loop, 2s delay)');
    restPollHandle = setTimeout(() => performRestPoll(clientID), 100);
}
function stopRestPolling() {
    if (restPollHandle !== null) {
        clearTimeout(restPollHandle);
        restPollHandle = null;
        isPollingInProgress = false;
        logger_1.default.info('REST polling stopped (WS connected)');
    }
}
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Initialize Dhan Market Feed
 */
function initDhanMarketFeed(serverIo) {
    io = serverIo;
    const clientID = process.env.DHAN_CLIENT_ID;
    if (!clientID || !process.env.DHAN_ACCESS_TOKEN) {
        logger_1.default.warn('Dhan client ID or Access Token not set. Live market feed disabled.');
        return;
    }
    connectDhanWS(clientID);
}
/**
 * Internal: (re)connect the Dhan WebSocket with the current access token.
 * Called on initial startup and after a token refresh.
 */
function connectDhanWS(clientID) {
    // Always read token fresh — loginDhan() may have updated it
    const accessToken = process.env.DHAN_ACCESS_TOKEN;
    logger_1.default.info('Initializing Dhan Market Feed with:', {
        clientID: clientID.substring(0, 4) + '****',
        hasToken: !!accessToken,
        tokenLength: accessToken.length
    });
    try {
        feedInstance = new dhanhq_1.DhanFeed(clientID, accessToken, [], dhanhq_1.Ticker, 
        // onConnect
        (instance) => {
            feedConnected = true;
            stopRestPolling(); // WS connected — stop REST polling if running
            logger_1.default.info('Dhan Market Feed: WebSocket connected and authorized ✓');
            flushPendingSubscriptions();
        }, 
        // onMessage
        (instance, message) => {
            if (!message)
                return;
            const token = message.securityId !== undefined ? String(message.securityId) : null;
            const ltp = message.ltp ?? message.LTP ?? message.last_price ?? message.price;
            if (token && ltp !== undefined && ltp !== null) {
                const numericPrice = Number(ltp);
                logger_1.default.info(`[WS Tick] token:${token} ltp:${numericPrice}`);
                io?.to(`instrument:${token}`).emit('tick', {
                    token,
                    price: numericPrice,
                    timestamp: Math.floor(Date.now() / 1000),
                    volume: message.volume ?? message.Vol ?? 0
                });
                // Notify position monitor (runs even when no frontend is connected)
                internalTickCallback?.(token, numericPrice);
            }
            else {
                logger_1.default.info('Dhan Feed message (non-ticker):', JSON.stringify(message));
            }
        }, 
        // onClose
        (code, reason) => {
            feedConnected = false;
            logger_1.default.warn(`Dhan Market Feed: WebSocket closed. Code: ${code}`);
            if (code === 1006) {
                logger_1.default.error('⚠️  Dhan WS closed with code 1006 — token likely expired. Refreshing token and reconnecting...');
                // Start REST polling immediately so ticks keep flowing while we refresh
                startRestPolling(clientID);
                // Refresh the token, then reconnect the WS
                Promise.resolve().then(() => __importStar(require('../services/dhan.service'))).then(({ loginDhan }) => {
                    loginDhan()
                        .then(() => {
                        logger_1.default.info('Token refreshed after WS 1006 — reconnecting WebSocket');
                        connectDhanWS(clientID);
                    })
                        .catch((err) => {
                        logger_1.default.error('Token refresh failed after WS 1006 — staying on REST polling:', err.message);
                    });
                });
            }
        });
        logger_1.default.info('Dhan Market Feed: Connecting WebSocket...');
        feedInstance.connect();
        // After a short delay, check if WS connected; if not, start REST polling
        setTimeout(() => {
            if (!feedConnected) {
                logger_1.default.warn('Dhan WS did not connect within 5s — starting REST polling fallback');
                startRestPolling(clientID);
            }
        }, 5000);
    }
    catch (error) {
        logger_1.default.error('Dhan Market Feed: Failed to initialize:', error.message);
        startRestPolling(clientID);
    }
}
/**
 * Subscribe to an instrument
 */
function subscribeToInstrument(token, segment = 'NSE_EQ') {
    if (!feedInstance) {
        logger_1.default.error('Dhan Market Feed not initialized. Cannot subscribe.');
        return;
    }
    // Always track in subscribedTokens — used by REST polling fallback
    subscribedTokens.add(token);
    if (!feedConnected) {
        // Queue for WS subscription when it connects
        const alreadyPending = pendingSubscriptions.some(p => p.token === token);
        if (!alreadyPending) {
            logger_1.default.info(`Dhan WS not connected — queued for WS: ${token} (REST polling fallback enabled)`);
            pendingSubscriptions.push({ token, segment });
        }
        // Ensure REST polling is running if WS is down
        const clientID = process.env.DHAN_CLIENT_ID;
        if (clientID) {
            startRestPolling(clientID);
        }
        return;
    }
    const numericSegment = (SEGMENT_MAP[segment] !== undefined) ? SEGMENT_MAP[segment] : 1;
    logger_1.default.info(`Subscribing to Dhan WS: ${token} (Segment: ${numericSegment})`);
    try {
        feedInstance.subscribeSymbols(dhanhq_1.Ticker, [[numericSegment, token]]);
        logger_1.default.info(`Successfully sent WS subscribe for token: ${token}`);
    }
    catch (error) {
        logger_1.default.error(`Error subscribing to instrument ${token}:`, error.message);
    }
}
/**
 * Unsubscribe from an instrument
 */
function unsubscribeFromInstrument(token, segment = 'NSE_EQ') {
    if (!feedInstance)
        return;
    const numericSegment = SEGMENT_MAP[segment] ?? 1;
    if (subscribedTokens.has(token)) {
        logger_1.default.info(`Unsubscribing from Dhan: ${token}`);
        try {
            feedInstance.unsubscribe(dhanhq_1.Ticker, [[numericSegment, token]]);
            subscribedTokens.delete(token);
        }
        catch (error) {
            logger_1.default.error(`Error unsubscribing from instrument ${token}:`, error.message);
        }
    }
}
/**
 * Handle socket joining a room for an instrument
 */
function handleSocketSubscription(socket) {
    socket.on('subscribe:instrument', (data) => {
        const token = String(data.token);
        const segment = data.segment || 'NSE_EQ';
        socket.join(`instrument:${token}`);
        subscribeToInstrument(token, segment);
        logger_1.default.info(`Socket ${socket.id} joined room instrument:${token} (Segment: ${segment})`);
    });
    socket.on('unsubscribe:instrument', (data) => {
        socket.leave(`instrument:${data.token}`);
        logger_1.default.info(`Socket ${socket.id} left room instrument:${data.token}`);
    });
}
/**
 * Get current feed status for debugging
 */
function getFeedStatus() {
    return {
        feedConnected,
        feedInitialized: !!feedInstance,
        subscribedTokens: Array.from(subscribedTokens),
        pendingSubscriptions: [...pendingSubscriptions],
    };
}
/**
 * Emit a fake tick to a token room (for pipeline testing only)
 */
function emitTestTick(token, price) {
    if (!io) {
        logger_1.default.warn('emitTestTick: io not initialized');
        return;
    }
    const tick = {
        token,
        price,
        timestamp: Math.floor(Date.now() / 1000),
        volume: 100,
    };
    logger_1.default.info(`emitTestTick -> room instrument:${token}`, tick);
    io.to(`instrument:${token}`).emit('tick', tick);
}
