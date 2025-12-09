import initSqlJs, { Database } from 'sql.js';
import fs from 'fs';
import path from 'path';
import logger from '../utils/logger';

let db: Database | null = null;
const DB_PATH = path.join(__dirname, '../../data/backtesting.db');

/**
 * Initialize the SQLite database
 */
export async function initDatabase(): Promise<Database> {
  if (db) {
    return db;
  }

  try {
    const SQL = await initSqlJs();

    // Ensure data directory exists
    const dataDir = path.dirname(DB_PATH);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    // Load existing database or create new one
    if (fs.existsSync(DB_PATH)) {
      const buffer = fs.readFileSync(DB_PATH);
      db = new SQL.Database(buffer);
      logger.info('Loaded existing database from file');
    } else {
      db = new SQL.Database();
      logger.info('Created new database');
    }

    // Create schema
    createSchema(db);

    // Save database to file
    saveDatabase();

    return db;
  } catch (error) {
    logger.error('Failed to initialize database:', error);
    throw error;
  }
}

/**
 * Create database schema
 */
function createSchema(database: Database): void {
  // Create candles table
  database.run(`
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
    )
  `);

  // Create index for faster lookups
  database.run(`
    CREATE INDEX IF NOT EXISTS idx_candles_lookup
    ON candles(security_id, exchange_segment, interval, timestamp)
  `);

  // Create instruments table
  database.run(`
    CREATE TABLE IF NOT EXISTS instruments (
      security_id TEXT PRIMARY KEY,
      exchange_segment TEXT NOT NULL,
      instrument_type TEXT NOT NULL,
      symbol TEXT NOT NULL,
      name TEXT,
      lot_size INTEGER
    )
  `);

  // Create index for instrument search
  database.run(`
    CREATE INDEX IF NOT EXISTS idx_instruments_search
    ON instruments(symbol, name)
  `);

  logger.info('Database schema created successfully');
}

/**
 * Save database to file
 */
export function saveDatabase(): void {
  if (!db) {
    return;
  }

  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
    logger.debug('Database saved to file');
  } catch (error) {
    logger.error('Failed to save database:', error);
  }
}

/**
 * Get the database instance
 */
export function getDatabase(): Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

/**
 * Close the database connection
 */
export function closeDatabase(): void {
  if (db) {
    saveDatabase();
    db.close();
    db = null;
    logger.info('Database closed');
  }
}

// Auto-save every 5 minutes
setInterval(() => {
  saveDatabase();
}, 5 * 60 * 1000);

// Save on process exit
process.on('SIGINT', () => {
  closeDatabase();
  process.exit(0);
});

process.on('SIGTERM', () => {
  closeDatabase();
  process.exit(0);
});
