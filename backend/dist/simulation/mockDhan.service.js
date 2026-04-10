"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setSimPrice = setSimPrice;
exports.initDhanClient = initDhanClient;
exports.getDhanClient = getDhanClient;
exports.placeOrder = placeOrder;
exports.getOrderStatus = getOrderStatus;
exports.modifyOrder = modifyOrder;
exports.getPositions = getPositions;
exports.retryApiCall = retryApiCall;
/**
 * Mock Dhan Service — Simulation Mode
 *
 * Implements the same function signatures as dhan.service.ts but operates
 * entirely against the in-memory virtualOrderBook. No network calls are made.
 */
const logger_1 = __importDefault(require("../utils/logger"));
const virtualOrderBook_1 = require("./virtualOrderBook");
// ─── Current simulated spot prices (set by mockMarketFeed) ───────────────────
const currentPrices = new Map();
function setSimPrice(securityId, price) {
    currentPrices.set(securityId, price);
}
function getSimPrice(securityId) {
    return currentPrices.get(securityId) ?? 100; // default fallback LTP
}
// ─── No-op client init ────────────────────────────────────────────────────────
function initDhanClient() {
    logger_1.default.info('[MockDhan] Simulation mode — Dhan client not initialized (no-op)');
    return {};
}
function getDhanClient() {
    return {};
}
// ─── Order Placement ─────────────────────────────────────────────────────────
async function placeOrder(params) {
    const orderType = params.orderType || 'LIMIT';
    const price = params.price || 0;
    if (orderType === 'LIMIT' && price <= 0) {
        throw new Error('LIMIT order requires a valid price > 0');
    }
    const order = virtualOrderBook_1.virtualOrderBook.placeOrder({
        ...params,
        price: price || getSimPrice(params.securityId),
        orderType,
    });
    if (order._sim_shouldReject) {
        // Wait for the async reject to run, then throw
        await new Promise(resolve => setTimeout(resolve, 10));
        throw new Error(`Dhan API error: {"errorCode":"OE-REJECTED","message":"Simulated rejection — insufficient funds"}`);
    }
    return { orderId: order.orderId, orderStatus: order.orderStatus };
}
// ─── Order Status ─────────────────────────────────────────────────────────────
async function getOrderStatus(orderId) {
    const order = virtualOrderBook_1.virtualOrderBook.getOrder(orderId);
    if (!order) {
        throw new Error(`Dhan API error: {"errorCode":"OE-NOT-FOUND","message":"Order ${orderId} not found"}`);
    }
    return {
        orderId: order.orderId,
        orderStatus: order.orderStatus,
        tradedQuantity: order.tradedQuantity,
        remainingQuantity: order.remainingQuantity,
        tradedPrice: order.tradedPrice,
        rejectedReason: order.rejectedReason,
        price: order.price,
        transactionType: order.transactionType,
        securityId: order.securityId,
    };
}
// ─── Order Modification ───────────────────────────────────────────────────────
async function modifyOrder(orderId, params) {
    const updated = virtualOrderBook_1.virtualOrderBook.modifyOrder(orderId, params);
    if (!updated) {
        throw new Error(`Dhan API error: {"errorCode":"OE-MODIFY-FAILED","message":"Order ${orderId} cannot be modified"}`);
    }
    return { orderId, orderStatus: updated.orderStatus };
}
// ─── Positions ────────────────────────────────────────────────────────────────
async function getPositions() {
    return virtualOrderBook_1.virtualOrderBook.getPositions().map(p => ({
        ...p,
        // Dhan uses these field names — match exactly for frontend compatibility
        positionType: p.positionType,
        realizedProfit: p.realizedProfit,
        unrealizedProfit: p.unrealizedProfit,
    }));
}
// ─── Retry wrapper (no-op passthrough in simulation) ─────────────────────────
async function retryApiCall(fn) {
    return fn();
}
