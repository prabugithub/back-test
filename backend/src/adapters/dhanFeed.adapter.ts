/**
 * Dhan Feed Adapter — routes to mock or real market feed based on DHAN_SIMULATION env var.
 * Import from this file instead of dhanMarketFeed.service.ts in files that need sim/real switching.
 */
import type * as RealFeed from '../services/dhanMarketFeed.service';

const IS_SIM = process.env.DHAN_SIMULATION === 'true';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const impl: typeof RealFeed = IS_SIM
    ? require('../simulation/mockMarketFeed')
    : require('../services/dhanMarketFeed.service');

export const setInternalTickCallback    = impl.setInternalTickCallback;
export const initDhanMarketFeed         = impl.initDhanMarketFeed;
export const subscribeToInstrument      = impl.subscribeToInstrument;
export const unsubscribeFromInstrument  = impl.unsubscribeFromInstrument;
export const handleSocketSubscription   = impl.handleSocketSubscription;
export const getFeedStatus              = impl.getFeedStatus;
export const emitTestTick               = impl.emitTestTick;
