"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initPositionMonitor = initPositionMonitor;
exports.registerPosition = registerPosition;
exports.unregisterPosition = unregisterPosition;
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
    // Positions older than 24h are cleaned up — they predate the current trading day.
    const TTL_MS = 24 * 60 * 60 * 1000;
    const cutoffMs = Date.now() - TTL_MS;
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
              option_security_id, option_exchange_segment, quantity, entry_price, registered_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(entry.id, entry.spotToken, entry.spotSegment, entry.direction, entry.stopLoss, entry.target, entry.optionSecurityId, entry.optionExchangeSegment, entry.quantity, entry.entryPrice, entry.registeredAt);
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
 * For SL: uses the 3-step SmartExit chaser.
 * For TP: places a direct MARKET order for immediate fill.
 */
async function triggerExit(pos, reason, triggerPrice) {
    try {
        // Both SL and TP exit at MARKET — the backend monitors spot price to trigger,
        // but the exit is on the option. We don't have the live option premium here,
        // so LIMIT pricing derived from spot is meaningless. MARKET guarantees a fill.
        await (0, dhan_adapter_1.placeOrder)({
            securityId: pos.optionSecurityId,
            exchangeSegment: pos.optionExchangeSegment,
            transactionType: 'SELL',
            quantity: pos.quantity,
            orderType: 'MARKET',
            productType: 'INTRADAY',
        });
        logger_1.default.info(`[PositionMonitor] ${reason} MARKET exit placed for ${pos.id} | triggerPrice:${triggerPrice}`);
        // Clean up after successful exit (in-memory + DB)
        monitoredPositions.delete(pos.id);
        try {
            const db = (0, database_1.getDatabase)();
            db.prepare('DELETE FROM monitored_positions WHERE id = ?').run(pos.id);
        }
        catch (err) {
            logger_1.default.error('[PositionMonitor] Failed to remove exited position from DB:', err.message);
        }
        // Notify clients that exit order was successfully placed
        ioInstance?.emit('position:exit-placed', {
            positionId: pos.id,
            reason,
            triggerPrice,
        });
    }
    catch (err) {
        logger_1.default.error(`[PositionMonitor] Exit order failed for ${pos.id}: ${err.message}`);
        // Reset flag so the next tick can retry — prevents silent permanent failure
        pos.exitTriggered = false;
        // Re-throw so the caller can emit position:exit-failed
        throw err;
    }
}
