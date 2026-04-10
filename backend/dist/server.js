"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const logger_1 = __importDefault(require("./utils/logger"));
// ── Startup environment validation ──────────────────────────────────────────
function validateEnv() {
    const IS_SIM = process.env.DHAN_SIMULATION === 'true';
    logger_1.default.info(`[ENV] NODE_ENV=${process.env.NODE_ENV || 'development'} | SIMULATION=${IS_SIM}`);
    if (!IS_SIM) {
        if (!process.env.DHAN_CLIENT_ID)
            logger_1.default.warn('[ENV] DHAN_CLIENT_ID is not set — live trading will be disabled');
        if (!process.env.DHAN_ACCESS_TOKEN)
            logger_1.default.warn('[ENV] DHAN_ACCESS_TOKEN is not set — live trading will be disabled');
    }
}
validateEnv();
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
// Global error handling for unhandled exceptions (like from Socket.io or WS)
process.on('uncaughtException', (err) => {
    logger_1.default.error('CRITICAL: Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
    logger_1.default.error('CRITICAL: Unhandled Rejection at:', promise, 'reason:', reason);
});
const database_1 = require("./config/database");
const angelone_service_1 = require("./services/angelone.service");
const data_routes_1 = __importDefault(require("./routes/data.routes"));
const screenshot_routes_1 = __importDefault(require("./routes/screenshot.routes"));
const options_routes_1 = __importDefault(require("./routes/options.routes"));
const live_routes_1 = __importDefault(require("./routes/live.routes"));
const socket_io_1 = require("socket.io");
const http_1 = __importDefault(require("http"));
const dhanFeed_adapter_1 = require("./adapters/dhanFeed.adapter");
const positionMonitor_service_1 = require("./services/positionMonitor.service");
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3001;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const httpServer = http_1.default.createServer(app);
const io = new socket_io_1.Server(httpServer, {
    cors: {
        origin: CORS_ORIGIN,
        methods: ['GET', 'POST'],
    },
});
// Middleware
app.use((0, cors_1.default)({ origin: CORS_ORIGIN }));
app.use(express_1.default.json({ limit: '10mb' }));
// Request logging middleware
app.use((req, res, next) => {
    logger_1.default.info(`${req.method} ${req.path}`, {
        query: req.query,
        ip: req.ip,
    });
    next();
});
// Real-time connections
io.on('connection', (socket) => {
    logger_1.default.info('New client connected', { id: socket.id });
    // Use the new market feed subscription handlers
    (0, dhanFeed_adapter_1.handleSocketSubscription)(socket);
    socket.on('disconnect', () => {
        logger_1.default.info('Client disconnected', { id: socket.id });
    });
});
// Routes
app.use('/api/data', data_routes_1.default);
app.use('/api/screenshot', screenshot_routes_1.default);
app.use('/api/options', options_routes_1.default);
app.use('/api/live', live_routes_1.default);
// Root endpoint
app.get('/', (req, res) => {
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
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
    });
});
// Error handling middleware
app.use((err, req, res, next) => {
    logger_1.default.error('Unhandled error:', err);
    res.status(500).json({
        error: 'Internal server error',
        message: err.message,
    });
});
// ── Graceful shutdown ────────────────────────────────────────────────────────
let shuttingDown = false;
function gracefulShutdown(signal) {
    if (shuttingDown)
        return;
    shuttingDown = true;
    logger_1.default.info(`[Shutdown] Received ${signal} — closing gracefully...`);
    // Force-kill after 30 s in case something hangs
    const forceExitTimer = setTimeout(() => {
        logger_1.default.error('[Shutdown] Forced exit after 30s timeout');
        process.exit(1);
    }, 30000);
    forceExitTimer.unref(); // don't keep the process alive just for this timer
    // Close HTTP server (stops accepting new connections; waits for in-flight requests)
    httpServer.close(() => {
        logger_1.default.info('[Shutdown] HTTP server closed');
        (0, database_1.closeDatabase)();
        logger_1.default.info('[Shutdown] Database closed — exiting');
        process.exit(0);
    });
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
// ── Server startup ───────────────────────────────────────────────────────────
async function startServer() {
    try {
        // Initialize database
        await (0, database_1.initDatabase)();
        logger_1.default.info('Database initialized successfully');
        // Start server
        httpServer
            .listen(PORT, () => {
            logger_1.default.info(`Server running on http://localhost:${PORT}`);
            logger_1.default.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
        })
            .on('error', (err) => {
            logger_1.default.error('[Startup] HTTP server failed to bind:', err.message);
            process.exit(1);
        });
        // Initialize Angel One client and login (Concurrent background task)
        (0, angelone_service_1.initAngelOneClient)();
        (0, angelone_service_1.loginAngelOne)().then(() => {
            logger_1.default.info('Angel One API client initialization completed');
        }).catch((error) => {
            logger_1.default.warn('Angel One login background task failed:', error.message);
        });
        // Initialize broker services (real or simulation based on DHAN_SIMULATION env var)
        const IS_SIM = process.env.DHAN_SIMULATION === 'true';
        try {
            if (IS_SIM) {
                logger_1.default.info('🧪 [SIMULATION MODE] DHAN_SIMULATION=true — using mock broker services');
                const { initSymbolMaster: initMockMaster } = await Promise.resolve().then(() => __importStar(require('./simulation/mockSymbolMaster')));
                await initMockMaster();
                (0, dhanFeed_adapter_1.initDhanMarketFeed)(io); // resolves to mockMarketFeed via adapter
                (0, positionMonitor_service_1.initPositionMonitor)(io);
                (0, dhanFeed_adapter_1.setInternalTickCallback)((token, price) => { (0, positionMonitor_service_1.onTick)(token, price); });
                // Mount scenario/dev routes (simulation only)
                const { default: scenarioRoutes } = await Promise.resolve().then(() => __importStar(require('./simulation/scenarioRoutes')));
                app.use('/api/dev', scenarioRoutes);
                logger_1.default.info('🧪 [SIMULATION MODE] Scenario routes mounted at /api/dev');
            }
            else {
                const { loginDhan, initDhanClient: realInit } = await Promise.resolve().then(() => __importStar(require('./services/dhan.service')));
                const { initSymbolMaster: realMaster } = await Promise.resolve().then(() => __importStar(require('./services/symbolMaster.service')));
                try {
                    await loginDhan(); // TOTP login — refreshes token if DHAN_PIN + DHAN_TOTP_SECRET are set
                }
                catch (err) {
                    logger_1.default.warn('Dhan TOTP login failed, using static DHAN_ACCESS_TOKEN:', err.message);
                }
                realInit();
                realMaster(); // Download and parse Scrip Master
                (0, dhanFeed_adapter_1.initDhanMarketFeed)(io);
                (0, positionMonitor_service_1.initPositionMonitor)(io);
                (0, dhanFeed_adapter_1.setInternalTickCallback)((token, price) => { (0, positionMonitor_service_1.onTick)(token, price); });
            }
        }
        catch (error) {
            logger_1.default.warn('Broker service initialization failed:', error.message);
        }
    }
    catch (error) {
        logger_1.default.error('Failed to start server:', error);
        process.exit(1);
    }
}
startServer();
