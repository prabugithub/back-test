"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const backtest_options_service_1 = require("../services/backtest.options.service");
const symbolMaster_service_1 = require("../services/symbolMaster.service");
const logger_1 = __importDefault(require("../utils/logger"));
const router = (0, express_1.Router)();
router.post('/backtest', async (req, res) => {
    try {
        const { spotTrades, offsetSell, offsetBuy, instrument } = req.body;
        if (!spotTrades || !Array.isArray(spotTrades)) {
            return res.status(400).json({ error: 'Missing or invalid spotTrades' });
        }
        const result = await (0, backtest_options_service_1.backtestOptions)({
            spotTrades,
            offsetSell: offsetSell || 2,
            offsetBuy: offsetBuy || 4,
            instrument: instrument || 'NIFTY'
        });
        res.json(result);
    }
    catch (error) {
        logger_1.default.error('Option backtesting failed:', error);
        res.status(500).json({
            error: 'Failed to run option backtest',
            message: error.message
        });
    }
});
// GET /api/options/lot-size?instrument=NIFTY
router.get('/lot-size', (req, res) => {
    try {
        const instrument = req.query.instrument?.toUpperCase();
        if (instrument !== 'NIFTY' && instrument !== 'BANKNIFTY') {
            return res.status(400).json({ error: 'instrument must be NIFTY or BANKNIFTY' });
        }
        const lotSize = (0, symbolMaster_service_1.getLotSizeForInstrument)(instrument);
        res.json({ instrument, lotSize });
    }
    catch (error) {
        logger_1.default.error('Lot size lookup failed:', error);
        res.status(500).json({ error: error.message });
    }
});
// POST /api/options/naked-backtest
router.post('/naked-backtest', async (req, res) => {
    try {
        const { spotTrades, instrument, expiryFlag, strikeMode, exitMode, rrValues, riskPerTrade, niftyCandles } = req.body;
        if (!spotTrades || !Array.isArray(spotTrades)) {
            return res.status(400).json({ error: 'Missing or invalid spotTrades' });
        }
        if (!['NIFTY', 'BANKNIFTY'].includes(instrument)) {
            return res.status(400).json({ error: 'instrument must be NIFTY or BANKNIFTY' });
        }
        if (!['WEEK', 'MONTH'].includes(expiryFlag)) {
            return res.status(400).json({ error: 'expiryFlag must be WEEK or MONTH' });
        }
        if (!['ATM', 'OTM1', 'OTM2', 'ITM1', 'ITM2'].includes(strikeMode)) {
            return res.status(400).json({ error: 'Invalid strikeMode' });
        }
        if (!['actual', 'rr'].includes(exitMode)) {
            return res.status(400).json({ error: 'exitMode must be actual or rr' });
        }
        if (exitMode === 'rr' && (!Array.isArray(rrValues) || rrValues.length === 0)) {
            return res.status(400).json({ error: 'rrValues required for RR exit mode' });
        }
        const result = await (0, backtest_options_service_1.nakedBuyBacktest)({
            spotTrades,
            instrument: instrument,
            expiryFlag: expiryFlag,
            strikeMode: strikeMode,
            exitMode: exitMode,
            rrValues: rrValues ?? [],
            riskPerTrade: riskPerTrade ?? 10000,
            niftyCandles: niftyCandles ?? []
        });
        res.json(result);
    }
    catch (error) {
        logger_1.default.error('Naked buy backtest failed:', error);
        res.status(500).json({ error: 'Failed to run naked buy backtest', message: error.message });
    }
});
exports.default = router;
