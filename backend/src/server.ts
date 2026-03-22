import dotenv from 'dotenv';
dotenv.config();

import logger from './utils/logger';

logger.info('--- DEBUG ENV ---');
logger.info(`DHAN_ACCESS_TOKEN exists: ${!!process.env.DHAN_ACCESS_TOKEN}`);
if (process.env.DHAN_ACCESS_TOKEN) {
  logger.info(`DHAN_ACCESS_TOKEN length: ${process.env.DHAN_ACCESS_TOKEN.length}`);
}
logger.info('------------------');

import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import { initDatabase } from './config/database';
import { initAngelOneClient, loginAngelOne } from './services/angelone.service';
import { initDhanClient } from './services/dhan.service';
import dataRoutes from './routes/data.routes';
import screenshotRoutes from './routes/screenshot.routes';
import optionsRoutes from './routes/options.routes';

const app: Express = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' })); 

// Request logging middleware
app.use((req: Request, res: Response, next) => {
  logger.info(`${req.method} ${req.path}`, {
    query: req.query,
    ip: req.ip,
  });
  next();
});

// Routes
app.use('/api/data', dataRoutes);
app.use('/api/screenshot', screenshotRoutes);
app.use('/api/options', optionsRoutes);

// Root endpoint
app.get('/', (req: Request, res: Response) => {
  res.json({
    message: 'Backtesting API Server',
    version: '1.0.0',
    endpoints: {
      data: '/api/data',
      health: '/api/data/health',
    },
  });
});

// Health check
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
  });
});

// Error handling middleware
app.use((err: Error, req: Request, res: Response, next: any) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message,
  });
});

// Initialize database and start server
async function startServer() {
  try {
    // Initialize database
    await initDatabase();
    logger.info('Database initialized successfully');

    // Start server immediately 
    app.listen(PORT, () => {
      logger.info(`Server running on http://localhost:${PORT}`);
      logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
    });

    // Initialize Angel One client and login (Background)
    try {
      initAngelOneClient();
      await loginAngelOne();
      logger.info('Angel One API client initialized and logged in');
    } catch (error: any) {
      logger.warn('Angel One API client initialization failed:', error.message);
    }

    // Initialize Dhan client
    try {
      initDhanClient();
    } catch (error: any) {
      logger.warn('Dhan API client initialization failed:', error.message);
    }
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
