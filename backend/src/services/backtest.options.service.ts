import { fetchRollingOptionData } from './dhan.service';
import logger from '../utils/logger';
import { format, addMonths, subMonths } from 'date-fns';

export interface OptionBacktestRequest {
    spotTrades: any[]; // The GroupedPosition[] from frontend
    offsetSell: number; // e.g., 2 (200 pts OTM)
    offsetBuy: number; // e.g., 4 (400 pts OTM)
    instrument: 'NIFTY'; // For now just Nifty
}

export interface OptionBacktestResult {
    trades: any[];
    summary: {
        totalRealizedPnL: number;
        spotTotalPnL: number;
        winRate: number;
        totalTrades: number;
    };
}

/**
 * Handle option backtesting logic by mapping spot trades to option spreads
 */
export async function backtestOptions(params: OptionBacktestRequest): Promise<OptionBacktestResult> {
    const results: any[] = [];
    let totalRealizedPnL = 0;
    let spotTotalPnL = 0;
    let winningTrades = 0;

    logger.info(`Starting option backtesting for ${params.spotTrades.length} trades`);

    for (const spotTrade of params.spotTrades) {
        try {
            const entryDate = new Date(spotTrade.entryTime);
            const exitDate = spotTrade.exitTime ? new Date(spotTrade.exitTime) : new Date();

            // Format dates for Dhan API (YYYY-MM-DD)
            const fromDateStr = format(entryDate, 'yyyy-MM-dd');
            const toDateStr = format(exitDate, 'yyyy-MM-dd');

            // Determine Option Type and Strikes
            const isBullish = spotTrade.direction === 'LONG';
            const optionType: 'CALL' | 'PUT' = isBullish ? 'PUT' : 'CALL';
            
            // For Bullish (Spot Long), we Sell Put OTM (ATM-offset) and Buy Put further OTM (ATM-offset-buy)
            // For Bearish (Spot Short), we Sell Call OTM (ATM+offset) and Buy Call further OTM (ATM+offset+buy)
            const sellStrikeStr = isBullish ? `ATM-${params.offsetSell}` : `ATM+${params.offsetSell}`;
            const buyStrikeStr = isBullish ? `ATM-${params.offsetBuy}` : `ATM+${params.offsetBuy}`;

            // Fetch data for both legs
            // Note: rollingoption requires 1 day extra or exactly same day?
            // Usually, if entry and exit are same day, fromDate == toDate works.
            
            const [leg1Data, leg2Data] = await Promise.all([
                fetchRollingOptionData({
                    securityId: '13',
                    exchangeSegment: 'NSE_FNO',
                    instrument: 'OPTIDX',
                    expiryFlag: 'MONTH', // Using Monthly for consistency in backtesting
                    strike: sellStrikeStr,
                    optionType,
                    fromDate: fromDateStr,
                    toDate: toDateStr,
                    interval: '5'
                }),
                fetchRollingOptionData({
                    securityId: '13',
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
                logger.warn(`No option data found for trade ${spotTrade.id} at ${fromDateStr}`);
                results.push({ ...spotTrade, optionResults: null, error: 'No data' });
                continue;
            }

            // Find entry and exit prices for both legs
            // Match entryTime and exitTime as closely as possible
            const entryTs = Math.floor(spotTrade.entryTime / 1000);
            const exitTs = Math.floor(spotTrade.exitTime / 1000);

            const findClosest = (data: any[], ts: number) => {
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
            if (totalPnLForQty > 0) winningTrades++;

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

        } catch (error: any) {
            logger.error(`Failed to backtest option for trade ${spotTrade.id}:`, error.message);
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
