"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initPositionMonitor = initPositionMonitor;
exports.registerPosition = registerPosition;
exports.unregisterPosition = unregisterPosition;
exports.updatePositionQuantity = updatePositionQuantity;
exports.updatePositionTarget = updatePositionTarget;
exports.getMonitoredPositions = getMonitoredPositions;
exports.onTick = onTick;
const dhan_adapter_1 = require("../adapters/dhan.adapter");
const dhanFeed_adapter_1 = require("../adapters/dhanFeed.adapter");
const database_1 = require("../config/database");
const logger_1 = __importDefault(require("../utils/logger"));
/** In-memory map of all actively monitored positions. Keyed by id (liveOptionToken). */
const monitoredPositions = new Map();
let ioInstance = null;
/**
 * Must be called once at server startup (after initDhanMarketFeed).
 * Wires up the position monitor to receive price ticks, and reloads
 * any positions that were persisted before the last server restart.
 */
function initPositionMonitor(io) {
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
        const db = (0, database_1.getDatabase)();
        // Remove stale positions before loading
        db.prepare('DELETE FROM monitored_positions WHERE registered_at < ?').run(cutoffMs);
        const rows = db.prepare('SELECT * FROM monitored_positions').all();
        for (const r of rows) {
            const pos = {
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
                productType: (r.product_type || 'INTRADAY'),
                exitTriggered: false,
                registeredAt: r.registered_at,
            };
            monitoredPositions.set(pos.id, pos);
            (0, dhanFeed_adapter_1.subscribeToInstrument)(pos.spotToken, pos.spotSegment);
            logger_1.default.info(`[PositionMonitor] Restored from DB | id:${pos.id} | SL:${pos.stopLoss} | TP:${pos.target}`);
        }
    }
    catch (err) {
        logger_1.default.error('[PositionMonitor] Failed to reload persisted positions:', err.message);
    }
    logger_1.default.info(`[PositionMonitor] Initialized. Monitoring ${monitoredPositions.size} position(s).`);
}
/**
 * Register a new position for backend SL/TP monitoring.
 * Called by the frontend immediately after a live option order is placed.
 */
function registerPosition(params) {
    const entry = {
        ...params,
        exitTriggered: false,
        registeredAt: Date.now(),
    };
    monitoredPositions.set(params.id, entry);
    // Persist to SQLite so the position survives a server restart
    try {
        const db = (0, database_1.getDatabase)();
        db.prepare(`INSERT OR REPLACE INTO monitored_positions
             (id, spot_token, spot_segment, direction, stop_loss, target,
              option_security_id, option_exchange_segment, quantity, entry_price, product_type, registered_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(entry.id, entry.spotToken, entry.spotSegment, entry.direction, entry.stopLoss, entry.target, entry.optionSecurityId, entry.optionExchangeSegment, entry.quantity, entry.entryPrice, entry.productType, entry.registeredAt);
    }
    catch (err) {
        logger_1.default.error('[PositionMonitor] Failed to persist position to DB:', err.message);
    }
    // Make sure the backend is subscribed to the spot index token so ticks keep flowing
    (0, dhanFeed_adapter_1.subscribeToInstrument)(params.spotToken, params.spotSegment);
    logger_1.default.info(`[PositionMonitor] Registered | id:${params.id} | ${params.direction} | ` +
        `SL:${params.stopLoss} | TP:${params.target} | qty:${params.quantity} | token:${params.spotToken}`);
}
/**
 * Remove a position from monitoring.
 * Called by the frontend when the user manually closes the position.
 */
function unregisterPosition(id) {
    const existed = monitoredPositions.delete(id);
    if (existed) {
        try {
            const db = (0, database_1.getDatabase)();
            db.prepare('DELETE FROM monitored_positions WHERE id = ?').run(id);
        }
        catch (err) {
            logger_1.default.error('[PositionMonitor] Failed to remove position from DB:', err.message);
        }
        logger_1.default.info(`[PositionMonitor] Unregistered position: ${id}`);
    }
    return existed;
}
/**
 * Update the exit quantity for a monitored position.
 * Called when a partial fill confirms fewer units than originally requested.
 * Returns false if the position doesn't exist or has already triggered an exit.
 */
function updatePositionQuantity(id, quantity) {
    const pos = monitoredPositions.get(id);
    if (!pos || pos.exitTriggered)
        return false;
    pos.quantity = quantity;
    try {
        const db = (0, database_1.getDatabase)();
        db.prepare('UPDATE monitored_positions SET quantity = ? WHERE id = ?').run(quantity, id);
    }
    catch (err) {
        logger_1.default.error('[PositionMonitor] Failed to update quantity in DB:', err.message);
    }
    logger_1.default.info(`[PositionMonitor] Quantity updated | id:${id} | newQty:${quantity}`);
    return true;
}
/**
 * Update the target level for an actively monitored position.
 * Only target can be modified — stop loss is strict and immutable.
 * Returns false if the position doesn't exist or has already triggered an exit.
 */
function updatePositionTarget(id, target) {
    const pos = monitoredPositions.get(id);
    if (!pos || pos.exitTriggered)
        return false;
    pos.target = target;
    try {
        const db = (0, database_1.getDatabase)();
        db.prepare('UPDATE monitored_positions SET target = ? WHERE id = ?').run(target, id);
    }
    catch (err) {
        logger_1.default.error('[PositionMonitor] Failed to update target in DB:', err.message);
    }
    logger_1.default.info(`[PositionMonitor] Target updated | id:${id} | newTarget:${target}`);
    return true;
}
/**
 * Return a sanitized snapshot of all monitored positions (no internal flags leaked).
 */
function getMonitoredPositions() {
    return Array.from(monitoredPositions.values()).map(({ exitTriggered, ...rest }) => rest);
}
/**
 * Called on every price tick by dhanMarketFeed.
 * Checks every registered position against the new price and fires exits as needed.
 *
 * This is the core of the backend monitor — it runs independently of the frontend.
 */
async function onTick(token, price) {
    if (monitoredPositions.size === 0)
        return;
    for (const pos of monitoredPositions.values()) {
        // Only process positions watching this specific token
        if (pos.spotToken !== token)
            continue;
        // Guard: skip if exit is already in-flight
        if (pos.exitTriggered)
            continue;
        const { stopLoss, target, direction } = pos;
        const isLong = direction === 'LONG';
        let slHit = false;
        let tpHit = false;
        if (isLong) {
            if (stopLoss > 0 && price <= stopLoss)
                slHit = true;
            else if (target > 0 && price >= target)
                tpHit = true;
        }
        else {
            if (stopLoss > 0 && price >= stopLoss)
                slHit = true;
            else if (target > 0 && price <= target)
                tpHit = true;
        }
        if (!slHit && !tpHit)
            continue;
        // Mark triggered SYNCHRONOUSLY before any await to prevent re-entry on next tick
        pos.exitTriggered = true;
        const reason = slHit ? 'SL' : 'TP';
        logger_1.default.info(`[PositionMonitor] ${reason} HIT | id:${pos.id} | price:${price} | ` +
            `SL:${pos.stopLoss} | TP:${pos.target}`);
        // Notify all connected frontend clients immediately
        ioInstance?.emit('position:exit-triggered', {
            positionId: pos.id,
            reason,
            triggerPrice: price,
            stopLoss: pos.stopLoss,
            target: pos.target,
        });
        // Fire the exit order asynchronously so we don't block tick processing
        triggerExit(pos, reason, price).catch((err) => {
            logger_1.default.error(`[PositionMonitor] triggerExit failed for ${pos.id}: ${err.message}`);
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
 * Both SL and TP exits use MARKET: the backend only has spot price and option entry premium,
 * not the live option LTP, so a limit-price anchor would be unreliable. MARKET guarantees fill.
 * The frontend smart-exit chaser (3-step LIMIT→LIMIT→MARKET) handles exits when the browser
 * is open. This path is the fallback for browser-closed scenarios.
 */
async function triggerExit(pos, reason, triggerPrice) {
    let placedOrderId;
    try {
        const result = await (0, dhan_adapter_1.placeOrder)({
            securityId: pos.optionSecurityId,
            exchangeSegment: pos.optionExchangeSegment,
            transactionType: 'SELL',
            quantity: pos.quantity,
            orderType: 'MARKET',
            productType: pos.productType,
        });
        placedOrderId = result?.orderId || result?.data?.orderId;
        logger_1.default.info(`[PositionMonitor] ${reason} MARKET exit placed for ${pos.id} | orderId:${placedOrderId} | triggerPrice:${triggerPrice}`);
    }
    catch (err) {
        logger_1.default.error(`[PositionMonitor] Exit order failed for ${pos.id}: ${err.message}`);
        // Reset flag so the next tick can retry — prevents silent permanent failure
        pos.exitTriggered = false;
        throw err;
    }
    // Poll order status after 3 s to confirm TRADED. If REJECTED, reset the trigger flag
    // and alert the frontend so the user can act manually.
    if (placedOrderId) {
        setTimeout(async () => {
            try {
                const resp = await (0, dhan_adapter_1.getOrderStatus)(placedOrderId);
                const status = resp?.orderStatus || resp?.data?.orderStatus || '';
                if (status === 'REJECTED') {
                    const reason_str = resp?.rejectedReason || resp?.data?.rejectedReason || 'unknown reason';
                    logger_1.default.error(`[PositionMonitor] Exit order REJECTED for ${pos.id}: ${reason_str}`);
                    // Reset so next tick retries
                    pos.exitTriggered = false;
                    ioInstance?.emit('position:exit-failed', {
                        positionId: pos.id,
                        reason,
                        error: `Exit order REJECTED: ${reason_str}. Retrying on next tick.`,
                    });
                    return; // Don't clean up — position still open
                }
                logger_1.default.info(`[PositionMonitor] Exit order confirmed ${status} for ${pos.id}`);
            }
            catch (pollErr) {
                logger_1.default.warn(`[PositionMonitor] Could not verify exit order status for ${pos.id}: ${pollErr.message}`);
            }
            // Clean up after confirmed (or unverifiable) exit
            monitoredPositions.delete(pos.id);
            try {
                const db = (0, database_1.getDatabase)();
                db.prepare('DELETE FROM monitored_positions WHERE id = ?').run(pos.id);
            }
            catch (err) {
                logger_1.default.error('[PositionMonitor] Failed to remove exited position from DB:', err.message);
            }
            ioInstance?.emit('position:exit-placed', {
                positionId: pos.id,
                reason,
                triggerPrice,
            });
        }, 3000);
    }
    else {
        // No orderId returned — clean up optimistically and notify
        monitoredPositions.delete(pos.id);
        try {
            const db = (0, database_1.getDatabase)();
            db.prepare('DELETE FROM monitored_positions WHERE id = ?').run(pos.id);
        }
        catch (err) {
            logger_1.default.error('[PositionMonitor] Failed to remove exited position from DB:', err.message);
        }
        ioInstance?.emit('position:exit-placed', { positionId: pos.id, reason, triggerPrice });
    }
}
