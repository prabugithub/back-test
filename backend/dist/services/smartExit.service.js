"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.executeSmartExit = executeSmartExit;
const dhan_adapter_1 = require("../adapters/dhan.adapter");
const logger_1 = __importDefault(require("../utils/logger"));
/** Parse "Rate Not Within Ckt Limit 0.05 To 525.80" → { lower: 0.05, upper: 525.80 } */
function parseCircuitLimits(errorMsg) {
    const match = errorMsg.match(/Ckt Limit\s+([\d.]+)\s+To\s+([\d.]+)/i);
    if (!match)
        return null;
    return { lower: parseFloat(match[1]), upper: parseFloat(match[2]) };
}
/** Clamp an order price to within the circuit limit range. */
function clampToCircuit(price, circuit, transactionType) {
    if (transactionType === 'SELL')
        return Math.max(price, circuit.lower);
    return Math.min(price, circuit.upper);
}
const MARKET_ORDER_BASE = { orderType: 'MARKET', productType: 'INTRADAY' };
async function executeSmartExit(params) {
    logger_1.default.info(`Starting Smart Exit Chaser for ${params.securityId} SL Level: ${params.slPrice}`);
    // Step 1: Initial Anchor (0.5% Buffer limit)
    const buf1Price = params.transactionType === 'SELL'
        ? Math.floor(params.slPrice * 0.995 * 20) / 20
        : Math.ceil(params.slPrice * 1.005 * 20) / 20;
    let currentOrderId = undefined;
    try {
        const initialOrder = await (0, dhan_adapter_1.placeOrder)({
            securityId: params.securityId,
            exchangeSegment: params.exchangeSegment,
            transactionType: params.transactionType,
            quantity: params.quantity,
            price: buf1Price,
            orderType: 'LIMIT',
            productType: 'INTRADAY'
        });
        currentOrderId = initialOrder?.orderId || initialOrder?.data?.orderId;
        if (!currentOrderId) {
            throw new Error("Failed to retrieve orderId from initial placement");
        }
        logger_1.default.info(`Smart Exit Step 1: Placed Anchor Limit @ ${buf1Price}. Order ID: ${currentOrderId}`);
    }
    catch (err) {
        const circuit = parseCircuitLimits(err.message || '');
        if (circuit) {
            // Price landed outside circuit — clamp and retry as LIMIT within valid range
            const clampedPrice = clampToCircuit(buf1Price, circuit, params.transactionType);
            logger_1.default.warn(`Smart Exit Step 1: Circuit limit [${circuit.lower}–${circuit.upper}]. Retrying LIMIT @ ${clampedPrice}`);
            try {
                const retryOrder = await (0, dhan_adapter_1.placeOrder)({
                    securityId: params.securityId,
                    exchangeSegment: params.exchangeSegment,
                    transactionType: params.transactionType,
                    quantity: params.quantity,
                    price: clampedPrice,
                    orderType: 'LIMIT',
                    productType: 'INTRADAY'
                });
                currentOrderId = retryOrder?.orderId || retryOrder?.data?.orderId;
                if (!currentOrderId)
                    throw new Error("No orderId from circuit-clamped retry");
                logger_1.default.info(`Smart Exit Step 1 (circuit-clamped): Placed @ ${clampedPrice}. Order ID: ${currentOrderId}`);
            }
            catch (retryErr) {
                logger_1.default.error("Smart Exit Step 1 circuit retry failed, trying MARKET fallback.", retryErr.message);
                const fallback = await (0, dhan_adapter_1.placeOrder)({
                    securityId: params.securityId,
                    exchangeSegment: params.exchangeSegment,
                    transactionType: params.transactionType,
                    quantity: params.quantity,
                    ...MARKET_ORDER_BASE
                });
                return { success: true, message: "Exited at Market (Circuit Fallback)", orderId: fallback?.orderId };
            }
        }
        else {
            logger_1.default.error("Smart Exit Step 1 failed, trying MARKET order fallback immediately.", err.message);
            const fallback = await (0, dhan_adapter_1.placeOrder)({
                securityId: params.securityId,
                exchangeSegment: params.exchangeSegment,
                transactionType: params.transactionType,
                quantity: params.quantity,
                ...MARKET_ORDER_BASE
            });
            return { success: true, message: "Exited at Market (Fallback)", orderId: fallback?.orderId };
        }
    }
    // Launch the chaser loop asynchronously so we don't block the API response
    // Return success immediately to let frontend proceed
    chaseOrderLoop(currentOrderId, params).catch((err) => {
        logger_1.default.error(`[SmartExit] Unhandled error in chaseOrderLoop for order ${currentOrderId}:`, err.message);
    });
    return { success: true, message: "Smart Exit loop started", orderId: currentOrderId };
}
async function chaseOrderLoop(orderId, params) {
    try {
        // Wait 2 seconds for Step 1
        await new Promise(resolve => setTimeout(resolve, 2000));
        let statusResp = await (0, dhan_adapter_1.getOrderStatus)(orderId);
        let status = statusResp?.orderStatus || statusResp?.data?.orderStatus;
        if (status === 'TRADED') {
            logger_1.default.info(`Smart Exit: Order ${orderId} filled at Step 1.`);
            return;
        }
        // Step 2: Deeper Chasing (2% buffer)
        logger_1.default.info(`Smart Exit: Order ${orderId} status ${status}. Moving to Step 2 (2% buffer).`);
        const buf2Price = params.transactionType === 'SELL'
            ? Math.floor(params.slPrice * 0.98 * 20) / 20
            : Math.ceil(params.slPrice * 1.02 * 20) / 20;
        try {
            await (0, dhan_adapter_1.modifyOrder)(orderId, {
                orderType: 'LIMIT',
                price: buf2Price,
                quantity: params.quantity,
                exchangeSegment: params.exchangeSegment
            });
        }
        catch (modErr) {
            const circuit = parseCircuitLimits(modErr.message || '');
            if (circuit) {
                const clampedPrice = clampToCircuit(buf2Price, circuit, params.transactionType);
                logger_1.default.warn(`Smart Exit Step 2: Circuit limit [${circuit.lower}–${circuit.upper}]. Modifying to ${clampedPrice}`);
                await (0, dhan_adapter_1.modifyOrder)(orderId, {
                    orderType: 'LIMIT',
                    price: clampedPrice,
                    quantity: params.quantity,
                    exchangeSegment: params.exchangeSegment
                });
            }
            else {
                throw modErr;
            }
        }
        // Wait 3 seconds for Step 2
        await new Promise(resolve => setTimeout(resolve, 3000));
        statusResp = await (0, dhan_adapter_1.getOrderStatus)(orderId);
        status = statusResp?.orderStatus || statusResp?.data?.orderStatus;
        if (status === 'TRADED') {
            logger_1.default.info(`Smart Exit: Order ${orderId} filled at Step 2.`);
            return;
        }
        // Step 3: Market Dump
        logger_1.default.info(`Smart Exit: Order ${orderId} STILL pending. Executing Step 3 (Market Dump).`);
        await (0, dhan_adapter_1.modifyOrder)(orderId, {
            orderType: 'MARKET',
            quantity: params.quantity,
            exchangeSegment: params.exchangeSegment
        });
        logger_1.default.info(`Smart Exit completed for ${orderId} (Dumped to market).`);
    }
    catch (error) {
        logger_1.default.error(`Error in Smart Exit Chaser for order ${orderId}:`, error.message);
    }
}
