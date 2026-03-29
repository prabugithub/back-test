import { DhanFeed, Ticker, NSE, NSE_FNO, BSE, MCX } from 'dhanhq';
import logger from '../utils/logger';
import { Server } from 'socket.io';

let feedInstance: any = null;
let io: Server | null = null;
const subscribedTokens: Set<string> = new Set();

// Map string segments to Dhan numeric codes
const SEGMENT_MAP: Record<string, number> = {
    'INDEX': 0,     // Nifty/Bank Nifty Spot (IDX)
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

    try {
        // DhanFeed(clientId, accessToken, instruments, subscriptionCode, onConnect, onMessage, onClose)
        // We start with no instruments and Ticker mode
        feedInstance = new DhanFeed(
            clientID,
            accessToken,
            [], // Initial instruments
            Ticker, // Ticker mode (LTP)
            // onConnect
            (instance: any) => {
                logger.info('Dhan Market Feed connected and authorized');
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
                            volume: 0 // Ticker packet might not have volume
                        });
                    }
                }
            },
            // onClose
            (code: number, reason: string) => {
                logger.info(`Dhan Market Feed closed: ${reason} (${code})`);
            }
        );

        feedInstance.connect();
    } catch (error: any) {
        logger.error('Failed to initialize Dhan Market Feed:', error.message);
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

    const numericSegment = SEGMENT_MAP[segment] || 1;

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
        subscribeToInstrument(data.token, data.segment || 'NSE_EQ');
        logger.info(`Socket ${socket.id} joined room instrument:${data.token}`);
    });

    socket.on('unsubscribe:instrument', (data: { token: string, segment?: string }) => {
        socket.leave(`instrument:${data.token}`);
        logger.info(`Socket ${socket.id} left room instrument:${data.token}`);
    });
}
