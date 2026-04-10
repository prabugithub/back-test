"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.virtualOrderBook = void 0;
const logger_1 = __importDefault(require("../utils/logger"));
class VirtualOrderBookImpl {
    constructor() {
        this.orders = new Map();
        this.positions = new Map();
        this.orderCounter = 1000;
        this.fillTimers = new Map();
        this.defaultBehavior = {
            autoFillDelayMs: 0,
            rejectNextOrder: false,
            partialFillQty: null,
        };
        this.nextOrderOverride = null;
    }
    generateOrderId() {
        return `SIM-ORD-${Date.now()}-${this.orderCounter++}`;
    }
    setDefaultFillBehavior(b) {
        this.defaultBehavior = { ...this.defaultBehavior, ...b };
    }
    setNextOrderOverride(o) {
        this.nextOrderOverride = o;
    }
    placeOrder(params) {
        const orderId = this.generateOrderId();
        const now = new Date().toISOString();
        const override = this.nextOrderOverride || {};
        this.nextOrderOverride = null;
        const shouldReject = override._sim_shouldReject ?? this.defaultBehavior.rejectNextOrder;
        if (shouldReject) {
            this.defaultBehavior.rejectNextOrder = false;
        }
        const autoFillDelay = override._sim_autoFillDelayMs ?? this.defaultBehavior.autoFillDelayMs;
        const partialFillQty = override._sim_partialFillQty ?? this.defaultBehavior.partialFillQty;
        const order = {
            orderId,
            correlationId: `sim-${Date.now()}`,
            dhanClientId: 'SIM_CLIENT',
            securityId: params.securityId,
            exchangeSegment: params.exchangeSegment,
            transactionType: params.transactionType,
            orderType: params.orderType || 'MARKET',
            productType: params.productType || 'INTRADAY',
            validity: 'DAY',
            quantity: params.quantity,
            price: params.price || 0,
            disclosedQuantity: 0,
            triggerPrice: 0,
            orderStatus: 'PENDING',
            tradedQuantity: 0,
            remainingQuantity: params.quantity,
            tradedPrice: 0,
            createTime: now,
            updateTime: now,
            _sim_autoFillDelayMs: autoFillDelay,
            _sim_partialFillQty: partialFillQty,
            _sim_shouldReject: shouldReject,
            _sim_fillPrice: override._sim_fillPrice ?? null,
        };
        this.orders.set(orderId, order);
        logger_1.default.info(`[VirtualOrderBook] Placed order ${orderId} ${params.transactionType} ${params.quantity}x ${params.securityId} @ ${params.price || 'MKT'}`);
        if (shouldReject) {
            // Reject synchronously so placeOrder caller can detect it
            setTimeout(() => this.rejectOrder(orderId, 'Simulated rejection — insufficient funds'), 0);
        }
        else if (order.orderType === 'MARKET' || autoFillDelay === 0) {
            // Fill immediately (next tick)
            const timer = setTimeout(() => {
                this.fillOrder(orderId, partialFillQty ?? params.quantity, order._sim_fillPrice ?? params.price ?? 0);
            }, order.orderType === 'MARKET' ? 0 : autoFillDelay);
            this.fillTimers.set(orderId, timer);
        }
        else if (autoFillDelay > 0 && autoFillDelay < 90000) {
            // Delayed fill
            const timer = setTimeout(() => {
                this.fillOrder(orderId, partialFillQty ?? params.quantity, order._sim_fillPrice ?? params.price ?? 0);
            }, autoFillDelay);
            this.fillTimers.set(orderId, timer);
        }
        // If autoFillDelay >= 90000, order stays PENDING indefinitely (simulates unfilled LIMIT)
        return order;
    }
    getOrder(orderId) {
        return this.orders.get(orderId);
    }
    getAllOrders() {
        return Array.from(this.orders.values()).map(o => {
            // Strip sim-internal fields from API-facing response
            const { _sim_autoFillDelayMs, _sim_partialFillQty, _sim_shouldReject, _sim_fillPrice, ...clean } = o;
            return clean;
        });
    }
    fillOrder(orderId, fillQty, fillPrice) {
        const order = this.orders.get(orderId);
        if (!order || order.orderStatus === 'REJECTED' || order.orderStatus === 'CANCELLED')
            return;
        if (order.orderStatus === 'TRADED')
            return;
        const actualFillQty = Math.min(fillQty, order.quantity);
        order.tradedQuantity = actualFillQty;
        order.remainingQuantity = order.quantity - actualFillQty;
        order.tradedPrice = fillPrice > 0 ? fillPrice : (order.price || 22000);
        order.updateTime = new Date().toISOString();
        if (actualFillQty >= order.quantity) {
            order.orderStatus = 'TRADED';
        }
        else {
            order.orderStatus = 'PARTIALLY_TRADED';
        }
        logger_1.default.info(`[VirtualOrderBook] Filled order ${orderId} qty:${actualFillQty} @ ${order.tradedPrice} → ${order.orderStatus}`);
        // Update virtual positions
        this.updatePosition(order, actualFillQty, order.tradedPrice);
    }
    rejectOrder(orderId, reason) {
        const order = this.orders.get(orderId);
        if (!order)
            return;
        order.orderStatus = 'REJECTED';
        order.rejectedReason = reason;
        order.updateTime = new Date().toISOString();
        logger_1.default.info(`[VirtualOrderBook] Rejected order ${orderId}: ${reason}`);
    }
    modifyOrder(orderId, patch) {
        const order = this.orders.get(orderId);
        if (!order)
            return null;
        if (order.orderStatus !== 'PENDING' && order.orderStatus !== 'TRANSIT')
            return null;
        const wasLimit = order.orderType === 'LIMIT';
        if (patch.orderType)
            order.orderType = patch.orderType;
        if (patch.price !== undefined)
            order.price = patch.price;
        if (patch.quantity !== undefined) {
            order.quantity = patch.quantity;
            order.remainingQuantity = patch.quantity - order.tradedQuantity;
        }
        order.updateTime = new Date().toISOString();
        logger_1.default.info(`[VirtualOrderBook] Modified order ${orderId} → type:${order.orderType} price:${order.price}`);
        // If upgraded to MARKET, fill immediately
        if (wasLimit && order.orderType === 'MARKET') {
            // Cancel any existing fill timer
            const existing = this.fillTimers.get(orderId);
            if (existing) {
                clearTimeout(existing);
                this.fillTimers.delete(orderId);
            }
            const timer = setTimeout(() => {
                this.fillOrder(orderId, order.remainingQuantity, order._sim_fillPrice ?? order.price ?? 0);
            }, 50);
            this.fillTimers.set(orderId, timer);
        }
        return order;
    }
    updatePosition(order, fillQty, fillPrice) {
        const key = order.securityId;
        let pos = this.positions.get(key);
        if (!pos) {
            pos = {
                securityId: order.securityId,
                tradingSymbol: order.securityId,
                exchangeSegment: order.exchangeSegment,
                productType: order.productType,
                buyQty: 0,
                sellQty: 0,
                buyAvg: 0,
                sellAvg: 0,
                costPrice: 0,
                positionType: 'LONG',
                realizedProfit: 0,
                unrealizedProfit: 0,
                dayBuyQty: 0,
                daySellQty: 0,
                netQty: 0,
                currentPrice: fillPrice,
            };
            this.positions.set(key, pos);
        }
        if (order.transactionType === 'BUY') {
            const totalCost = pos.buyAvg * pos.buyQty + fillPrice * fillQty;
            pos.buyQty += fillQty;
            pos.dayBuyQty += fillQty;
            pos.buyAvg = pos.buyQty > 0 ? totalCost / pos.buyQty : 0;
        }
        else {
            const totalCost = pos.sellAvg * pos.sellQty + fillPrice * fillQty;
            pos.sellQty += fillQty;
            pos.daySellQty += fillQty;
            pos.sellAvg = pos.sellQty > 0 ? totalCost / pos.sellQty : 0;
            // Calculate realized profit for closing sells
            if (pos.buyQty > 0) {
                const closedQty = Math.min(fillQty, pos.buyQty);
                pos.realizedProfit += (fillPrice - pos.buyAvg) * closedQty;
            }
        }
        pos.netQty = pos.buyQty - pos.sellQty;
        pos.currentPrice = fillPrice;
        pos.positionType = pos.netQty > 0 ? 'LONG' : pos.netQty < 0 ? 'SHORT' : 'CLOSED';
        pos.unrealizedProfit = pos.netQty !== 0
            ? (fillPrice - (pos.netQty > 0 ? pos.buyAvg : pos.sellAvg)) * Math.abs(pos.netQty)
            : 0;
        pos.costPrice = pos.netQty > 0 ? pos.buyAvg : pos.sellAvg;
    }
    updatePositionPrice(securityId, price) {
        const pos = this.positions.get(securityId);
        if (!pos)
            return;
        pos.currentPrice = price;
        pos.unrealizedProfit = pos.netQty !== 0
            ? (price - pos.costPrice) * Math.abs(pos.netQty)
            : 0;
    }
    getPositions() {
        return Array.from(this.positions.values()).filter(p => p.netQty !== 0);
    }
    reset() {
        // Cancel all pending fill timers
        for (const timer of this.fillTimers.values()) {
            clearTimeout(timer);
        }
        this.fillTimers.clear();
        this.orders.clear();
        this.positions.clear();
        this.defaultBehavior = { autoFillDelayMs: 0, rejectNextOrder: false, partialFillQty: null };
        this.nextOrderOverride = null;
        logger_1.default.info('[VirtualOrderBook] Reset — all orders and positions cleared');
    }
}
exports.virtualOrderBook = new VirtualOrderBookImpl();
