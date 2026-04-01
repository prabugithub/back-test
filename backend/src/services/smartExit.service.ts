import { placeOrder, getOrderStatus, modifyOrder } from './dhan.service';
import logger from '../utils/logger';

interface SmartExitParams {
    securityId: string;
    exchangeSegment: string;
    transactionType: 'BUY' | 'SELL';
    quantity: number;
    slPrice: number;
}

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
        logger.error("Smart Exit Step 1 failed, trying MARKET order fallback immediately.", err.message);
        // Fallback to market directly if initial limit fails
        const fallback = await placeOrder({
            securityId: params.securityId,
            exchangeSegment: params.exchangeSegment,
            transactionType: params.transactionType,
            quantity: params.quantity,
            orderType: 'MARKET',
            productType: 'INTRADAY'
        });
        return { success: true, message: "Exited at Market (Fallback)", orderId: fallback?.orderId };
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

        await modifyOrder(orderId, {
            orderType: 'LIMIT',
            price: buf2Price,
            quantity: params.quantity,
            exchangeSegment: params.exchangeSegment
        });

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
