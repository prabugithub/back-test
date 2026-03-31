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

// Global error handling for unhandled exceptions (like from Socket.io or WS)
process.on('uncaughtException', (err) => {
  logger.error('CRITICAL: Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('CRITICAL: Unhandled Rejection at:', promise, 'reason:', reason);
});
import { initDatabase } from './config/database';
import { initAngelOneClient, loginAngelOne } from './services/angelone.service';
import { initDhanClient } from './services/dhan.service';
import dataRoutes from './routes/data.routes';
import screenshotRoutes from './routes/screenshot.routes';
import optionsRoutes from './routes/options.routes';
import liveRoutes from './routes/live.routes';

import { Server } from 'socket.io';
import http from 'http';

import { initDhanMarketFeed, handleSocketSubscription } from './services/dhanMarketFeed.service';
import { initSymbolMaster } from './services/symbolMaster.service';

const app: Express = express();
const PORT = process.env.PORT || 3001;
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

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

// Real-time connections
io.on('connection', (socket) => {
  logger.info('New client connected', { id: socket.id });

  // Use the new market feed subscription handlers
  handleSocketSubscription(socket);

  socket.on('disconnect', () => {
    logger.info('Client disconnected', { id: socket.id });
  });
});

// Routes
app.use('/api/data', dataRoutes);
app.use('/api/screenshot', screenshotRoutes);
app.use('/api/options', optionsRoutes);
app.use('/api/live', liveRoutes);

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
    httpServer.listen(PORT, () => {
      logger.info(`Server running on http://localhost:${PORT}`);
      logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
    });

    // Initialize Angel One client and login (Concurrent background task)
    initAngelOneClient();
    loginAngelOne().then(() => {
      logger.info('Angel One API client initialization completed');
    }).catch((error) => {
      logger.warn('Angel One login background task failed:', error.message);
    });

    // Initialize Dhan client
    try {
      initDhanClient();
      initSymbolMaster(); // Download and parse Scrip Master
      // Initialize Market Feed
      initDhanMarketFeed(io);
    } catch (error: any) {
      logger.warn('Dhan API client initialization failed:', error.message);
    }
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
