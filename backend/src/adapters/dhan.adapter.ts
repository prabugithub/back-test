/**
 * Dhan Adapter — routes to mock or real implementation based on DHAN_SIMULATION env var.
 * Import from this file instead of dhan.service.ts in files that need sim/real switching.
 */
import type * as RealDhan from '../services/dhan.service';

const IS_SIM = process.env.DHAN_SIMULATION === 'true';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const impl: typeof RealDhan = IS_SIM
    ? require('../simulation/mockDhan.service')
    : require('../services/dhan.service');

export const placeOrder      = impl.placeOrder;
export const getOrderStatus  = impl.getOrderStatus;
export const modifyOrder     = impl.modifyOrder;
export const getPositions    = impl.getPositions;
export const initDhanClient  = impl.initDhanClient;
export const getDhanClient   = impl.getDhanClient;
export const retryApiCall    = impl.retryApiCall;
