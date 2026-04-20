/**
 * Mock Dhan Service — Simulation Mode
 *
 * Implements the same function signatures as dhan.service.ts but operates
 * entirely against the in-memory virtualOrderBook. No network calls are made.
 */
import logger from '../utils/logger';
import { virtualOrderBook } from './virtualOrderBook';

// ─── Current simulated spot prices (set by mockMarketFeed) ───────────────────
const currentPrices = new Map<string, number>();

export function setSimPrice(securityId: string, price: number): void {
    currentPrices.set(securityId, price);
}

function getSimPrice(securityId: string): number {
    return currentPrices.get(securityId) ?? 100; // default fallback LTP
}

// ─── No-op client init ────────────────────────────────────────────────────────

export function initDhanClient() {
    logger.info('[MockDhan] Simulation mode — Dhan client not initialized (no-op)');
    return {};
}

export function getDhanClient() {
    return {};
}

// ─── Order Placement ─────────────────────────────────────────────────────────

export async function placeOrder(params: {
    securityId: string;
    exchangeSegment: string;
    transactionType: 'BUY' | 'SELL';
    quantity: number;
    price?: number;
    orderType?: 'MARKET' | 'LIMIT';
    productType?: 'CNC' | 'INTRADAY' | 'MARGIN' | 'MTF' | 'CO' | 'BO';
}): Promise<{ orderId: string; orderStatus: string }> {
    const orderType = params.orderType || 'LIMIT';
    const price = params.price || 0;

    if (orderType === 'LIMIT' && price <= 0) {
        throw new Error('LIMIT order requires a valid price > 0');
    }

    const order = virtualOrderBook.placeOrder({
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

export async function getOrderStatus(orderId: string): Promise<{
    orderId: string;
    orderStatus: string;
    tradedQuantity: number;
    remainingQuantity: number;
    tradedPrice: number;
    rejectedReason?: string;
    price: number;
    transactionType: string;
    securityId: string;
}> {
    const order = virtualOrderBook.getOrder(orderId);
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

export async function modifyOrder(
    orderId: string,
    params: {
        orderType: 'MARKET' | 'LIMIT';
        price?: number;
        quantity: number;
        exchangeSegment: string;
    }
): Promise<{ orderId: string; orderStatus: string }> {
    const updated = virtualOrderBook.modifyOrder(orderId, params);
    if (!updated) {
        throw new Error(`Dhan API error: {"errorCode":"OE-MODIFY-FAILED","message":"Order ${orderId} cannot be modified"}`);
    }
    return { orderId, orderStatus: updated.orderStatus };
}

// ─── Positions ────────────────────────────────────────────────────────────────

export async function getPositions(): Promise<any[]> {
    return virtualOrderBook.getPositions().map(p => ({
        ...p,
        // Dhan uses these field names — match exactly for frontend compatibility
        positionType: p.positionType,
        realizedProfit: p.realizedProfit,
        unrealizedProfit: p.unrealizedProfit,
    }));
}

// ─── Option LTP ───────────────────────────────────────────────────────────────

export async function getOptionLTP(securityId: string, _exchangeSegment = 'NSE_FNO'): Promise<number | null> {
    const price = currentPrices.get(securityId);
    logger.info(`[MockDhan] getOptionLTP ${securityId}: ${price ?? null}`);
    return price ?? null;
}

// ─── Retry wrapper (no-op passthrough in simulation) ─────────────────────────

export async function retryApiCall<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
}
