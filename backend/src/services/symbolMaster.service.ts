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

export async function initSymbolMaster(): Promise<void> {
    logger.info('Initializing Dhan Symbol Master...');
    try {
        await downloadScripMaster();
        await parseScripMaster();
        isReady = true;
        logger.info(`Symbol Master ready! Cached ${optionCache.length} active Nifty option contracts.`);
    } catch (error: any) {
        logger.error(`Failed to initialize Symbol Master: ${error.message}`);
    }
}

function isDownloadedToday(): boolean {
    if (!fs.existsSync(TEMP_FILE)) return false;
    const stats = fs.statSync(TEMP_FILE);
    const fileDate = new Date(stats.mtimeMs);
    const today = new Date();
    return (
        fileDate.getFullYear() === today.getFullYear() &&
        fileDate.getMonth() === today.getMonth() &&
        fileDate.getDate() === today.getDate()
    );
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

        const file = fs.createWriteStream(TEMP_FILE);
        https.get(CSV_URL, (response) => {
            if (response.statusCode !== 200) {
                return reject(new Error(`Failed to download, status: ${response.statusCode}`));
            }
            response.pipe(file);
            file.on('finish', () => {
                file.close();
                resolve();
            });
        }).on('error', (err) => {
            fs.unlink(TEMP_FILE, () => {});
            reject(err);
        });
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
            if (cols.length < 12) return;

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
