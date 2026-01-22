import type { Trade } from '../types';

export interface TradeSession {
    id: string;
    instrument: string;
    startDate: number;
    endDate: number;
    trades: Trade[];
    totalPnL: number;
    winRate: number;
    totalTrades: number;
}

const STORAGE_KEY = 'backtesting_trade_sessions';

/**
 * Get all stored trade sessions
 */
export function getStoredSessions(): TradeSession[] {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        return stored ? JSON.parse(stored) : [];
    } catch (error) {
        console.error('Error loading trade sessions:', error);
        return [];
    }
}

/**
 * Save a new trade session
 */
export function saveTradeSession(
    instrument: string,
    trades: Trade[],
    stats: {
        totalPnL: number;
        winRate: number;
    }
): TradeSession {
    const sessions = getStoredSessions();

    const newSession: TradeSession = {
        id: `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        instrument,
        startDate: trades.length > 0 ? trades[0].timestamp : Date.now(),
        endDate: trades.length > 0 ? trades[trades.length - 1].timestamp : Date.now(),
        trades,
        totalPnL: stats.totalPnL,
        winRate: stats.winRate,
        totalTrades: trades.length,
    };

    sessions.push(newSession);

    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
    } catch (error) {
        console.error('Error saving trade session:', error);
    }

    return newSession;
}

/**
 * Delete a trade session
 */
export function deleteTradeSession(sessionId: string): void {
    const sessions = getStoredSessions();
    const filtered = sessions.filter(s => s.id !== sessionId);

    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
    } catch (error) {
        console.error('Error deleting trade session:', error);
    }
}

/**
 * Clear all trade sessions
 */
export function clearAllSessions(): void {
    try {
        localStorage.removeItem(STORAGE_KEY);
    } catch (error) {
        console.error('Error clearing trade sessions:', error);
    }
}

/**
 * Get a specific session by ID
 */
export function getSessionById(sessionId: string): TradeSession | null {
    const sessions = getStoredSessions();
    return sessions.find(s => s.id === sessionId) || null;
}
