// @live-only — this file must never be imported by backtest-only code.
// All Dhan broker API calls, ATM option resolution, smart exit logic,
// backend position monitor registration, and order fill polling live here.
// sessionStore.ts dispatches to these functions only when isLiveMode === true.

import {
  placeLiveOrder,
  getATMOption,
  getOptionLTP,
  executeSmartExit,
  registerPositionMonitor,
  unregisterPositionMonitor,
  updatePositionMonitor,
  getOrderStatus,
} from './api';
import type { SessionConfig } from '../stores/sessionStore';
import type { Position } from '../types';

type Notify = (msg: string, type: 'info' | 'warning' | 'error' | 'success') => void;

export interface LiveOrderInput {
  type: 'BUY' | 'SELL';
  quantity: number;
  exitReason?: 'SL' | 'TP' | 'MANUAL' | 'TIME_OVER';
  currentPrice: number;
  instrument: string;
  sessionConfig: SessionConfig;
  position: Position | null;
}

export interface LiveOrderOutput {
  atmOptionToken?: string;
  tradeOptionType?: 'CE' | 'PE';
  finalQuantity: number;
  pendingOrderId?: string;
}

/**
 * Places a live option order via the Dhan API.
 * Handles ATM resolution, lot size, smart exit (SL), and regular LIMIT/MARKET orders.
 * Returns null when the action is intentionally blocked (guard hit or order failed).
 * Throws on unexpected errors.
 */
export async function executeLiveOrder(
  { type, quantity, exitReason, currentPrice, instrument, sessionConfig, position }: LiveOrderInput,
  notify: Notify
): Promise<LiveOrderOutput | null> {
  let liveSecurityId = sessionConfig.securityId;
  let liveExchange = sessionConfig.exchangeSegment;
  let liveTransactionType = type;
  let limitPrice: number | undefined = undefined;
  let atmOptionToken: string | undefined = undefined;
  let tradeOptionType: 'CE' | 'PE' | undefined = undefined;
  let finalQuantity = quantity;

  const currentQty = position ? position.quantity : 0;
  const tradeSign = type === 'BUY' ? 1 : -1;
  const isReducing = (currentQty > 0 && tradeSign < 0) || (currentQty < 0 && tradeSign > 0);
  const isSameDirection = (currentQty > 0 && tradeSign > 0) || (currentQty < 0 && tradeSign < 0);

  const isNiftyIndex =
    (typeof instrument === 'string' && instrument.toUpperCase().includes('NIFTY')) ||
    String(sessionConfig.securityId) === '13';
  const isBankNiftyIndex =
    (typeof instrument === 'string' && instrument.toUpperCase().includes('BANKNIFTY')) ||
    String(sessionConfig.securityId) === '25';

  if (isNiftyIndex || isBankNiftyIndex) {
    // Guard: block adding to an already-open option position
    if (position && position.liveOptionToken && isSameDirection) {
      notify(
        `Already in an open option position (${position.instrument}). Close it before opening a new one.`,
        'warning'
      );
      return null;
    }

    if (position && position.liveOptionToken) {
      // CLOSING / REDUCING: exit the exact option we hold
      liveSecurityId = position.liveOptionToken;
      liveExchange = 'NSE_FNO';
      liveTransactionType = isReducing ? 'SELL' : 'BUY';
      finalQuantity = position.filledQty ?? Math.abs(position.quantity);
      tradeOptionType = position.quantity > 0 ? 'CE' : 'PE';

      // For SL exits: anchor the 3-step smart exit chaser to the option's current LTP
      if (exitReason === 'SL') {
        limitPrice = await getOptionLTP(String(liveSecurityId)) ?? undefined;
      }

      // Unregister backend monitor BEFORE placing exit to prevent a race where both
      // frontend and backend fire a SELL on the same position.
      await unregisterPositionMonitor(position.liveOptionToken).catch((e) =>
        console.warn('[Monitor] Pre-exit unregister failed:', e)
      );
    } else {
      // OPENING: resolve ATM weekly option and its current LTP
      const optType = type === 'BUY' ? 'CE' : 'PE';
      tradeOptionType = optType;
      const instName = isBankNiftyIndex ? 'BANKNIFTY' : 'NIFTY';
      const optData = await getATMOption(currentPrice, optType, instName);

      if (optData && optData.success && optData.data) {
        liveSecurityId = optData.data.securityId;
        liveExchange = 'NSE_FNO';
        liveTransactionType = 'BUY';
        atmOptionToken = liveSecurityId;
        limitPrice = optData.data.ltp || undefined;

        if (optData.data.lotSize) {
          const lotSize = optData.data.lotSize;
          const lots = Math.round(quantity / lotSize);
          if (lots === 0) {
            notify(
              `Cannot place order: calculated quantity (${quantity}) is less than half a lot (lot size: ${lotSize}). Increase risk amount or reduce SL distance.`,
              'error'
            );
            return null;
          }
          finalQuantity = lots * lotSize;
        }

        notify(
          `ATM Option: ${optData.data.tradingSymbol} | Qty: ${finalQuantity} (${Math.round(finalQuantity / (optData.data.lotSize || 1))} lots)`,
          'info'
        );
      } else {
        throw new Error('Could not find ATM Option token. Symbol Master may not be ready.');
      }
    }
  }

  const orderTypeToUse: 'LIMIT' | 'MARKET' = limitPrice ? 'LIMIT' : 'MARKET';
  if (!limitPrice && exitReason !== 'SL') {
    console.warn('LTP not available for option, falling back to MARKET order');
    notify('LTP unavailable: Placing MARKET order instead of LIMIT', 'warning');
  }

  // Fail-safe: never send an index token directly to Dhan API
  if (
    liveExchange === 'IDX_I' ||
    String(liveSecurityId) === '13' ||
    String(liveSecurityId) === '25'
  ) {
    throw new Error(
      `Invalid live order: Attempted to trade Index ${liveSecurityId} directly. Ensure Symbol Master is resolving ATM options.`
    );
  }

  let orderResult;

  if (exitReason === 'SL' && position && position.liveOptionToken) {
    if (limitPrice) {
      // Use the option's current LTP as the Smart Exit anchor price.
      // position.stopLoss is the SPOT level, not the option premium.
      orderResult = await executeSmartExit({
        securityId: String(liveSecurityId),
        exchangeSegment: liveExchange,
        transactionType: liveTransactionType,
        quantity: finalQuantity,
        slPrice: limitPrice,
      });
    } else {
      notify('No option LTP available for Smart Exit; placing MARKET order directly.', 'warning');
      orderResult = await placeLiveOrder({
        securityId: String(liveSecurityId),
        exchangeSegment: liveExchange,
        transactionType: liveTransactionType,
        quantity: finalQuantity,
        price: 0,
        orderType: 'MARKET',
        productType: 'INTRADAY',
      });
    }
  } else {
    orderResult = await placeLiveOrder({
      securityId: String(liveSecurityId),
      exchangeSegment: liveExchange,
      transactionType: liveTransactionType,
      quantity: finalQuantity,
      price: orderTypeToUse === 'LIMIT' ? limitPrice : 0,
      orderType: orderTypeToUse,
      productType: 'INTRADAY',
    });
  }

  if (orderResult && orderResult.success) {
    const placedOrderId: string | undefined = orderResult.data?.orderId || orderResult.orderId;
    const logMsg = exitReason === 'SL' ? 'Smart Exit Launched' : 'Live Order Placed';
    notify(
      `${logMsg}: ${liveTransactionType} ${finalQuantity} @ ₹${limitPrice?.toFixed(2) || 'auto'} (ID: ${placedOrderId || 'N/A'})`,
      'info'
    );
    return { atmOptionToken, tradeOptionType, finalQuantity, pendingOrderId: placedOrderId };
  }

  notify(`Live Order Failed: ${orderResult?.message || 'Unknown error'}`, 'error');
  return null;
}

/**
 * Registers a live option position with the backend position monitor so SL/TP
 * fires even if the browser is closed. No-op if position has no liveOptionToken.
 */
export function registerMonitorIfNeeded(position: Position, sessionConfig: SessionConfig): void {
  if (!position.liveOptionToken) return;
  const isLong = position.quantity > 0;
  registerPositionMonitor({
    id: position.liveOptionToken,
    spotToken: String(sessionConfig.securityId),
    spotSegment: sessionConfig.exchangeSegment || 'IDX_I',
    direction: isLong ? 'LONG' : 'SHORT',
    stopLoss: position.stopLoss ?? 0,
    target: position.target ?? 0,
    optionSecurityId: position.liveOptionToken,
    optionExchangeSegment: 'NSE_FNO',
    quantity: Math.abs(position.quantity),
    entryPrice: position.averagePrice,
    productType: 'INTRADAY',
  }).catch((e) => console.warn('[Monitor] Register failed:', e));
}

/**
 * Syncs a new TP target to the backend position monitor.
 */
export async function syncTargetWithMonitor(token: string, target: number): Promise<void> {
  await updatePositionMonitor(token, { target }).catch((e) =>
    console.warn('[Monitor] Update target failed:', e)
  );
}

export interface PollCallbacks {
  getPosition: () => Position | null;
  isLiveMode: () => boolean;
  onRejected: (optionToken: string | undefined) => void;
  onPartialFill: (filled: number, optionToken: string | undefined) => void;
  onFilled: (filled: number) => void;
  notify: Notify;
}

/**
 * Polls order fill status ~2 s after placement and calls the appropriate callback.
 * State updates (set) are handled by the caller via callbacks so this file stays
 * free of direct store imports.
 */
export function pollOrderFillStatus(orderId: string, callbacks: PollCallbacks): void {
  const { getPosition, isLiveMode, onRejected, onPartialFill, onFilled, notify } = callbacks;
  setTimeout(async () => {
    try {
      const resp = await getOrderStatus(orderId);
      const order = resp?.data;
      if (!order) return;

      const status: string = order.orderStatus || '';
      const filled: number = order.tradedQuantity ?? order.filledQty ?? 0;

      if (status === 'REJECTED' || status === 'CANCELLED') {
        notify(
          `Order ${status}: ${order.rejectedReason || 'Unknown reason'}. Clearing position.`,
          'error'
        );
        const rejectedToken = getPosition()?.liveOptionToken;
        onRejected(rejectedToken);
        // Unregister backend monitor for the phantom position
        if (rejectedToken && isLiveMode()) {
          unregisterPositionMonitor(rejectedToken).catch(() => {});
        }
      } else if (status === 'PENDING' || status === 'TRANSIT') {
        // Order still in-flight — leave pendingOrderId intact so exit guards remain active.
        // syncLivePositions will detect the fill when it appears on the broker and sync state.
        notify('Order still pending at broker. Waiting for fill confirmation.', 'info');
      } else if (status === 'PARTIALLY_TRADED') {
        notify(
          `Order PARTIAL FILL: ${filled} filled, ${order.remainingQuantity ?? 0} pending.`,
          'warning'
        );
        const token = getPosition()?.liveOptionToken;
        onPartialFill(filled, token);
        if (token && isLiveMode() && filled > 0) {
          updatePositionMonitor(token, { quantity: filled }).catch(() => {});
        }
      } else {
        // TRADED or any unrecognised confirmed status
        onFilled(filled);
      }
    } catch (e) {
      console.warn('Order status poll failed:', e);
    }
  }, 2000);
}
