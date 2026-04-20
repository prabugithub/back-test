"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initDatabase = initDatabase;
exports.getDatabase = getDatabase;
exports.closeDatabase = closeDatabase;
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const logger_1 = __importDefault(require("../utils/logger"));
let db = null;
const DB_PATH = path_1.default.join(__dirname, '../../data/backtesting.db');
/**
 * Initialize the SQLite database (synchronous via better-sqlite3).
 * Kept async so existing callers can await it without changes.
 */
async function initDatabase() {
    if (db)
        return;
    // Ensure data directory exists
    const dataDir = path_1.default.dirname(DB_PATH);
    if (!fs_1.default.existsSync(dataDir)) {
        fs_1.default.mkdirSync(dataDir, { recursive: true });
    }
    db = new better_sqlite3_1.default(DB_PATH);
    // WAL mode: allows concurrent reads while writing, safer on crashes
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    createSchema(db);
    logger_1.default.info('Database initialized (better-sqlite3, WAL mode)');
}
/**
 * Create database schema
 */
function createSchema(database) {
    database.exec(`
    CREATE TABLE IF NOT EXISTS candles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      security_id TEXT NOT NULL,
      exchange_segment TEXT NOT NULL,
      instrument TEXT NOT NULL,
      interval TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      open REAL NOT NULL,
      high REAL NOT NULL,
      low REAL NOT NULL,
      close REAL NOT NULL,
      volume INTEGER NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      UNIQUE(security_id, exchange_segment, interval, timestamp)
    );

    CREATE INDEX IF NOT EXISTS idx_candles_lookup
    ON candles(security_id, exchange_segment, interval, timestamp);

    CREATE TABLE IF NOT EXISTS instruments (
      security_id TEXT PRIMARY KEY,
      exchange_segment TEXT NOT NULL,
      instrument_type TEXT NOT NULL,
      symbol TEXT NOT NULL,
      name TEXT,
      lot_size INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_instruments_search
    ON instruments(symbol, name);

    CREATE TABLE IF NOT EXISTS monitored_positions (
      id TEXT PRIMARY KEY,
      spot_token TEXT NOT NULL,
      spot_segment TEXT NOT NULL,
      direction TEXT NOT NULL,
      stop_loss REAL NOT NULL DEFAULT 0,
      target REAL NOT NULL DEFAULT 0,
      option_security_id TEXT NOT NULL,
      option_exchange_segment TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      entry_price REAL NOT NULL,
      product_type TEXT NOT NULL DEFAULT 'INTRADAY',
      registered_at INTEGER NOT NULL
    );
  `);
    // Migrate existing databases — add product_type if the column is missing
    try {
        database.exec(`ALTER TABLE monitored_positions ADD COLUMN product_type TEXT NOT NULL DEFAULT 'INTRADAY'`);
    }
    catch (e) {
        if (!e.message?.includes('duplicate column'))
            throw e;
    }
    logger_1.default.info('Database schema ready');
}
/**
 * Get the database instance.
 * Throws if initDatabase() was not called first.
 */
function getDatabase() {
    if (!db) {
        throw new Error('Database not initialized. Call initDatabase() first.');
    }
    return db;
}
/**
 * Close the database connection cleanly.
 * Called during graceful shutdown in server.ts.
 */
function closeDatabase() {
    if (db) {
        db.close();
        db = null;
        logger_1.default.info('Database closed');
    }
}
