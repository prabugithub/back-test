"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.emitTestTick = exports.getFeedStatus = exports.handleSocketSubscription = exports.unsubscribeFromInstrument = exports.subscribeToInstrument = exports.initDhanMarketFeed = exports.setInternalTickCallback = void 0;
const IS_SIM = process.env.DHAN_SIMULATION === 'true';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const impl = IS_SIM
    ? require('../simulation/mockMarketFeed')
    : require('../services/dhanMarketFeed.service');
exports.setInternalTickCallback = impl.setInternalTickCallback;
exports.initDhanMarketFeed = impl.initDhanMarketFeed;
exports.subscribeToInstrument = impl.subscribeToInstrument;
exports.unsubscribeFromInstrument = impl.unsubscribeFromInstrument;
exports.handleSocketSubscription = impl.handleSocketSubscription;
exports.getFeedStatus = impl.getFeedStatus;
exports.emitTestTick = impl.emitTestTick;
