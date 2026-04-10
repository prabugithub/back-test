"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.retryApiCall = exports.getDhanClient = exports.initDhanClient = exports.getPositions = exports.modifyOrder = exports.getOrderStatus = exports.placeOrder = void 0;
const IS_SIM = process.env.DHAN_SIMULATION === 'true';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const impl = IS_SIM
    ? require('../simulation/mockDhan.service')
    : require('../services/dhan.service');
exports.placeOrder = impl.placeOrder;
exports.getOrderStatus = impl.getOrderStatus;
exports.modifyOrder = impl.modifyOrder;
exports.getPositions = impl.getPositions;
exports.initDhanClient = impl.initDhanClient;
exports.getDhanClient = impl.getDhanClient;
exports.retryApiCall = impl.retryApiCall;
