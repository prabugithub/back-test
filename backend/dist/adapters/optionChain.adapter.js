"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getATMOptionForOrder = void 0;
const IS_SIM = process.env.DHAN_SIMULATION === 'true';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const impl = IS_SIM
    ? require('../simulation/mockSymbolMaster')
    : require('../services/optionChain.service');
exports.getATMOptionForOrder = impl.getATMOptionForOrder;
