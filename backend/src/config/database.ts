import BetterSqlite3 from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import logger from '../utils/logger';

let db: BetterSqlite3.Database | null = null;
const DB_PATH = path.join(__dirname, '../../data/backtesting.db');

/**
 * Initialize the SQLite database (synchronous via better-sqlite3).
 * Kept async so existing callers can await it without changes.
 */
export async function initDatabase(): Promise<void> {
  if (db) return;

  // Ensure data directory exists
  const dataDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  db = new BetterSqlite3(DB_PATH);

  // WAL mode: allows concurrent reads while writing, safer on crashes
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');

  createSchema(db);
  logger.info('Database initialized (better-sqlite3, WAL mode)');
}

/**
 * Create database schema
 */
function createSchema(database: BetterSqlite3.Database): void {
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
      registered_at INTEGER NOT NULL
    );
  `);

  logger.info('Database schema ready');
}

/**
 * Get the database instance.
 * Throws if initDatabase() was not called first.
 */
export function getDatabase(): BetterSqlite3.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

/**
 * Close the database connection cleanly.
 * Called during graceful shutdown in server.ts.
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
    logger.info('Database closed');
  }
}
