import fs from 'fs';
import path from 'path';
import readline from 'readline';
import https from 'https';
import logger from '../utils/logger';

export interface DhanOptionSymbol {
    securityId: string;
    tradingSymbol: string;
    strike: number;
    optionType: 'CE' | 'PE';
    expiryDate: Date;
    expiryFlag: string; // 'W' = weekly, 'M' = monthly
    instrument: string; // NIFTY, BANKNIFTY
    lotSize: number;
}

let optionCache: DhanOptionSymbol[] = [];
let isReady = false;

const CSV_URL = 'https://images.dhan.co/api-data/api-scrip-master.csv';
const TEMP_FILE = path.join(__dirname, '../../data', 'master.csv');

// Dhan updates their CSV each morning by ~8:00 AM IST.
// Only treat the file as fresh if it was downloaded after that cutoff —
// otherwise a server started before 8 AM IST would use stale data all day.
// Using explicit IST offset makes this work correctly on any server timezone (UTC cloud included).
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // UTC+5:30
const CSV_FRESH_AFTER_HOUR_IST = 8; // 8:00 AM IST

export async function initSymbolMaster(): Promise<void> {
    logger.info('Initializing Dhan Symbol Master...');
    try {
        await downloadScripMaster();
        await parseScripMaster();
        isReady = true;
        logger.info(`Symbol Master ready! Cached ${optionCache.length} active Nifty option contracts.`);
        scheduleMorningRefreshIfNeeded();
    } catch (error: any) {
        logger.error(`Failed to initialize Symbol Master: ${error.message}`);
    }
}

/**
 * If the server started before 8 AM IST (before Dhan updates their CSV),
 * schedule a one-time refresh exactly at 8:00 AM IST so the in-memory cache
 * gets replaced with the fresh data automatically — no server restart needed.
 * Works correctly on any server timezone (UTC cloud or local IST machine).
 */
let morningRefreshScheduled = false;
let morningRefreshTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleMorningRefreshIfNeeded(): void {
    if (morningRefreshScheduled) return;

    const nowIST = new Date(Date.now() + IST_OFFSET_MS);
    const currentHourIST = nowIST.getUTCHours();

    if (currentHourIST >= CSV_FRESH_AFTER_HOUR_IST) return; // already past 8 AM IST, nothing to do

    // Calculate exact ms until 8:00:00 AM IST today
    const refreshTimeIST = new Date(nowIST);
    refreshTimeIST.setUTCHours(CSV_FRESH_AFTER_HOUR_IST, 0, 0, 0);
    const msUntilRefresh = refreshTimeIST.getTime() - nowIST.getTime();
    const minutesUntil = Math.round(msUntilRefresh / 60000);

    logger.info(`Server started before 8 AM IST — scheduling Symbol Master refresh in ${minutesUntil} min (at 8:00 AM IST)`);
    morningRefreshScheduled = true;

    // Clear any previous timer before setting a new one to prevent accumulation on repeated inits
    if (morningRefreshTimer) clearTimeout(morningRefreshTimer);

    morningRefreshTimer = setTimeout(async () => {
        morningRefreshTimer = null;
        logger.info('8:00 AM IST reached — re-downloading fresh Dhan CSV and refreshing Symbol Master...');
        morningRefreshScheduled = false; // allow re-schedule if init is called again tomorrow
        await initSymbolMaster();
    }, msUntilRefresh);
}

function isDownloadedToday(): boolean {
    if (!fs.existsSync(TEMP_FILE)) return false;
    const stats = fs.statSync(TEMP_FILE);
    if (stats.size < 1024) return false; // guard against empty/corrupt file from a failed prior download

    // Compare dates in IST to avoid local-timezone drift
    const fileMtimeIST = new Date(stats.mtimeMs + IST_OFFSET_MS);
    const nowIST = new Date(Date.now() + IST_OFFSET_MS);

    const sameDay =
        fileMtimeIST.getUTCFullYear() === nowIST.getUTCFullYear() &&
        fileMtimeIST.getUTCMonth() === nowIST.getUTCMonth() &&
        fileMtimeIST.getUTCDate() === nowIST.getUTCDate();

    if (!sameDay) return false;

    // Only consider fresh if downloaded after 8 AM IST (post Dhan CSV update)
    return fileMtimeIST.getUTCHours() >= CSV_FRESH_AFTER_HOUR_IST;
}

function downloadScripMaster(): Promise<void> {
    return new Promise((resolve, reject) => {
        // Dhan updates the CSV each trading day morning — download once per calendar day
        if (isDownloadedToday()) {
            logger.info('Symbol master already downloaded today — using cached master.csv');
            return resolve();
        }

        logger.info(`Downloading master.csv from ${CSV_URL}...`);

        // Ensure data dir exists
        const dir = path.dirname(TEMP_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        let settled = false;
        const done = (err?: Error) => {
            if (settled) return;
            settled = true;
            if (err) {
                fs.unlink(TEMP_FILE, () => {});
                reject(err);
            } else {
                resolve();
            }
        };

        const fetchUrl = (url: string, redirectsLeft = 3) => {
            const req = https.get(url, (response) => {
                // Follow redirects (301 / 302)
                if (response.statusCode === 301 || response.statusCode === 302) {
                    const location = response.headers.location;
                    if (!location || redirectsLeft === 0) {
                        return done(new Error(`Too many redirects or missing location header (status ${response.statusCode})`));
                    }
                    response.resume(); // drain to free socket
                    logger.info(`Redirected to ${location}`);
                    return fetchUrl(location, redirectsLeft - 1);
                }

                if (response.statusCode !== 200) {
                    return done(new Error(`Failed to download master.csv, HTTP status: ${response.statusCode}`));
                }

                const file = fs.createWriteStream(TEMP_FILE);

                file.on('error', (err) => done(err));
                file.on('finish', () => { file.close(); done(); });

                response.pipe(file);
            });
            req.on('error', (err) => done(err));
            // Abort if the server stops sending data for 30 seconds
            req.setTimeout(30000, () => {
                req.destroy(new Error('CSV download timed out after 30s'));
            });
        };

        fetchUrl(CSV_URL);
    });
}

function parseScripMaster(): Promise<void> {
    return new Promise((resolve, reject) => {
        const newCache: DhanOptionSymbol[] = [];
        const fileStream = fs.createReadStream(TEMP_FILE);
        
        const rl = readline.createInterface({
            input: fileStream,
            crlfDelay: Infinity
        });

        let isHeader = true;
        const nowMs = Date.now();

        rl.on('line', (line) => {
            if (isHeader) {
                isHeader = false;
                return;
            }

            // Columns (based on Dhan format):
            // 0: SEM_EXM_EXCH_ID (NSE, BSE, etc.)
            // 1: SEM_SEGMENT
            // 2: SEM_SMST_SECURITY_ID
            // 3: SEM_INSTRUMENT_NAME (OPTIDX / OPTSTK / etc.)
            // 4: SEM_EXPIRY_CODE
            // 5: SEM_TRADING_SYMBOL (NIFTY-28Mar2024-22000-CE)
            // 6: SEM_LOT_UNITS
            // 7: SEM_CUSTOM_SYMBOL
            // 8: SEM_EXPIRY_DATE (YYYY-MM-DD HH:mm:ss)
            // 9: SEM_STRIKE_PRICE
            // 10: SEM_OPTION_TYPE (CE / PE)

            if (!line.includes('OPTIDX') || (!line.includes('NIFTY') && !line.includes('BANKNIFTY'))) {
                return;
            }

            const cols = line.split(',');
            if (cols.length < 13) return;

            const instName = cols[3];
            if (instName !== 'OPTIDX') return;

            const tradingSymbol = cols[5];
            // Filter strictly for NIFTY or BANKNIFTY base names to avoid FINNIFTY matching NIFTY
            const isNifty = tradingSymbol.startsWith('NIFTY-');
            const isBankNifty = tradingSymbol.startsWith('BANKNIFTY-');
            if (!isNifty && !isBankNifty) return;

            const expiryStr = cols[8];
            const expiryTs = new Date(expiryStr).getTime();
            
            // Ignore expired options
            if (expiryTs < nowMs) return;

            newCache.push({
                securityId: cols[2],
                tradingSymbol,
                strike: parseFloat(cols[9]),
                optionType: cols[10].trim() as 'CE' | 'PE',
                expiryDate: new Date(expiryTs),
                expiryFlag: (cols[12] || '').trim(),
                instrument: isNifty ? 'NIFTY' : 'BANKNIFTY',
                lotSize: parseFloat(cols[6]) || 65,
            });
        });

        rl.on('close', () => {
            optionCache = newCache;
            resolve();
        });

        rl.on('error', (err) => {
            reject(err);
        });
    });
}

/**
 * Returns the lot size for a given instrument (NIFTY or BANKNIFTY)
 * by reading the first matching contract from the cached scrip master.
 */
export function getLotSizeForInstrument(instrumentName: 'NIFTY' | 'BANKNIFTY'): number {
    if (!isReady || optionCache.length === 0) {
        throw new Error('Symbol Master is not ready yet');
    }
    const match = optionCache.find(o => o.instrument === instrumentName);
    if (!match) {
        throw new Error(`No options found for ${instrumentName} in symbol master`);
    }
    return match.lotSize;
}

/**
 * Gets the ATM option security ID for the given parameters.
 * Prefers weekly expiry (expiryFlag 'W'), falls back to nearest.
 */
export function getATMOptionSecurityId(spotPrice: number, optionType: 'CE' | 'PE', instrumentName: 'NIFTY' | 'BANKNIFTY' = 'NIFTY'): DhanOptionSymbol | null {
    if (!isReady || optionCache.length === 0) {
        throw new Error('Symbol Master is not ready yet');
    }

    // Determine strike interval (NIFTY: 50pts, BANKNIFTY: 100pts)
    const interval = instrumentName === 'NIFTY' ? 50 : 100;
    
    // Round spot price to nearest valid strike
    const atmStrike = Math.round(spotPrice / interval) * interval;

    // Filter: correct instrument, correct option type, exact ATM strike (within 0.01 float tolerance)
    const candidates = optionCache.filter(o =>
        o.instrument === instrumentName &&
        o.optionType === optionType &&
        Math.abs(o.strike - atmStrike) < 0.01
    );

    if (candidates.length === 0) {
        logger.warn(`No ${optionType} candidates found for ${instrumentName} ATM strike ${atmStrike}`);
        return null;
    }

    // 1. Try to find nearest WEEKLY expiry first
    const weeklyExpiries = candidates
        .filter(o => o.expiryFlag === 'W')
        .sort((a, b) => a.expiryDate.getTime() - b.expiryDate.getTime());

    if (weeklyExpiries.length > 0) {
        logger.info(`Found weekly ATM option: ${weeklyExpiries[0].tradingSymbol}`);
        return weeklyExpiries[0];
    }

    // 2. Fallback: nearest any expiry
    candidates.sort((a, b) => a.expiryDate.getTime() - b.expiryDate.getTime());
    logger.info(`No weekly found, using nearest expiry: ${candidates[0].tradingSymbol}`);
    return candidates[0];
}
