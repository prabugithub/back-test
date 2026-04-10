"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const data_service_1 = require("../services/data.service");
const logger_1 = __importDefault(require("../utils/logger"));
const router = (0, express_1.Router)();
/**
 * GET /api/data/candles
 * Fetch candles with caching
 */
router.get('/candles', async (req, res) => {
    try {
        const { securityId, exchangeSegment, instrument, interval, fromDate, toDate, } = req.query;
        // Validate required parameters
        if (!securityId || !exchangeSegment || !instrument || !interval || !fromDate || !toDate) {
            return res.status(400).json({
                error: 'Missing required parameters',
                required: ['securityId', 'exchangeSegment', 'instrument', 'interval', 'fromDate', 'toDate'],
            });
        }
        const params = {
            securityId: securityId,
            exchangeSegment: exchangeSegment,
            instrument: instrument,
            interval: interval,
            fromDate: fromDate,
            toDate: toDate,
        };
        logger_1.default.info('Fetching candles', params);
        const candles = await (0, data_service_1.getCandles)(params);
        res.json({
            success: true,
            data: candles,
            count: candles.length,
            cached: (0, data_service_1.isCached)(params),
        });
    }
    catch (error) {
        logger_1.default.error('Error fetching candles:', error.message);
        res.status(500).json({
            error: 'Failed to fetch candles',
            message: error.message,
        });
    }
});
/**
 * DELETE /api/data/cache
 * Clear cache
 */
router.delete('/cache', (req, res) => {
    try {
        const { securityId, exchangeSegment, interval } = req.query;
        if (securityId || exchangeSegment || interval) {
            (0, data_service_1.clearCache)({
                securityId: securityId,
                exchangeSegment: exchangeSegment,
                interval: interval,
            });
        }
        else {
            (0, data_service_1.clearCache)();
        }
        res.json({
            success: true,
            message: 'Cache cleared successfully',
        });
    }
    catch (error) {
        logger_1.default.error('Error clearing cache:', error.message);
        res.status(500).json({
            error: 'Failed to clear cache',
            message: error.message,
        });
    }
});
/**
 * GET /api/data/health
 * Health check endpoint
 */
router.get('/health', (req, res) => {
    res.json({
        success: true,
        message: 'Data service is healthy',
        timestamp: new Date().toISOString(),
    });
});
exports.default = router;
