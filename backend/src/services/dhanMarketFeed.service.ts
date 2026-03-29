import { DhanFeed, Ticker, NSE, NSE_FNO, BSE, MCX } from 'dhanhq';
import logger from '../utils/logger';
import { Server } from 'socket.io';

let feedInstance: any = null;
let io: Server | null = null;
const subscribedTokens: Set<string> = new Set();

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
        // DhanFeed(clientId, accessToken, instruments, subscriptionCode, onConnect, onMessage, onClose)
        feedInstance = new DhanFeed(
            clientID,
            accessToken,
            [], // Initial instruments
            Ticker, // Ticker mode (LTP)
            // onConnect
            (instance: any) => {
                logger.info('Dhan Market Feed: Successfully connected and authorized');
            },
            // onMessage
            (instance: any, message: any) => {
                if (message) {
                    const token = message.securityId || message.security_id;
                    if (token) {
                        io?.to(`instrument:${token}`).emit('tick', {
                            token: String(token),
                            price: message.ltp,
                            timestamp: Math.floor(Date.now() / 1000),
                            volume: 0
                        });
                    }
                }
            },
            // onClose
            (code: number, reason: string) => {
                logger.warn(`Dhan Market Feed: Connection closed. Code: ${code}, Reason: ${reason}`);
            }
        );

        // Try to handle error if exposed
        if (feedInstance && feedInstance.on) {
             feedInstance.on('error', (err: any) => {
                 logger.error('Dhan Market Feed Error:', err);
             });
        }

        logger.info('Dhan Market Feed: Calling .connect()');
        feedInstance.connect();
    } catch (error: any) {
        logger.error('Dhan Market Feed: Failed to initialize:', error.message);
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

    const numericSegment = (SEGMENT_MAP[segment] !== undefined) ? SEGMENT_MAP[segment] : 1;

    if (!subscribedTokens.has(token)) {
        logger.info(`Subscribing to Dhan: ${token} (Segment: ${numericSegment})`);
        try {
            // DhanFeed.subscribeSymbols(subscriptionCode, instruments)
            // instruments is Array of [segment, token]
            feedInstance.subscribeSymbols(Ticker, [[numericSegment, token]]);
            subscribedTokens.add(token);
        } catch (error: any) {
            logger.error(`Error subscribing to instrument ${token}:`, error.message);
        }
    }
}

/**
 * Unsubscribe from an instrument
 */
export function unsubscribeFromInstrument(token: string, segment: string = 'NSE_EQ') {
    if (!feedInstance) return;

    const numericSegment = SEGMENT_MAP[segment] || 1;

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
        socket.join(`instrument:${data.token}`);
        const segment = data.segment === 'IDX_I' ? 'IDX_I' : (data.segment || 'NSE_EQ');
        subscribeToInstrument(data.token, segment);
        logger.info(`Socket ${socket.id} joined room instrument:${data.token} (Segment: ${segment})`);
    });

    socket.on('unsubscribe:instrument', (data: { token: string, segment?: string }) => {
        socket.leave(`instrument:${data.token}`);
        logger.info(`Socket ${socket.id} left room instrument:${data.token}`);
    });
}
