import dotenv from 'dotenv';
dotenv.config();

import logger from './utils/logger';

// ── Startup environment validation ──────────────────────────────────────────
function validateEnv(): void {
  const IS_SIM = process.env.DHAN_SIMULATION === 'true';
  logger.info(`[ENV] NODE_ENV=${process.env.NODE_ENV || 'development'} | SIMULATION=${IS_SIM}`);
  if (!IS_SIM) {
    if (!process.env.DHAN_CLIENT_ID)
      logger.warn('[ENV] DHAN_CLIENT_ID is not set — live trading will be disabled');
    if (!process.env.DHAN_ACCESS_TOKEN)
      logger.warn('[ENV] DHAN_ACCESS_TOKEN is not set — live trading will be disabled');
  }
}
validateEnv();

import express, { Express, Request, Response } from 'express';
import cors from 'cors';

// Global error handling for unhandled exceptions (like from Socket.io or WS)
process.on('uncaughtException', (err) => {
  logger.error('CRITICAL: Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('CRITICAL: Unhandled Rejection at:', promise, 'reason:', reason);
});
import { initDatabase, closeDatabase } from './config/database';
import { initAngelOneClient, loginAngelOne } from './services/angelone.service';
import dataRoutes from './routes/data.routes';
import screenshotRoutes from './routes/screenshot.routes';
import optionsRoutes from './routes/options.routes';
import liveRoutes from './routes/live.routes';

import { Server } from 'socket.io';
import http from 'http';

import { initDhanMarketFeed, handleSocketSubscription, setInternalTickCallback } from './adapters/dhanFeed.adapter';
import { initPositionMonitor, onTick } from './services/positionMonitor.service';

const app: Express = express();
const PORT = process.env.PORT || 3001;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: CORS_ORIGIN,
    methods: ['GET', 'POST'],
  },
});

// Middleware
app.use(cors({ origin: CORS_ORIGIN }));
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

// ── Graceful shutdown ────────────────────────────────────────────────────────
let shuttingDown = false;
function gracefulShutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`[Shutdown] Received ${signal} — closing gracefully...`);

  // Force-kill after 30 s in case something hangs
  const forceExitTimer = setTimeout(() => {
    logger.error('[Shutdown] Forced exit after 30s timeout');
    process.exit(1);
  }, 30_000);
  forceExitTimer.unref(); // don't keep the process alive just for this timer

  // Close HTTP server (stops accepting new connections; waits for in-flight requests)
  httpServer.close(() => {
    logger.info('[Shutdown] HTTP server closed');
    closeDatabase();
    logger.info('[Shutdown] Database closed — exiting');
    process.exit(0);
  });
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

// ── Server startup ───────────────────────────────────────────────────────────
async function startServer() {
  try {
    // Initialize database
    await initDatabase();
    logger.info('Database initialized successfully');

    // Start server
    httpServer
      .listen(PORT, () => {
        logger.info(`Server running on http://localhost:${PORT}`);
        logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
      })
      .on('error', (err: NodeJS.ErrnoException) => {
        logger.error('[Startup] HTTP server failed to bind:', err.message);
        process.exit(1);
      });

    // Initialize Angel One client and login (Concurrent background task)
    initAngelOneClient();
    loginAngelOne().then(() => {
      logger.info('Angel One API client initialization completed');
    }).catch((error) => {
      logger.warn('Angel One login background task failed:', error.message);
    });

    // Initialize broker services (real or simulation based on DHAN_SIMULATION env var)
    const IS_SIM = process.env.DHAN_SIMULATION === 'true';
    try {
      if (IS_SIM) {
        logger.info('🧪 [SIMULATION MODE] DHAN_SIMULATION=true — using mock broker services');
        const { initSymbolMaster: initMockMaster } = await import('./simulation/mockSymbolMaster');
        await initMockMaster();
        initDhanMarketFeed(io); // resolves to mockMarketFeed via adapter
        initPositionMonitor(io);
        setInternalTickCallback((token, price) => { onTick(token, price); });
        // Mount scenario/dev routes (simulation only)
        const { default: scenarioRoutes } = await import('./simulation/scenarioRoutes');
        app.use('/api/dev', scenarioRoutes);
        logger.info('🧪 [SIMULATION MODE] Scenario routes mounted at /api/dev');
      } else {
        const { loginDhan, initDhanClient: realInit } = await import('./services/dhan.service');
        const { initSymbolMaster: realMaster } = await import('./services/symbolMaster.service');
        try {
          await loginDhan(); // TOTP login — refreshes token if DHAN_PIN + DHAN_TOTP_SECRET are set
        } catch (err: any) {
          logger.warn('Dhan TOTP login failed, using static DHAN_ACCESS_TOKEN:', err.message);
        }
        realInit();
        realMaster(); // Download and parse Scrip Master
        initDhanMarketFeed(io);
        initPositionMonitor(io);
        setInternalTickCallback((token, price) => { onTick(token, price); });
      }
    } catch (error: any) {
      logger.warn('Broker service initialization failed:', error.message);
    }
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
