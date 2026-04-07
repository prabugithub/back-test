import { placeOrder, getOrderStatus, modifyOrder } from '../adapters/dhan.adapter';
import logger from '../utils/logger';

interface SmartExitParams {
    securityId: string;
    exchangeSegment: string;
    transactionType: 'BUY' | 'SELL';
    quantity: number;
    slPrice: number;
}

/** Parse "Rate Not Within Ckt Limit 0.05 To 525.80" → { lower: 0.05, upper: 525.80 } */
function parseCircuitLimits(errorMsg: string): { lower: number; upper: number } | null {
    const match = errorMsg.match(/Ckt Limit\s+([\d.]+)\s+To\s+([\d.]+)/i);
    if (!match) return null;
    return { lower: parseFloat(match[1]), upper: parseFloat(match[2]) };
}

/** Clamp an order price to within the circuit limit range. */
function clampToCircuit(price: number, circuit: { lower: number; upper: number }, transactionType: 'BUY' | 'SELL'): number {
    if (transactionType === 'SELL') return Math.max(price, circuit.lower);
    return Math.min(price, circuit.upper);
}

const MARKET_ORDER_BASE = { orderType: 'MARKET' as const, productType: 'INTRADAY' as const };

export async function executeSmartExit(params: SmartExitParams): Promise<{ success: boolean; message: string; orderId?: string }> {
    logger.info(`Starting Smart Exit Chaser for ${params.securityId} SL Level: ${params.slPrice}`);

    // Step 1: Initial Anchor (0.5% Buffer limit)
    const buf1Price = params.transactionType === 'SELL'
        ? Math.floor(params.slPrice * 0.995 * 20) / 20
        : Math.ceil(params.slPrice * 1.005 * 20) / 20;

    let currentOrderId: string | undefined = undefined;

    try {
        const initialOrder = await placeOrder({
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
        logger.info(`Smart Exit Step 1: Placed Anchor Limit @ ${buf1Price}. Order ID: ${currentOrderId}`);

    } catch (err: any) {
        const circuit = parseCircuitLimits(err.message || '');
        if (circuit) {
            // Price landed outside circuit — clamp and retry as LIMIT within valid range
            const clampedPrice = clampToCircuit(buf1Price, circuit, params.transactionType);
            logger.warn(`Smart Exit Step 1: Circuit limit [${circuit.lower}–${circuit.upper}]. Retrying LIMIT @ ${clampedPrice}`);
            try {
                const retryOrder = await placeOrder({
                    securityId: params.securityId,
                    exchangeSegment: params.exchangeSegment,
                    transactionType: params.transactionType,
                    quantity: params.quantity,
                    price: clampedPrice,
                    orderType: 'LIMIT',
                    productType: 'INTRADAY'
                });
                currentOrderId = retryOrder?.orderId || retryOrder?.data?.orderId;
                if (!currentOrderId) throw new Error("No orderId from circuit-clamped retry");
                logger.info(`Smart Exit Step 1 (circuit-clamped): Placed @ ${clampedPrice}. Order ID: ${currentOrderId}`);
            } catch (retryErr: any) {
                logger.error("Smart Exit Step 1 circuit retry failed, trying MARKET fallback.", retryErr.message);
                const fallback = await placeOrder({
                    securityId: params.securityId,
                    exchangeSegment: params.exchangeSegment,
                    transactionType: params.transactionType,
                    quantity: params.quantity,
                    ...MARKET_ORDER_BASE
                });
                return { success: true, message: "Exited at Market (Circuit Fallback)", orderId: fallback?.orderId };
            }
        } else {
            logger.error("Smart Exit Step 1 failed, trying MARKET order fallback immediately.", err.message);
            const fallback = await placeOrder({
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
    chaseOrderLoop(currentOrderId, params);

    return { success: true, message: "Smart Exit loop started", orderId: currentOrderId };
}

async function chaseOrderLoop(orderId: string, params: SmartExitParams) {
    try {
        // Wait 2 seconds for Step 1
        await new Promise(resolve => setTimeout(resolve, 2000));

        let statusResp = await getOrderStatus(orderId);
        let status = statusResp?.orderStatus || statusResp?.data?.orderStatus;

        if (status === 'TRADED') {
            logger.info(`Smart Exit: Order ${orderId} filled at Step 1.`);
            return;
        }

        // Step 2: Deeper Chasing (2% buffer)
        logger.info(`Smart Exit: Order ${orderId} status ${status}. Moving to Step 2 (2% buffer).`);
        const buf2Price = params.transactionType === 'SELL'
            ? Math.floor(params.slPrice * 0.98 * 20) / 20
            : Math.ceil(params.slPrice * 1.02 * 20) / 20;

        try {
            await modifyOrder(orderId, {
                orderType: 'LIMIT',
                price: buf2Price,
                quantity: params.quantity,
                exchangeSegment: params.exchangeSegment
            });
        } catch (modErr: any) {
            const circuit = parseCircuitLimits(modErr.message || '');
            if (circuit) {
                const clampedPrice = clampToCircuit(buf2Price, circuit, params.transactionType);
                logger.warn(`Smart Exit Step 2: Circuit limit [${circuit.lower}–${circuit.upper}]. Modifying to ${clampedPrice}`);
                await modifyOrder(orderId, {
                    orderType: 'LIMIT',
                    price: clampedPrice,
                    quantity: params.quantity,
                    exchangeSegment: params.exchangeSegment
                });
            } else {
                throw modErr;
            }
        }

        // Wait 3 seconds for Step 2
        await new Promise(resolve => setTimeout(resolve, 3000));

        statusResp = await getOrderStatus(orderId);
        status = statusResp?.orderStatus || statusResp?.data?.orderStatus;

        if (status === 'TRADED') {
            logger.info(`Smart Exit: Order ${orderId} filled at Step 2.`);
            return;
        }

        // Step 3: Market Dump
        logger.info(`Smart Exit: Order ${orderId} STILL pending. Executing Step 3 (Market Dump).`);
        await modifyOrder(orderId, {
            orderType: 'MARKET',
            quantity: params.quantity,
            exchangeSegment: params.exchangeSegment
        });

        logger.info(`Smart Exit completed for ${orderId} (Dumped to market).`);

    } catch (error: any) {
        logger.error(`Error in Smart Exit Chaser for order ${orderId}:`, error.message);
    }
}
