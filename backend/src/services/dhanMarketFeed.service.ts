import { DhanFeed, Ticker } from 'dhanhq';
import logger from '../utils/logger';
import { Server } from 'socket.io';
import axios from 'axios';


let feedInstance: any = null;
let io: Server | null = null;
const subscribedTokens: Set<string> = new Set();
// Queue for subscriptions that arrive before the Dhan WS is open
const pendingSubscriptions: Array<{ token: string; segment: string }> = [];
let feedConnected = false;

/** Internal tick callback — used by positionMonitor to receive prices without Socket.io */
let internalTickCallback: ((token: string, price: number) => void) | null = null;

/**
 * Register a callback that fires on every price tick (both WS and REST polling).
 * Used by positionMonitor.service to check SL/TP without needing a socket connection.
 */
export function setInternalTickCallback(cb: (token: string, price: number) => void): void {
    internalTickCallback = cb;
}

// Map string segments to Dhan numeric codes
const SEGMENT_MAP: Record<string, number> = {
    'INDEX': 0,     // Nifty/Bank Nifty Spot (IDX)
    'IDX_I': 0,     // Nifty/Bank Nifty Spot (Dhan format)
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
    if (pendingSubscriptions.length === 0) return;
    logger.info(`Flushing ${pendingSubscriptions.length} pending Dhan subscriptions`);
    for (const { token, segment } of pendingSubscriptions) {
        subscribeToInstrument(token, segment);
    }
    pendingSubscriptions.length = 0;
}

// Control for REST polling to avoid overlapping requests
let isPollingInProgress = false;
// Holds the pending setTimeout handle for the next REST poll iteration.
// null = polling is stopped; truthy = polling loop is active (waiting or running).
let restPollHandle: ReturnType<typeof setTimeout> | null = null;

/**
 * Poll the Dhan intraday chart API for the latest price.
 * Used as fallback when the WebSocket feed fails (e.g. expired token).
 */
async function performRestPoll(clientID: string, accessToken: string) {
    if (isPollingInProgress) return;
    
    isPollingInProgress = true;
    try {
        if (subscribedTokens.size === 0) return; // Silent return, will reschedule in finally
        
        const today = new Date().toISOString().split('T')[0];

        // Loop through tokens sequentially to avoid swamping the event loop
        for (const token of Array.from(subscribedTokens)) {
            try {
                const response = await axios.post(
                    'https://api.dhan.co/v2/charts/intraday',
                    {
                        securityId: token,
                        exchangeSegment: 'IDX_I',
                        instrument: 'INDEX',
                        interval: '1',
                        fromDate: today,
                        toDate: today,
                    },
                    {
                        headers: {
                            'access-token': accessToken,
                            'client-id': clientID,
                            'Content-Type': 'application/json',
                        },
                        timeout: 5000, // Reasonable timeout
                    }
                );

                const d = response.data;
                const times: number[] = d.start_time || d.start_Time || d.timestamp || [];
                const closes: number[] = d.close || [];

                if (times.length > 0 && closes.length > 0) {
                    const lastTs = times[times.length - 1];
                    const lastClose = Number(closes[closes.length - 1]);
                    logger.debug(`[REST Poll] token:${token} price:${lastClose} ts:${lastTs}`);
                    io?.to(`instrument:${token}`).emit('tick', {
                        token,
                        price: lastClose,
                        timestamp: Number(lastTs),
                        volume: 0,
                    });
                    // Notify position monitor (runs even when no frontend is connected)
                    internalTickCallback?.(token, lastClose);
                }
            } catch (err: any) {
                logger.warn(`[REST Poll] Failed for token ${token}: ${err.message}`);
            }
        }
    } finally {
        isPollingInProgress = false;
        // Schedule next poll ONLY after this one is finished; stop if handle was cleared by stopRestPolling()
        if (restPollHandle !== null) {
            restPollHandle = setTimeout(() => performRestPoll(clientID, accessToken), 2000);
        }
    }
}

function startRestPolling(clientID: string, accessToken: string) {
    if (restPollHandle !== null) return; // already running

    logger.info('🔄 Starting REST polling fallback (Safe loop, 2s delay)');
    restPollHandle = setTimeout(() => performRestPoll(clientID, accessToken), 100);
}

function stopRestPolling() {
    if (restPollHandle !== null) {
        clearTimeout(restPollHandle);
        restPollHandle = null;
        isPollingInProgress = false;
        logger.info('REST polling stopped (WS connected)');
    }
}
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Initialize Dhan Market Feed
 */
export function initDhanMarketFeed(serverIo: Server) {
    io = serverIo;
    const clientID = process.env.DHAN_CLIENT_ID;
    const accessToken = process.env.DHAN_ACCESS_TOKEN;

    if (!clientID || !accessToken) {
        logger.warn('Dhan client ID or Access Token not set. Live market feed disabled.');
        return;
    }

    logger.info('Initializing Dhan Market Feed with:', {
        clientID: clientID.substring(0, 4) + '****',
        hasToken: !!accessToken,
        tokenLength: accessToken.length
    });

    try {
        feedInstance = new DhanFeed(
            clientID,
            accessToken,
            [],
            Ticker,
            // onConnect
            (instance: any) => {
                feedConnected = true;
                stopRestPolling(); // WS connected — stop REST polling if running
                logger.info('Dhan Market Feed: WebSocket connected and authorized ✓');
                flushPendingSubscriptions();
            },
            // onMessage
            (instance: any, message: any) => {
                if (!message) return;
                const token = message.securityId !== undefined ? String(message.securityId) : null;
                const ltp = message.ltp ?? message.LTP ?? message.last_price ?? message.price;
                if (token && ltp !== undefined && ltp !== null) {
                    const numericPrice = Number(ltp);
                    logger.info(`[WS Tick] token:${token} ltp:${numericPrice}`);
                    io?.to(`instrument:${token}`).emit('tick', {
                        token,
                        price: numericPrice,
                        timestamp: Math.floor(Date.now() / 1000),
                        volume: message.volume ?? message.Vol ?? 0
                    });
                    // Notify position monitor (runs even when no frontend is connected)
                    internalTickCallback?.(token, numericPrice);
                } else {
                    logger.info('Dhan Feed message (non-ticker):', JSON.stringify(message));
                }
            },
            // onClose
            (code: number, reason: string) => {
                feedConnected = false;
                logger.warn(`Dhan Market Feed: WebSocket closed. Code: ${code}`);
                if (code === 1006) {
                    logger.error('⚠️  Dhan WS closed with code 1006 (HTTP 400) — ACCESS TOKEN LIKELY EXPIRED. Falling back to REST polling.');
                    startRestPolling(clientID, accessToken);
                }
            }
        );

        // Catch WS errors (e.g. HTTP 400 on connect)
        if (feedInstance && feedInstance.ws === undefined) {
            // ws not created yet — hook after connect is called
        }

        logger.info('Dhan Market Feed: Connecting WebSocket...');
        feedInstance.connect();

        // After a short delay, check if WS connected; if not, start REST polling
        setTimeout(() => {
            if (!feedConnected) {
                logger.warn('Dhan WS did not connect within 5s — starting REST polling fallback');
                startRestPolling(clientID, accessToken);
            }
        }, 5000);

    } catch (error: any) {
        logger.error('Dhan Market Feed: Failed to initialize:', error.message);
        startRestPolling(clientID, accessToken);
    }
}

/**
 * Subscribe to an instrument
 */
export function subscribeToInstrument(token: string, segment: string = 'NSE_EQ') {
    if (!feedInstance) {
        logger.error('Dhan Market Feed not initialized. Cannot subscribe.');
        return;
    }

    // Always track in subscribedTokens — used by REST polling fallback
    subscribedTokens.add(token);

    if (!feedConnected) {
        // Queue for WS subscription when it connects
        const alreadyPending = pendingSubscriptions.some(p => p.token === token);
        if (!alreadyPending) {
            logger.info(`Dhan WS not connected — queued for WS: ${token} (REST polling fallback enabled)`);
            pendingSubscriptions.push({ token, segment });
        }
        
        // Ensure REST polling is running if WS is down
        const clientID = process.env.DHAN_CLIENT_ID;
        const accessToken = process.env.DHAN_ACCESS_TOKEN;
        if (clientID && accessToken) {
            startRestPolling(clientID, accessToken);
        }
        return;
    }

    const numericSegment = (SEGMENT_MAP[segment] !== undefined) ? SEGMENT_MAP[segment] : 1;
    logger.info(`Subscribing to Dhan WS: ${token} (Segment: ${numericSegment})`);
    try {
        feedInstance.subscribeSymbols(Ticker, [[numericSegment, token]]);
        logger.info(`Successfully sent WS subscribe for token: ${token}`);
    } catch (error: any) {
        logger.error(`Error subscribing to instrument ${token}:`, error.message);
    }
}

/**
 * Unsubscribe from an instrument
 */
export function unsubscribeFromInstrument(token: string, segment: string = 'NSE_EQ') {
    if (!feedInstance) return;

    const numericSegment = SEGMENT_MAP[segment] ?? 1;

    if (subscribedTokens.has(token)) {
        logger.info(`Unsubscribing from Dhan: ${token}`);
        try {
            feedInstance.unsubscribe(Ticker, [[numericSegment, token]]);
            subscribedTokens.delete(token);
        } catch (error: any) {
            logger.error(`Error unsubscribing from instrument ${token}:`, error.message);
        }
    }
}

/**
 * Handle socket joining a room for an instrument
 */
export function handleSocketSubscription(socket: any) {
    socket.on('subscribe:instrument', (data: { token: string, segment?: string }) => {
        const token = String(data.token);
        const segment = data.segment || 'NSE_EQ';
        socket.join(`instrument:${token}`);
        subscribeToInstrument(token, segment);
        logger.info(`Socket ${socket.id} joined room instrument:${token} (Segment: ${segment})`);
    });

    socket.on('unsubscribe:instrument', (data: { token: string, segment?: string }) => {
        socket.leave(`instrument:${data.token}`);
        logger.info(`Socket ${socket.id} left room instrument:${data.token}`);
    });
}

/**
 * Get current feed status for debugging
 */
export function getFeedStatus() {
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
export function emitTestTick(token: string, price: number) {
    if (!io) {
        logger.warn('emitTestTick: io not initialized');
        return;
    }
    const tick = {
        token,
        price,
        timestamp: Math.floor(Date.now() / 1000),
        volume: 100,
    };
    logger.info(`emitTestTick -> room instrument:${token}`, tick);
    io.to(`instrument:${token}`).emit('tick', tick);
}
