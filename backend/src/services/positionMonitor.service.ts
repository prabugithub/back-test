import { placeOrder, getOrderStatus, getPositions } from '../adapters/dhan.adapter';
import { subscribeToInstrument } from '../adapters/dhanFeed.adapter';
import { getDatabase } from '../config/database';
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
    /** Product type used at entry — exit order must match (e.g. 'INTRADAY', 'MARGIN') */
    productType: 'INTRADAY' | 'CNC' | 'MARGIN' | 'MTF' | 'CO' | 'BO';
    /** When true the entry order has not yet been confirmed filled — onTick will not fire exits */
    pendingFill: boolean;
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
 * Wires up the position monitor to receive price ticks, and reloads
 * any positions that were persisted before the last server restart.
 */
export function initPositionMonitor(io: Server): void {
    ioInstance = io;

    // Reload persisted positions from SQLite so SL/TP monitoring survives restarts.
    // Discard positions registered before today's 9:15 AM IST (3:45 AM UTC) — they belong
    // to a previous trading session. A rolling 24h TTL is NOT used because a position from
    // yesterday morning would survive today's restart and fire a spurious exit order.
    const todayMarketOpen = new Date();
    todayMarketOpen.setUTCHours(3, 45, 0, 0); // 9:15 AM IST
    if (Date.now() < todayMarketOpen.getTime()) {
        // Before today's market open — roll back to yesterday's session open
        todayMarketOpen.setDate(todayMarketOpen.getDate() - 1);
    }
    const cutoffMs = todayMarketOpen.getTime();
    try {
        const db = getDatabase();

        // Remove stale positions before loading
        db.prepare('DELETE FROM monitored_positions WHERE registered_at < ?').run(cutoffMs);

        const rows = db.prepare('SELECT * FROM monitored_positions').all() as any[];
        for (const r of rows) {
            const pos: MonitoredPosition = {
                id: r.id,
                spotToken: r.spot_token,
                spotSegment: r.spot_segment,
                direction: r.direction,
                stopLoss: r.stop_loss,
                target: r.target,
                optionSecurityId: r.option_security_id,
                optionExchangeSegment: r.option_exchange_segment,
                quantity: r.quantity,
                entryPrice: r.entry_price,
                productType: (r.product_type || 'INTRADAY') as MonitoredPosition['productType'],
                pendingFill: r.pending_fill === 1,
                exitTriggered: false,
                registeredAt: r.registered_at,
            };
            monitoredPositions.set(pos.id, pos);
            subscribeToInstrument(pos.spotToken, pos.spotSegment);
            logger.info(`[PositionMonitor] Restored from DB | id:${pos.id} | SL:${pos.stopLoss} | TP:${pos.target}`);
        }
    } catch (err: any) {
        logger.error('[PositionMonitor] Failed to reload persisted positions:', err.message);
    }

    logger.info(`[PositionMonitor] Initialized. Monitoring ${monitoredPositions.size} position(s).`);
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

    // Persist to SQLite so the position survives a server restart
    try {
        const db = getDatabase();
        db.prepare(
            `INSERT OR REPLACE INTO monitored_positions
             (id, spot_token, spot_segment, direction, stop_loss, target,
              option_security_id, option_exchange_segment, quantity, entry_price, product_type, pending_fill, registered_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
        ).run(
            entry.id, entry.spotToken, entry.spotSegment, entry.direction,
            entry.stopLoss, entry.target, entry.optionSecurityId,
            entry.optionExchangeSegment, entry.quantity, entry.entryPrice,
            entry.productType, entry.pendingFill ? 1 : 0, entry.registeredAt,
        );
    } catch (err: any) {
        logger.error('[PositionMonitor] Failed to persist position to DB:', err.message);
    }

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
        try {
            const db = getDatabase();
            db.prepare('DELETE FROM monitored_positions WHERE id = ?').run(id);
        } catch (err: any) {
            logger.error('[PositionMonitor] Failed to remove position from DB:', err.message);
        }
        logger.info(`[PositionMonitor] Unregistered position: ${id}`);
    }
    return existed;
}

/**
 * Update the exit quantity for a monitored position.
 * Called when a partial fill confirms fewer units than originally requested.
 * Returns false if the position doesn't exist or has already triggered an exit.
 */
export function updatePositionQuantity(id: string, quantity: number): boolean {
    const pos = monitoredPositions.get(id);
    if (!pos || pos.exitTriggered) return false;
    pos.quantity = quantity;
    try {
        const db = getDatabase();
        db.prepare('UPDATE monitored_positions SET quantity = ? WHERE id = ?').run(quantity, id);
    } catch (err: any) {
        logger.error('[PositionMonitor] Failed to update quantity in DB:', err.message);
    }
    logger.info(`[PositionMonitor] Quantity updated | id:${id} | newQty:${quantity}`);
    return true;
}

/**
 * Update the target level for an actively monitored position.
 * Only target can be modified — stop loss is strict and immutable.
 * Returns false if the position doesn't exist or has already triggered an exit.
 */
export function updatePositionTarget(id: string, target: number): boolean {
    const pos = monitoredPositions.get(id);
    if (!pos || pos.exitTriggered) return false;
    pos.target = target;
    try {
        const db = getDatabase();
        db.prepare('UPDATE monitored_positions SET target = ? WHERE id = ?').run(target, id);
    } catch (err: any) {
        logger.error('[PositionMonitor] Failed to update target in DB:', err.message);
    }
    logger.info(`[PositionMonitor] Target updated | id:${id} | newTarget:${target}`);
    return true;
}

/**
 * Confirm that the entry order for a registered position has been filled.
 * Until confirmed, onTick will not fire any exits for the position.
 * Called by the frontend once the broker fill poll returns TRADED.
 */
export function confirmPositionFill(id: string): boolean {
    const pos = monitoredPositions.get(id);
    if (!pos || pos.exitTriggered) return false;
    pos.pendingFill = false;
    try {
        const db = getDatabase();
        db.prepare('UPDATE monitored_positions SET pending_fill = 0 WHERE id = ?').run(id);
    } catch (err: any) {
        logger.error('[PositionMonitor] Failed to confirm fill in DB:', err.message);
    }
    logger.info(`[PositionMonitor] Fill confirmed | id:${id} — exits now active`);
    return true;
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
        // Guard: skip if entry order has not yet been confirmed filled at broker
        if (pos.pendingFill) continue;

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
            // triggerExit handles all failure cases internally — this is a last-resort safety net
            logger.error(`[PositionMonitor] Unhandled triggerExit error for ${pos.id}: ${err.message}`);
        });
    }
}

/**
 * Executes the actual broker exit order for a position.
 * Both SL and TP exits use MARKET: the backend only has spot price and option entry premium,
 * not the live option LTP, so a limit-price anchor would be unreliable. MARKET guarantees fill.
 * The frontend smart-exit chaser (3-step LIMIT→LIMIT→MARKET) handles exits when the browser
 * is open. This path is the fallback for browser-closed scenarios.
 */
async function triggerExit(pos: MonitoredPosition, reason: 'SL' | 'TP', triggerPrice: number): Promise<void> {
    // Guard A: abort if position was manually removed between exitTriggered being set (sync) and
    // this async execution — prevents a double exit when the frontend DELETE races with onTick.
    if (!monitoredPositions.has(pos.id)) {
        logger.info(`[PositionMonitor] Position ${pos.id} already removed (manual exit) — aborting backend exit`);
        return;
    }

    // Guard B: verify the option position still exists at the broker before placing an exit order.
    // If it was closed externally (broker app, circuit, expiry), we must NOT place an order and
    // must clean up the monitor — otherwise REJECTED exits would retry indefinitely.
    try {
        const raw = await getPositions();
        const brokerPositions: any[] = Array.isArray(raw) ? raw : [];
        const stillOpen = brokerPositions.some(
            (p: any) =>
                String(p.securityId) === String(pos.optionSecurityId) &&
                p.positionType !== 'CLOSED' &&
                p.buyQty !== p.sellQty &&
                p.exchangeSegment === 'NSE_FNO'
        );
        if (!stillOpen) {
            logger.warn(
                `[PositionMonitor] No open broker position for ${pos.optionSecurityId} ` +
                `(id:${pos.id}) — cleaning up without placing exit order`
            );
            monitoredPositions.delete(pos.id);
            try {
                const db = getDatabase();
                db.prepare('DELETE FROM monitored_positions WHERE id = ?').run(pos.id);
            } catch (dbErr: any) {
                logger.error('[PositionMonitor] Failed to remove no-position entry from DB:', dbErr.message);
            }
            ioInstance?.emit('position:no-position-found', { positionId: pos.id, reason, triggerPrice });
            return;
        }
    } catch (posErr: any) {
        // If the broker positions check itself fails (network error etc.), fall through and attempt
        // the exit order anyway — a failed pre-check must not block a legitimate exit.
        logger.warn(`[PositionMonitor] Broker position pre-check failed for ${pos.id}: ${posErr.message} — proceeding with exit attempt`);
    }

    let placedOrderId: string | undefined;
    try {
        const result = await placeOrder({
            securityId: pos.optionSecurityId,
            exchangeSegment: pos.optionExchangeSegment,
            transactionType: 'SELL',
            quantity: pos.quantity,
            orderType: 'MARKET',
            productType: pos.productType,
        });
        placedOrderId = result?.orderId || result?.data?.orderId;
        logger.info(`[PositionMonitor] ${reason} MARKET exit placed for ${pos.id} | orderId:${placedOrderId} | triggerPrice:${triggerPrice}`);
    } catch (err: any) {
        logger.error(`[PositionMonitor] Exit order failed for ${pos.id}: ${err.message}`);
        // Do NOT reset exitTriggered — no retry. Notify frontend to act manually.
        ioInstance?.emit('position:exit-failed', {
            positionId: pos.id,
            reason,
            triggerPrice,
            error: err.message,
        });
        // Remove from monitoring — position is in an unknown broker state, user must act manually
        monitoredPositions.delete(pos.id);
        try {
            const db = getDatabase();
            db.prepare('DELETE FROM monitored_positions WHERE id = ?').run(pos.id);
        } catch (dbErr: any) {
            logger.error('[PositionMonitor] Failed to remove failed position from DB:', dbErr.message);
        }
        return; // Error is handled — don't throw, don't retry
    }

    // Poll order status after 3 s to confirm TRADED. If REJECTED, reset the trigger flag
    // and alert the frontend so the user can act manually.
    if (placedOrderId) {
        setTimeout(async () => {
            try {
                const resp = await getOrderStatus(placedOrderId!);
                const status: string = resp?.orderStatus || resp?.data?.orderStatus || '';
                if (status === 'REJECTED') {
                    const reason_str = resp?.rejectedReason || resp?.data?.rejectedReason || 'unknown reason';
                    logger.error(`[PositionMonitor] Exit order REJECTED for ${pos.id}: ${reason_str}`);
                    // "No position" rejections (closed externally) must not retry — clean up instead.
                    // Transient rejections (network, price slip) should retry on next tick.
                    const isNoPositionError = /position|holding|insufficient|no open/i.test(reason_str);
                    if (isNoPositionError) {
                        logger.warn(`[PositionMonitor] Rejection indicates no open position for ${pos.id} — cleaning up`);
                        monitoredPositions.delete(pos.id);
                        try {
                            const db = getDatabase();
                            db.prepare('DELETE FROM monitored_positions WHERE id = ?').run(pos.id);
                        } catch (dbErr: any) {
                            logger.error('[PositionMonitor] Failed to remove rejected position from DB:', dbErr.message);
                        }
                        ioInstance?.emit('position:no-position-found', { positionId: pos.id, reason });
                    } else {
                        // Transient error — allow retry on next tick
                        pos.exitTriggered = false;
                        ioInstance?.emit('position:exit-failed', {
                            positionId: pos.id,
                            reason,
                            error: `Exit order REJECTED: ${reason_str}. Retrying on next tick.`,
                        });
                    }
                    return;
                }
                logger.info(`[PositionMonitor] Exit order confirmed ${status} for ${pos.id}`);
            } catch (pollErr: any) {
                logger.warn(`[PositionMonitor] Could not verify exit order status for ${pos.id}: ${pollErr.message}`);
            }

            // Clean up after confirmed (or unverifiable) exit
            monitoredPositions.delete(pos.id);
            try {
                const db = getDatabase();
                db.prepare('DELETE FROM monitored_positions WHERE id = ?').run(pos.id);
            } catch (err: any) {
                logger.error('[PositionMonitor] Failed to remove exited position from DB:', err.message);
            }

            ioInstance?.emit('position:exit-placed', {
                positionId: pos.id,
                reason,
                triggerPrice,
            });
        }, 3000);
    } else {
        // No orderId returned — clean up optimistically and notify
        monitoredPositions.delete(pos.id);
        try {
            const db = getDatabase();
            db.prepare('DELETE FROM monitored_positions WHERE id = ?').run(pos.id);
        } catch (err: any) {
            logger.error('[PositionMonitor] Failed to remove exited position from DB:', err.message);
        }
        ioInstance?.emit('position:exit-placed', { positionId: pos.id, reason, triggerPrice });
    }
}
