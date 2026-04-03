import { executeSmartExit } from './smartExit.service';
import { placeOrder } from '../adapters/dhan.adapter';
import { subscribeToInstrument } from '../adapters/dhanFeed.adapter';
import logger from '../utils/logger';
import { Server } from 'socket.io';

export interface MonitoredPosition {
    /** Unique ID — we use liveOptionToken (the option security ID) as the key */
    id: string;
    /** Spot index token to watch (e.g. '13' for NIFTY, '25' for BANKNIFTY) */
    spotToken: string;
    /** Segment for the spot token — always 'IDX_I' for index */
    spotSegment: string;
    /** Direction of the trade from the spot perspective */
    direction: 'LONG' | 'SHORT';
    /** Spot price level that triggers a stop-loss exit */
    stopLoss: number;
    /** Spot price level that triggers a target exit */
    target: number;
    /** Option security ID to send the exit order for */
    optionSecurityId: string;
    /** Exchange segment for the option (always 'NSE_FNO') */
    optionExchangeSegment: string;
    /** Number of units to exit */
    quantity: number;
    /** Option entry price (premium) — recorded for reference only */
    entryPrice: number;
    /** Set to true the moment an exit is triggered to prevent duplicate orders */
    exitTriggered: boolean;
    /** Unix timestamp (ms) when the position was registered */
    registeredAt: number;
}

/** In-memory map of all actively monitored positions. Keyed by id (liveOptionToken). */
const monitoredPositions = new Map<string, MonitoredPosition>();
let ioInstance: Server | null = null;

/**
 * Must be called once at server startup (after initDhanMarketFeed).
 * Wires up the position monitor to receive price ticks.
 */
export function initPositionMonitor(io: Server): void {
    ioInstance = io;
    logger.info('[PositionMonitor] Initialized and ready.');
}

/**
 * Register a new position for backend SL/TP monitoring.
 * Called by the frontend immediately after a live option order is placed.
 */
export function registerPosition(params: Omit<MonitoredPosition, 'exitTriggered' | 'registeredAt'>): void {
    const entry: MonitoredPosition = {
        ...params,
        exitTriggered: false,
        registeredAt: Date.now(),
    };
    monitoredPositions.set(params.id, entry);

    // Make sure the backend is subscribed to the spot index token so ticks keep flowing
    subscribeToInstrument(params.spotToken, params.spotSegment);

    logger.info(
        `[PositionMonitor] Registered | id:${params.id} | ${params.direction} | ` +
        `SL:${params.stopLoss} | TP:${params.target} | qty:${params.quantity} | token:${params.spotToken}`
    );
}

/**
 * Remove a position from monitoring.
 * Called by the frontend when the user manually closes the position.
 */
export function unregisterPosition(id: string): boolean {
    const existed = monitoredPositions.delete(id);
    if (existed) {
        logger.info(`[PositionMonitor] Unregistered position: ${id}`);
    }
    return existed;
}

/**
 * Return a sanitized snapshot of all monitored positions (no internal flags leaked).
 */
export function getMonitoredPositions(): Array<Omit<MonitoredPosition, 'exitTriggered'>> {
    return Array.from(monitoredPositions.values()).map(({ exitTriggered, ...rest }) => rest);
}

/**
 * Called on every price tick by dhanMarketFeed.
 * Checks every registered position against the new price and fires exits as needed.
 *
 * This is the core of the backend monitor — it runs independently of the frontend.
 */
export async function onTick(token: string, price: number): Promise<void> {
    if (monitoredPositions.size === 0) return;

    for (const pos of monitoredPositions.values()) {
        // Only process positions watching this specific token
        if (pos.spotToken !== token) continue;
        // Guard: skip if exit is already in-flight
        if (pos.exitTriggered) continue;

        const { stopLoss, target, direction } = pos;
        const isLong = direction === 'LONG';

        let slHit = false;
        let tpHit = false;

        if (isLong) {
            if (stopLoss > 0 && price <= stopLoss) slHit = true;
            else if (target > 0 && price >= target) tpHit = true;
        } else {
            if (stopLoss > 0 && price >= stopLoss) slHit = true;
            else if (target > 0 && price <= target) tpHit = true;
        }

        if (!slHit && !tpHit) continue;

        // Mark triggered SYNCHRONOUSLY before any await to prevent re-entry on next tick
        pos.exitTriggered = true;
        const reason = slHit ? 'SL' : 'TP';

        logger.info(
            `[PositionMonitor] ${reason} HIT | id:${pos.id} | price:${price} | ` +
            `SL:${pos.stopLoss} | TP:${pos.target}`
        );

        // Notify all connected frontend clients immediately
        ioInstance?.emit('position:exit-triggered', {
            positionId: pos.id,
            reason,
            triggerPrice: price,
            stopLoss: pos.stopLoss,
            target: pos.target,
        });

        // Fire the exit order asynchronously so we don't block tick processing
        triggerExit(pos, reason, price).catch((err: any) => {
            logger.error(`[PositionMonitor] triggerExit failed for ${pos.id}: ${err.message}`);
            ioInstance?.emit('position:exit-failed', {
                positionId: pos.id,
                reason,
                error: err.message,
            });
        });
    }
}

/**
 * Executes the actual broker exit order for a position.
 * For SL: uses the 3-step SmartExit chaser.
 * For TP: places a direct MARKET order for immediate fill.
 */
async function triggerExit(pos: MonitoredPosition, reason: 'SL' | 'TP', triggerPrice: number): Promise<void> {
    try {
        if (reason === 'SL') {
            await executeSmartExit({
                securityId: pos.optionSecurityId,
                exchangeSegment: pos.optionExchangeSegment,
                transactionType: 'SELL',
                quantity: pos.quantity,
                slPrice: triggerPrice,
            });
            logger.info(`[PositionMonitor] SL Smart Exit initiated for ${pos.id}`);
        } else {
            // Target hit — exit at market immediately
            await placeOrder({
                securityId: pos.optionSecurityId,
                exchangeSegment: pos.optionExchangeSegment,
                transactionType: 'SELL',
                quantity: pos.quantity,
                orderType: 'MARKET',
                productType: 'INTRADAY',
            });
            logger.info(`[PositionMonitor] TP MARKET exit placed for ${pos.id}`);
        }

        // Clean up after successful exit
        monitoredPositions.delete(pos.id);

        // Notify clients that exit order was successfully placed
        ioInstance?.emit('position:exit-placed', {
            positionId: pos.id,
            reason,
            triggerPrice,
        });
    } catch (err: any) {
        logger.error(`[PositionMonitor] Exit order failed for ${pos.id}: ${err.message}`);
        // Re-throw so the caller can emit position:exit-failed
        throw err;
    }
}
