"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.backtestOptions = backtestOptions;
exports.nakedBuyBacktest = nakedBuyBacktest;
const dhan_service_1 = require("./dhan.service");
const symbolMaster_service_1 = require("./symbolMaster.service");
const logger_1 = __importDefault(require("../utils/logger"));
const date_fns_1 = require("date-fns");
const INSTRUMENT_CONFIG = {
    NIFTY: { securityId: '13' },
    BANKNIFTY: { securityId: '25' },
};
/**
 * Handle option backtesting logic by mapping spot trades to option spreads
 */
async function backtestOptions(params) {
    const results = [];
    let totalRealizedPnL = 0;
    let spotTotalPnL = 0;
    let winningTrades = 0;
    logger_1.default.info(`Starting option backtesting for ${params.spotTrades.length} trades`);
    const securityId = (INSTRUMENT_CONFIG[params.instrument] ?? INSTRUMENT_CONFIG['NIFTY']).securityId;
    for (const spotTrade of params.spotTrades) {
        try {
            const entryDate = new Date(spotTrade.entryTime);
            const exitDate = spotTrade.exitTime ? new Date(spotTrade.exitTime) : new Date();
            // Format dates for Dhan API (YYYY-MM-DD)
            const fromDateStr = (0, date_fns_1.format)(entryDate, 'yyyy-MM-dd');
            const toDateStr = (0, date_fns_1.format)(exitDate, 'yyyy-MM-dd');
            // Determine Option Type and Strikes
            const isBullish = spotTrade.direction === 'LONG';
            const optionType = isBullish ? 'PUT' : 'CALL';
            // For Bullish (Spot Long), we Sell Put OTM (ATM-offset) and Buy Put further OTM (ATM-offset-buy)
            // For Bearish (Spot Short), we Sell Call OTM (ATM+offset) and Buy Call further OTM (ATM+offset+buy)
            const sellStrikeStr = isBullish ? `ATM-${params.offsetSell}` : `ATM+${params.offsetSell}`;
            const buyStrikeStr = isBullish ? `ATM-${params.offsetBuy}` : `ATM+${params.offsetBuy}`;
            const [leg1Data, leg2Data] = await Promise.all([
                (0, dhan_service_1.fetchRollingOptionData)({
                    securityId,
                    exchangeSegment: 'NSE_FNO',
                    instrument: 'OPTIDX',
                    expiryFlag: 'MONTH',
                    strike: sellStrikeStr,
                    optionType,
                    fromDate: fromDateStr,
                    toDate: toDateStr,
                    interval: '5'
                }),
                (0, dhan_service_1.fetchRollingOptionData)({
                    securityId,
                    exchangeSegment: 'NSE_FNO',
                    instrument: 'OPTIDX',
                    expiryFlag: 'MONTH',
                    strike: buyStrikeStr,
                    optionType,
                    fromDate: fromDateStr,
                    toDate: toDateStr,
                    interval: '5'
                })
            ]);
            if (leg1Data.length === 0 || leg2Data.length === 0) {
                logger_1.default.warn(`No option data found for trade ${spotTrade.id} at ${fromDateStr}`);
                results.push({ ...spotTrade, optionResults: null, error: 'No data' });
                continue;
            }
            // Find entry and exit prices for both legs
            // Match entryTime and exitTime as closely as possible
            const entryTs = Math.floor(spotTrade.entryTime / 1000);
            const exitTs = Math.floor(spotTrade.exitTime / 1000);
            const findClosest = (data, ts) => {
                let closest = data[0];
                let minDiff = Math.abs(data[0].timestamp - ts);
                for (const c of data) {
                    const diff = Math.abs(c.timestamp - ts);
                    if (diff < minDiff) {
                        minDiff = diff;
                        closest = c;
                    }
                }
                return closest;
            };
            const l1Entry = findClosest(leg1Data, entryTs);
            const l1Exit = findClosest(leg1Data, exitTs);
            const l2Entry = findClosest(leg2Data, entryTs);
            const l2Exit = findClosest(leg2Data, exitTs);
            // Calculation (Credit Spread)
            // Sell Leg (L1): Entry - Exit (Positive if option price drops)
            // Buy Leg (L2): Exit - Entry (Negative if option price drops)
            // Combined PnL (per share) = (L1.entry - L1.exit) + (L2.exit - L2.entry)
            const l1PnL = l1Entry.close - l1Exit.close;
            const l2PnL = l2Exit.close - l2Entry.close;
            const spreadPnL = l1PnL + l2PnL;
            const totalPnLForQty = spreadPnL * spotTrade.totalQuantity;
            totalRealizedPnL += totalPnLForQty;
            spotTotalPnL += spotTrade.realizedPnL;
            if (totalPnLForQty > 0)
                winningTrades++;
            results.push({
                ...spotTrade,
                optionResults: {
                    sellStrike: sellStrikeStr,
                    buyStrike: buyStrikeStr,
                    optionType,
                    l1Entry: l1Entry.close,
                    l1Exit: l1Exit.close,
                    l2Entry: l2Entry.close,
                    l2Exit: l2Exit.close,
                    spreadPnLPerShare: spreadPnL,
                    totalPnL: totalPnLForQty
                }
            });
        }
        catch (error) {
            logger_1.default.error(`Failed to backtest option for trade ${spotTrade.id}:`, error.message);
            results.push({ ...spotTrade, optionResults: null, error: error.message });
        }
    }
    return {
        trades: results,
        summary: {
            totalRealizedPnL,
            spotTotalPnL,
            winRate: results.length > 0 ? (winningTrades / results.length) * 100 : 0,
            totalTrades: results.length
        }
    };
}
/**
 * Strike string for Dhan rollingoption API.
 * CE (calls): OTM = higher strike → ATM+N; ITM = lower strike → ATM-N
 * PE (puts):  OTM = lower strike  → ATM-N; ITM = higher strike → ATM+N
 */
function getStrikeString(strikeMode, optionType) {
    const isCall = optionType === 'CALL';
    switch (strikeMode) {
        case 'ATM': return 'ATM';
        case 'OTM1': return isCall ? 'ATM+1' : 'ATM-1';
        case 'OTM2': return isCall ? 'ATM+2' : 'ATM-2';
        case 'ITM1': return isCall ? 'ATM-1' : 'ATM+1';
        case 'ITM2': return isCall ? 'ATM-2' : 'ATM+2';
    }
}
function findClosestCandle(candles, targetTs) {
    if (candles.length === 0)
        return null;
    let closest = candles[0];
    let minDiff = Math.abs(candles[0].timestamp - targetTs);
    for (const c of candles) {
        const diff = Math.abs(c.timestamp - targetTs);
        if (diff < minDiff) {
            minDiff = diff;
            closest = c;
        }
    }
    return closest;
}
/**
 * Walk 5-min Nifty candles from entryTs to find when SL or TP was hit.
 * Returns { exitTs, exitReason }.
 */
function findRRExitOnUnderlying(niftyCandles, entryTs, // Unix seconds
direction, slPrice, tpPrice) {
    // IST 15:20 = UTC 09:50 → offset from day start depends on the trade date
    // We find the last candle timestamp ≤ 15:20 IST as EOD
    const IST_OFFSET_S = 5.5 * 3600;
    // Filter candles that start at or after the entry
    const tradingCandles = niftyCandles.filter(c => c.timestamp >= entryTs);
    for (const candle of tradingCandles) {
        // Check 15:20 IST cutoff (09:50 UTC)
        const candleIST = new Date((candle.timestamp + IST_OFFSET_S) * 1000);
        const candleHHMM = candleIST.getUTCHours() * 60 + candleIST.getUTCMinutes();
        if (candleHHMM >= 15 * 60 + 20) {
            return { exitTs: candle.timestamp, exitReason: 'EOD' };
        }
        if (direction === 'LONG') {
            if (candle.low <= slPrice)
                return { exitTs: candle.timestamp, exitReason: 'SL' };
            if (candle.high >= tpPrice)
                return { exitTs: candle.timestamp, exitReason: 'TP' };
        }
        else {
            if (candle.high >= slPrice)
                return { exitTs: candle.timestamp, exitReason: 'SL' };
            if (candle.low <= tpPrice)
                return { exitTs: candle.timestamp, exitReason: 'TP' };
        }
    }
    // Fallback: last available candle = EOD
    const lastCandle = tradingCandles[tradingCandles.length - 1] ?? niftyCandles[niftyCandles.length - 1];
    return { exitTs: lastCandle?.timestamp ?? entryTs, exitReason: 'EOD' };
}
async function nakedBuyBacktest(params) {
    const { spotTrades, instrument, expiryFlag, strikeMode, exitMode, rrValues, riskPerTrade, niftyCandles } = params;
    // Get lot size from symbol master
    let lotSize;
    try {
        lotSize = (0, symbolMaster_service_1.getLotSizeForInstrument)(instrument);
    }
    catch {
        // Symbol master may not be ready in dev/test — use sensible defaults
        lotSize = instrument === 'NIFTY' ? 25 : 15;
        logger_1.default.warn(`Symbol master unavailable — using default lot size ${lotSize} for ${instrument}`);
    }
    const securityId = INSTRUMENT_CONFIG[instrument]?.securityId ?? '13';
    const results = [];
    logger_1.default.info(`Starting naked buy backtest: ${spotTrades.length} trades, ${instrument}, ${strikeMode}, ${exitMode}`);
    for (const trade of spotTrades) {
        const tradeId = trade.id ?? String(Math.random());
        // Only closed trades have a meaningful exit
        if (trade.status === 'OPEN' || !trade.exitTime) {
            results.push({
                id: tradeId, direction: trade.direction, entryTime: trade.entryTime,
                avgEntryPrice: trade.avgEntryPrice, stopLoss: trade.stopLoss,
                spotPnL: trade.realizedPnL ?? 0, spotExitReason: trade.exitReason,
                optionType: trade.direction === 'LONG' ? 'CALL' : 'PUT',
                strikeLabel: '', expiryFlag, entryOptionPrice: 0, lots: 0, actualQty: 0,
                error: 'Trade still open — skipped'
            });
            continue;
        }
        if (!trade.stopLoss || trade.stopLoss === 0) {
            results.push({
                id: tradeId, direction: trade.direction, entryTime: trade.entryTime,
                exitTime: trade.exitTime, avgEntryPrice: trade.avgEntryPrice,
                avgExitPrice: trade.avgExitPrice, stopLoss: trade.stopLoss,
                spotPnL: trade.realizedPnL ?? 0, spotExitReason: trade.exitReason,
                optionType: trade.direction === 'LONG' ? 'CALL' : 'PUT',
                strikeLabel: '', expiryFlag, entryOptionPrice: 0, lots: 0, actualQty: 0,
                error: 'No stop loss set — cannot calculate lot size'
            });
            continue;
        }
        try {
            const optionType = trade.direction === 'LONG' ? 'CALL' : 'PUT';
            const strikeStr = getStrikeString(strikeMode, optionType);
            const dhanOptionType = optionType === 'CALL' ? 'CALL' : 'PUT';
            const entryDate = new Date(trade.entryTime);
            const exitDate = new Date(trade.exitTime);
            // Fetch a small window around the trade — add a few days buffer for data availability
            const fromDateStr = (0, date_fns_1.format)(entryDate, 'yyyy-MM-dd');
            const toDateStr = (0, date_fns_1.format)((0, date_fns_1.addDays)(exitDate, 3), 'yyyy-MM-dd');
            const dhanExpiry = expiryFlag === 'WEEK' ? 'WEEK' : 'MONTH';
            const optionCandles = await (0, dhan_service_1.fetchRollingOptionData)({
                securityId,
                exchangeSegment: 'NSE_FNO',
                instrument: 'OPTIDX',
                expiryFlag: dhanExpiry,
                strike: strikeStr,
                optionType: dhanOptionType,
                fromDate: fromDateStr,
                toDate: toDateStr,
                interval: '5'
            });
            if (optionCandles.length === 0) {
                results.push({
                    id: tradeId, direction: trade.direction, entryTime: trade.entryTime,
                    exitTime: trade.exitTime, avgEntryPrice: trade.avgEntryPrice,
                    avgExitPrice: trade.avgExitPrice, stopLoss: trade.stopLoss,
                    spotPnL: trade.realizedPnL ?? 0, spotExitReason: trade.exitReason,
                    optionType, strikeLabel: strikeStr, expiryFlag, entryOptionPrice: 0,
                    lots: 0, actualQty: 0, error: 'No option data returned from Dhan API'
                });
                continue;
            }
            const entryTs = Math.floor(trade.entryTime / 1000);
            const entryCandle = findClosestCandle(optionCandles, entryTs);
            if (!entryCandle) {
                results.push({
                    id: tradeId, direction: trade.direction, entryTime: trade.entryTime,
                    exitTime: trade.exitTime, avgEntryPrice: trade.avgEntryPrice,
                    avgExitPrice: trade.avgExitPrice, stopLoss: trade.stopLoss,
                    spotPnL: trade.realizedPnL ?? 0, spotExitReason: trade.exitReason,
                    optionType, strikeLabel: strikeStr, expiryFlag, entryOptionPrice: 0,
                    lots: 0, actualQty: 0, error: 'Could not match entry candle'
                });
                continue;
            }
            const entryOptionPrice = entryCandle.close;
            // Lot sizing: based on underlying SL distance, not option premium
            const riskPerUnit = Math.abs(trade.avgEntryPrice - trade.stopLoss);
            const lots = riskPerUnit > 0 ? Math.round(riskPerTrade / riskPerUnit / lotSize) : 0;
            const actualQty = lots * lotSize;
            if (lots === 0) {
                results.push({
                    id: tradeId, direction: trade.direction, entryTime: trade.entryTime,
                    exitTime: trade.exitTime, avgEntryPrice: trade.avgEntryPrice,
                    avgExitPrice: trade.avgExitPrice, stopLoss: trade.stopLoss,
                    spotPnL: trade.realizedPnL ?? 0, spotExitReason: trade.exitReason,
                    optionType, strikeLabel: strikeStr, expiryFlag, entryOptionPrice,
                    lots: 0, actualQty: 0, error: `SL too close (${riskPerUnit.toFixed(1)} pts) — 0 lots`
                });
                continue;
            }
            if (exitMode === 'actual') {
                const exitTs = Math.floor(trade.exitTime / 1000);
                const exitCandle = findClosestCandle(optionCandles, exitTs);
                const exitOptionPrice = exitCandle?.close ?? entryOptionPrice;
                const pnl = (exitOptionPrice - entryOptionPrice) * actualQty;
                results.push({
                    id: tradeId, direction: trade.direction, entryTime: trade.entryTime,
                    exitTime: trade.exitTime, avgEntryPrice: trade.avgEntryPrice,
                    avgExitPrice: trade.avgExitPrice, stopLoss: trade.stopLoss,
                    spotPnL: trade.realizedPnL ?? 0, spotExitReason: trade.exitReason,
                    optionType, strikeLabel: strikeStr, expiryFlag,
                    entryOptionPrice, lots, actualQty, exitOptionPrice, pnl
                });
            }
            else {
                // RR mode — requires niftyCandles from CSV
                if (!niftyCandles || niftyCandles.length === 0) {
                    results.push({
                        id: tradeId, direction: trade.direction, entryTime: trade.entryTime,
                        exitTime: trade.exitTime, avgEntryPrice: trade.avgEntryPrice,
                        stopLoss: trade.stopLoss, spotPnL: trade.realizedPnL ?? 0,
                        optionType, strikeLabel: strikeStr, expiryFlag, entryOptionPrice,
                        lots, actualQty, error: 'Nifty 5-min CSV not provided for RR mode'
                    });
                    continue;
                }
                const rrResults = [];
                for (const rr of rrValues) {
                    const tpUnderlying = trade.direction === 'LONG'
                        ? trade.avgEntryPrice + riskPerUnit * rr
                        : trade.avgEntryPrice - riskPerUnit * rr;
                    const { exitTs, exitReason } = findRRExitOnUnderlying(niftyCandles, entryTs, trade.direction, trade.stopLoss, tpUnderlying);
                    const exitCandle = findClosestCandle(optionCandles, exitTs);
                    const exitOptionPrice = exitCandle?.close ?? entryOptionPrice;
                    const pnl = (exitOptionPrice - entryOptionPrice) * actualQty;
                    rrResults.push({ rr, exitOptionPrice, pnl, exitReason });
                }
                results.push({
                    id: tradeId, direction: trade.direction, entryTime: trade.entryTime,
                    exitTime: trade.exitTime, avgEntryPrice: trade.avgEntryPrice,
                    avgExitPrice: trade.avgExitPrice, stopLoss: trade.stopLoss,
                    spotPnL: trade.realizedPnL ?? 0, spotExitReason: trade.exitReason,
                    optionType, strikeLabel: strikeStr, expiryFlag,
                    entryOptionPrice, lots, actualQty, rrResults
                });
            }
        }
        catch (error) {
            logger_1.default.error(`Naked buy backtest failed for trade ${tradeId}:`, error.message);
            results.push({
                id: tradeId, direction: trade.direction, entryTime: trade.entryTime,
                exitTime: trade.exitTime, avgEntryPrice: trade.avgEntryPrice,
                stopLoss: trade.stopLoss, spotPnL: trade.realizedPnL ?? 0,
                optionType: trade.direction === 'LONG' ? 'CALL' : 'PUT',
                strikeLabel: '', expiryFlag, entryOptionPrice: 0, lots: 0, actualQty: 0,
                error: error.message
            });
        }
    }
    // Build summary
    const validResults = results.filter(r => !r.error);
    const spotTotalPnL = results.reduce((sum, r) => sum + (r.spotPnL ?? 0), 0);
    let summaryExtra = { totalTrades: results.length, spotTotalPnL };
    if (exitMode === 'actual') {
        const totalPnL = validResults.reduce((sum, r) => sum + (r.pnl ?? 0), 0);
        const wins = validResults.filter(r => (r.pnl ?? 0) > 0).length;
        summaryExtra.actualTotalPnL = totalPnL;
        summaryExtra.actualWinRate = validResults.length > 0 ? (wins / validResults.length) * 100 : 0;
    }
    else {
        const rrSummaries = {};
        for (const rr of rrValues) {
            const rrTrades = validResults.filter(r => r.rrResults?.some(x => x.rr === rr));
            const total = rrTrades.reduce((sum, r) => {
                const rRes = r.rrResults.find(x => x.rr === rr);
                return sum + rRes.pnl;
            }, 0);
            const wins = rrTrades.filter(r => (r.rrResults.find(x => x.rr === rr)?.pnl ?? 0) > 0).length;
            const losses = rrTrades.filter(r => (r.rrResults.find(x => x.rr === rr)?.pnl ?? 0) < 0).length;
            rrSummaries[rr] = {
                totalPnL: total,
                winRate: rrTrades.length > 0 ? (wins / rrTrades.length) * 100 : 0,
                winCount: wins,
                lossCount: losses
            };
        }
        summaryExtra.rrSummaries = rrSummaries;
    }
    return { trades: results, lotSize, summary: summaryExtra };
}
