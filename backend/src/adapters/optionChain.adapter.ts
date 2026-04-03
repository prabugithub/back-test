/**
 * Option Chain Adapter — routes to mock or real ATM resolution based on DHAN_SIMULATION env var.
 * In simulation mode bypasses the real Dhan option chain HTTP calls entirely.
 */
import type * as RealOptionChain from '../services/optionChain.service';

const IS_SIM = process.env.DHAN_SIMULATION === 'true';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const impl: typeof RealOptionChain = IS_SIM
    ? require('../simulation/mockSymbolMaster')
    : require('../services/optionChain.service');

export const getATMOptionForOrder = impl.getATMOptionForOrder;
