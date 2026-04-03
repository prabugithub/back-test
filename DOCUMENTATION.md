# Manual Backtesting System — Technical Documentation

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture](#2-architecture)
3. [Project Structure](#3-project-structure)
4. [Frontend](#4-frontend)
5. [Backend](#5-backend)
6. [Frontend–Backend Communication](#6-frontendbackend-communication)
7. [Database](#7-database)
8. [External Integrations](#8-external-integrations)
9. [Environment Configuration](#9-environment-configuration)
10. [Setup & Running](#10-setup--running)

---

## 1. Project Overview

A full-stack web application for **manual backtesting of Indian stock market trades**. Users replay historical candlestick data candle-by-candle, execute simulated trades, track performance metrics, and analyse trading patterns with professional charting tools.

The same platform also supports **live trading** through the Dhan API when real credentials are configured.

**Tech Stack Summary**

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + TypeScript + Vite |
| State | Zustand 5 |
| Data Fetching | TanStack React Query 5 |
| Charts | TradingView Lightweight Charts 5 |
| Styling | Tailwind CSS 4 |
| Backend | Node.js + Express 4 + TypeScript |
| Database | SQLite (sql.js, file-persisted) |
| Real-time | Socket.io 4 |
| Session Persistence | Firebase Firestore |
| Market APIs | Dhan API, Angel One SmartAPI |
| Cloud Storage | Google Drive API |

---

## 2. Architecture

```
Browser (React SPA)
       │
       │  HTTP REST + Socket.io WebSocket
       ▼
Express API Server  (:3001)
       │
       ├── SQLite cache (backtesting.db)
       │
       ├── Dhan API  (historical data, live orders, market feed)
       ├── Angel One SmartAPI  (alternative data source)
       └── Google Drive API  (screenshot upload)

Session Persistence (out-of-band):
  Browser ──► Firebase Firestore  (session save/restore)
```

All trade execution logic (FIFO, P&L calculations) runs **client-side** in the Zustand store. The backend is responsible for data fetching, caching, and live order routing only.

---

## 3. Project Structure

```
back-test/
├── backend/
│   ├── src/
│   │   ├── config/
│   │   │   └── database.ts          # SQLite init, schema, auto-save
│   │   ├── routes/
│   │   │   ├── data.routes.ts       # GET /api/data/candles, DELETE cache
│   │   │   ├── live.routes.ts       # POST order/smart-exit, GET positions
│   │   │   ├── options.routes.ts    # POST /api/options/backtest
│   │   │   └── screenshot.routes.ts # POST /api/screenshot/upload
│   │   ├── services/
│   │   │   ├── dhan.service.ts      # Dhan REST + order placement
│   │   │   ├── angelone.service.ts  # Angel One SmartAPI auth
│   │   │   ├── data.service.ts      # Cache-aware candle fetching
│   │   │   ├── backtest.engine.ts   # FIFO position tracker
│   │   │   ├── backtest.options.service.ts
│   │   │   ├── dhanMarketFeed.service.ts  # WebSocket real-time feed
│   │   │   ├── optionChain.service.ts     # ATM option lookup
│   │   │   ├── smartExit.service.ts       # 3-step chaser loop
│   │   │   ├── symbolMaster.service.ts    # Dhan scrip master CSV
│   │   │   ├── googleDrive.service.ts     # OAuth2 Drive upload
│   │   │   └── yahoo.service.ts           # Yahoo Finance (fallback)
│   │   ├── types/
│   │   │   └── index.ts             # Shared TS interfaces
│   │   ├── utils/
│   │   │   ├── logger.ts            # Winston logger
│   │   │   └── date-helpers.ts      # Date utilities
│   │   └── server.ts                # Express app entry point
│   ├── data/
│   │   └── backtesting.db           # SQLite file (auto-created)
│   ├── dist/                        # Compiled JS
│   └── package.json
│
├── frontend/
│   ├── src/
│   │   ├── components/              # 20 React components
│   │   ├── stores/
│   │   │   ├── sessionStore.ts      # Core backtesting state
│   │   │   ├── liveStore.ts         # Live trading state
│   │   │   └── notificationStore.ts # Toast queue
│   │   ├── services/
│   │   │   ├── api.ts               # Axios HTTP client
│   │   │   └── firebaseSessionService.ts  # Firestore ops
│   │   ├── hooks/
│   │   │   └── useChartDrawings.ts  # Canvas drawing interaction
│   │   ├── utils/
│   │   │   ├── indicators.ts        # SMA, EMA, Pivot, Al Brooks, ATR
│   │   │   ├── pivotAnalysis.ts     # LLHH-Pivot auto-detection
│   │   │   ├── tradeAnalysis.ts     # P&L stats, position grouping
│   │   │   ├── resampler.ts         # Multi-timeframe conversion
│   │   │   ├── formatters.ts        # Currency, date formatters
│   │   │   └── tradeStorage.ts      # Local storage persistence
│   │   ├── config/
│   │   │   └── firebase.ts          # Firebase app init
│   │   ├── data/
│   │   │   └── symbols.ts           # Static symbol list
│   │   ├── types/
│   │   │   └── index.ts             # Candle, Trade, Position, etc.
│   │   └── App.tsx                  # Root component, layout
│   ├── dist/                        # Vite production build
│   └── package.json
│
├── DOCUMENTATION.md                 # This file
├── FEATURES_GUIDE.md                # Feature reference
├── README.md
└── *.md                             # Other setup guides
```

---

## 4. Frontend

### 4.1 Entry Point — `App.tsx`

- Wraps the app in `QueryClientProvider` (React Query)
- Manages top-level layout: sidebar, main chart area, dialogs
- Coordinates which modals/dialogs are open
- Supports single and dual-chart layouts

### 4.2 Components

#### Core UI

| Component | File | Responsibility |
|-----------|------|----------------|
| **AdvancedChart** | `AdvancedChart.tsx` (~41 KB) | Renders TradingView candlestick + volume chart, overlays indicators, drawing canvas, trade markers |
| **InstrumentSelector** | `InstrumentSelector.tsx` (~27 KB) | Form to select symbol, exchange, timeframe, date range; triggers data fetch |
| **PlaybackControls** | `PlaybackControls.tsx` (~37 KB) | Play/Pause/Step buttons, speed selector, progress bar, keyboard shortcuts |
| **TradingPanel** | `TradingPanel.tsx` | BUY/SELL buttons, quantity input, current price display |

#### Analytics & Dialogs

| Component | File | Responsibility |
|-----------|------|----------------|
| **TradeHistoryDialog** | `TradeHistoryDialog.tsx` (~45 KB) | Full trade log with P&L, editing, deletion, win rate |
| **TradeJournalDialog** | `TradeJournalDialog.tsx` (~23 KB) | Journal entry form, auto-detects pivot patterns, R:R calculation |
| **TradeExitDialog** | `TradeExitDialog.tsx` (~10 KB) | Exit confirmation, reason selection (SL/TP/MANUAL/TIME_OVER) |
| **TradeReportDialog** | `TradeReportDialog.tsx` (~56 KB) | Equity curve, drawdown, monthly/daily breakdown, position analysis |
| **PerformanceDashboard** | `PerformanceDashboard.tsx` (~63 KB) | Live account positions, real P&L, ATM option chain, Greeks display |
| **OptionBacktestModal** | `OptionBacktestModal.tsx` (~13 KB) | Options strategy backtest from spot trades |

#### Chart Tools

| Component | File | Responsibility |
|-----------|------|----------------|
| **ChartToolbar** | `ChartToolbar.tsx` (~11 KB) | Drawing tool selector, indicator toggles, screenshot controls |
| **TimeframeSwitcher** | `TimeframeSwitcher.tsx` (~11 KB) | Primary/secondary timeframe picker, candle resampling |
| **PositionOverlay** | `PositionOverlay.tsx` (~6 KB) | Floating P&L overlay on chart canvas |
| **SessionStats** | `SessionStats.tsx` (~7 KB) | Realized + unrealized P&L, trade count, win rate display |

#### Utility Dialogs

| Component | File | Responsibility |
|-----------|------|----------------|
| **BackupHistoryDialog** | `BackupHistoryDialog.tsx` (~10 KB) | List/restore Firebase snapshots and auto-history |
| **ScreenshotSaveDialog** | `ScreenshotSaveDialog.tsx` (~4 KB) | Name and upload screenshot to Google Drive |
| **PromptDialog** | `PromptDialog.tsx` (~3 KB) | Generic single-field text prompt |
| **TextInputDialog** | `TextInputDialog.tsx` (~2 KB) | Reusable text input dialog |
| **NotificationToast** | `NotificationToast.tsx` (~1 KB) | Auto-dismiss toast notifications |

### 4.3 State Management — Zustand Stores

#### `sessionStore.ts` (core)

The heart of the application. Holds all backtesting state in memory.

**State shape (key fields):**

```typescript
candles: Candle[]            // Loaded historical data
currentIndex: number         // Current playback position
trades: Trade[]              // All executed trades
position: Position | null    // Current open position
instrument: string           // Selected instrument name
isPlaying: boolean
speed: number                // 0.5 – 10

// Chart settings
showSecondaryChart: boolean
secondaryTimeframe: string | null
secondaryCandles: Candle[]
primaryIndicators: string[]
secondaryIndicators: string[]
drawings: Drawing[]
activeChartId: 'primary' | 'secondary'
sharedActiveTool: DrawingTool

// Trade parameters
tradeQuantity: number
riskPerTrade: number
targetRR: number
autoExitTarget: boolean
manualLevels: { sl, target } | null
```

**Key actions:**

| Action | Description |
|--------|-------------|
| `loadCandles(candles, instrument, config)` | Load historical data, reset session |
| `play() / pause() / step(dir)` | Playback control |
| `executeTrade(type, qty, ...)` | Execute BUY/SELL, update position + P&L |
| `resetSession()` | Clear all trades and position |
| `saveCurrentSession()` | Persist to local storage |
| `saveRemoteSession()` | Push to Firebase Firestore |
| `loadRemoteSession()` | Pull from Firebase Firestore |
| `setDrawings(drawings)` | Update chart annotations |
| `toggleMarkers(chartId)` | Show/hide trade markers |

#### `liveStore.ts`

Holds live trading state: real-time price ticks, live account positions, WebSocket feed status.

#### `notificationStore.ts`

Toast notification queue: show/hide/auto-dismiss messages.

### 4.4 API Service — `api.ts`

Thin Axios wrapper. All calls target `http://127.0.0.1:3001` (configurable via `VITE_API_URL`).

```
GET  /api/data/candles          fetchCandles(params)
DELETE /api/data/cache          clearCache(params)
GET  /health                    healthCheck()
POST /api/screenshot/upload     uploadScreenshot(image, fileName)
POST /api/options/backtest      backtestOptions(params)
POST /api/live/order            placeLiveOrder(params)
POST /api/live/smart-exit       executeSmartExit(params)
GET  /api/live/atm-option       getATMOption(spotPrice, type, instrument)
GET  /api/live/positions        getLivePositions()
```

### 4.5 Firebase Service — `firebaseSessionService.ts`

Direct Firestore operations, no backend intermediary.

```
saveSession(state)          → doc "current_session" (auto-archives last 4)
loadSession()               → read "current_session"
restoreBackup(historyId)    → restore from auto-archive
saveSnapshot(name)          → named permanent checkpoint
deleteSnapshot(id)          → remove snapshot
listSnapshots()             → all named snapshots
listHistory()               → last 4 auto-archives
```

### 4.6 Utilities

| File | Exports |
|------|---------|
| `indicators.ts` | `calculateSMA`, `calculateEMA`, `calculatePivotPoints`, `calculateAlBrooks`, `calculateATR` |
| `pivotAnalysis.ts` | `analyzePivotForTrade` — auto-detects LLHH-Pivot + PivotPosition |
| `tradeAnalysis.ts` | `groupTradesIntoPositions`, `calculatePerformanceStats`, `recalculateTradesPnL` |
| `resampler.ts` | `resampleCandles(candles, fromInterval, toInterval)` |
| `formatters.ts` | `formatCurrency`, `formatDate` |
| `tradeStorage.ts` | `saveTradeSession`, `loadTradeSession` (local storage) |

### 4.7 Key TypeScript Types

```typescript
interface Candle {
  timestamp: number;
  open: number; high: number; low: number; close: number;
  volume: number;
}

interface Trade {
  id: string;
  timestamp: number;
  type: 'BUY' | 'SELL';
  price: number;
  quantity: number;
  instrument: string;
  pnl?: number;
}

interface Position {
  instrument: string;
  quantity: number;
  averagePrice: number;
  realizedPnL: number;
  unrealizedPnL: number;
}

interface TradeJournal {
  timestamp: number;
  entry: string;
  confidence: number;
  llhhPivot: string;      // e.g. "HH-HL"
  pivotPosition: string;  // e.g. "on-MA"
  notes: string;
}
```

---

## 5. Backend

### 5.1 Entry Point — `server.ts`

1. Load `.env`
2. Initialise SQLite database (`config/database.ts`)
3. Create HTTP server + attach Socket.io
4. Mount routes with CORS, JSON body parser (10 MB limit), request logger
5. Initialise Dhan client and Angel One in background (non-blocking)
6. Listen on `PORT` (default `3001`)
7. Graceful shutdown on `SIGINT`/`SIGTERM` (saves DB)

### 5.2 Routes

#### `GET /api/data/candles`
Fetch historical candlestick data.

| Query param | Required | Description |
|-------------|----------|-------------|
| `securityId` | yes | Dhan security ID |
| `exchangeSegment` | yes | `NSE_EQ`, `NSE_FNO`, `BSE_EQ` |
| `instrument` | yes | `EQUITY`, `INDEX`, `FUTIDX`, `FUTSTK` |
| `interval` | yes | `1`, `5`, `15`, `60` (minutes) |
| `fromDate` | yes | `YYYY-MM-DD` |
| `toDate` | yes | `YYYY-MM-DD` |

Response: `{ success: true, data: Candle[], count: number, cached: boolean }`

#### `DELETE /api/data/cache`
Clear SQLite cache. Optionally filter by `securityId`, `exchangeSegment`, `interval`.

#### `POST /api/live/order`
Place a real order on Dhan.

Body: `{ securityId, exchangeSegment, transactionType, quantity, price, orderType, productType }`

#### `POST /api/live/smart-exit`
Start 3-step chaser loop (async). Returns immediately.

Body: `{ securityId, exchangeSegment, transactionType, quantity, slPrice }`

#### `GET /api/live/atm-option`
Find nearest ATM option for live hedging.

Query: `price` (spot), `type` (`CE`/`PE`), `instrument` (`NIFTY`/`BANKNIFTY`)

Response: `{ tradingSymbol, securityId, ltp, expiry }`

#### `GET /api/live/positions`
Fetch real account positions from Dhan.

#### `POST /api/options/backtest`
Simulate options strategy over existing spot trades.

Body: `{ spotTrades[], offsetSell, offsetBuy, instrument }`

#### `POST /api/screenshot/upload`
Upload base64 image to Google Drive.

Body: `{ image: string (base64), fileName: string }`  
Response: `{ link: string }`

### 5.3 Services

#### `dhan.service.ts`
- `initDhanClient()` — creates Dhan client from env credentials
- `fetchHistoricalCandles(params)` — calls Dhan `/v2/charts/intraday` or `/v2/charts/historical`
- `placeOrder(params)` — place market/limit order
- `getOrderStatus(orderId)` — poll order status
- `modifyOrder(orderId, params)` — update price/type on pending order
- `getPositions()` — fetch live positions

#### `data.service.ts`
Wraps `dhan.service` with SQLite caching:
1. Check `candles` table for matching rows
2. On cache hit → return immediately
3. On miss → call Dhan API → insert rows → return

#### `backtest.engine.ts`
FIFO position tracker (used server-side only for options backtesting):

```
BUY  → avgPrice = (existing_cost + new_qty × new_price) / total_qty
SELL → pnl = (sale_price − avg_price) × qty_sold
       short selling blocked
```

#### `dhanMarketFeed.service.ts`
- Maintains Dhan WebSocket connection
- Emits price ticks to all Socket.io clients
- Exposes `getFeedStatus()` for monitoring

#### `smartExit.service.ts`
3-step order chaser (runs async after returning HTTP 200):

| Step | Condition | Action |
|------|-----------|--------|
| 1 | Initial | Limit order at 0.5% buffer from SL; wait 2 s |
| 2 | Unfilled | Modify to 2% buffer; wait 3 s |
| 3 | Still unfilled | Convert to market order |

#### `optionChain.service.ts`
1. Fetch available expiries from Dhan Option Chain API
2. Select nearest weekly expiry
3. Calculate ATM strike (round to nearest strike interval)
4. Resolve security ID from Symbol Master CSV
5. Fetch live LTP

#### `symbolMaster.service.ts`
Downloads and caches Dhan Scrip Master CSV. Used to resolve option security IDs by expiry + strike.

#### `googleDrive.service.ts`
OAuth2 upload of base64 image to a configured Drive folder. Returns a shareable link.

#### `angelone.service.ts`
- TOTP-based login for Angel One SmartAPI
- JWT session management
- Initialised in background; fails gracefully if credentials absent

#### `yahoo.service.ts`
Alternative data source (Yahoo Finance). Currently unused — Dhan is exclusive.

### 5.4 Logging

Winston logger (`utils/logger.ts`):
- Levels: `debug`, `info`, `warn`, `error`
- Outputs to console + log files
- Structured metadata on each entry

---

## 6. Frontend–Backend Communication

### 6.1 Loading Historical Data

```
User fills InstrumentSelector form
  └─► api.ts: GET /api/data/candles?securityId=...
        └─► data.service: check SQLite cache
              ├─► Cache hit  → return rows immediately
              └─► Cache miss → dhan.service.fetchHistoricalCandles()
                                 └─► Dhan API: POST /v2/charts/intraday
                               ← candles[]
                             save to SQLite
        ← { data: Candle[], cached: boolean }
  └─► sessionStore.loadCandles(candles, instrument, config)
  └─► AdvancedChart renders candlestick chart
```

### 6.2 Executing a Backtest Trade

All logic is **client-side only** — no HTTP call is made:

```
User clicks BUY/SELL
  └─► sessionStore.initiateTrade('BUY', qty)
  └─► TradeJournalDialog opens (optional journal entry)
  └─► sessionStore.executeTrade()
        ├─► FIFO position update
        ├─► P&L recalculation
        ├─► Trade marker added to chart
        └─► Zustand triggers re-render
```

### 6.3 Live Order Placement

```
User clicks live BUY/SELL in PerformanceDashboard
  └─► api.ts: POST /api/live/order
        └─► dhan.service.placeOrder()
              └─► Dhan API: POST /v2/orders
        ← { orderId, status, ... }
  └─► liveStore updates with order details
```

### 6.4 Real-time Price Feed (WebSocket)

```
Backend connects to Dhan Market Feed WebSocket on startup
  └─► On tick received → socket.io emit('tick', { token, price })
      
Frontend socket.io client listens for 'tick' events
  └─► liveStore.updatePrice(token, price)
  └─► PerformanceDashboard re-renders live price
```

### 6.5 Session Persistence

```
User clicks "Save Session"
  └─► sessionStore.saveRemoteSession()
        └─► firebaseSessionService.saveSession(state)
              ├─► Writes doc "current_session" to Firestore
              └─► Archives previous to "history_session_1/2/3/4"

App startup
  └─► firebaseSessionService.loadSession()
        └─► Reads "current_session"
        └─► sessionStore.loadCandles() + restores trades/position
```

---

## 7. Database

**Engine:** SQLite via `sql.js` (in-memory with file persistence)  
**File:** `backend/data/backtesting.db`  
**Auto-save:** Every 5 minutes + on process shutdown

### Schema

```sql
-- Cached candle data
CREATE TABLE candles (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  security_id      TEXT    NOT NULL,
  exchange_segment TEXT    NOT NULL,
  instrument       TEXT    NOT NULL,
  interval         TEXT    NOT NULL,
  timestamp        INTEGER NOT NULL,
  open             REAL    NOT NULL,
  high             REAL    NOT NULL,
  low              REAL    NOT NULL,
  close            REAL    NOT NULL,
  volume           INTEGER NOT NULL,
  created_at       INTEGER DEFAULT (strftime('%s', 'now')),
  UNIQUE(security_id, exchange_segment, interval, timestamp)
);

CREATE INDEX idx_candles_lookup
  ON candles(security_id, exchange_segment, interval, timestamp);

-- Instrument metadata
CREATE TABLE instruments (
  security_id      TEXT PRIMARY KEY,
  exchange_segment TEXT    NOT NULL,
  instrument_type  TEXT    NOT NULL,
  symbol           TEXT    NOT NULL,
  name             TEXT,
  lot_size         INTEGER
);

CREATE INDEX idx_instruments_search ON instruments(symbol, name);
```

---

## 8. External Integrations

### Dhan API
- **Purpose:** Historical OHLCV data, live order placement, real-time WebSocket market feed
- **Auth:** Bearer token (`DHAN_ACCESS_TOKEN`) + client ID
- **Endpoints used:**
  - `POST /v2/charts/intraday` — minute-level candles
  - `POST /v2/charts/historical` — daily candles
  - `POST /v2/orders` — place order
  - `PUT /v2/orders/{id}` — modify order
  - `GET /v2/positions` — live positions
  - WebSocket: real-time tick feed

### Angel One SmartAPI
- **Purpose:** Alternative historical data source (currently disabled)
- **Auth:** TOTP-based login generating JWT session
- **Fallback only** — Dhan is primary

### Firebase Firestore
- **Purpose:** Session persistence across browser sessions/devices
- **Auth:** Firebase Web SDK (API key in frontend `.env`)
- **Collections:** `sessions/current_session`, `sessions/history_*`, `sessions/snapshots/*`

### Google Drive API
- **Purpose:** Screenshot storage with shareable links
- **Auth:** OAuth2 service account
- **Folder:** Configurable via `GOOGLE_DRIVE_FOLDER_ID`

---

## 9. Environment Configuration

### Backend `.env`

```env
# Dhan (required for data & live trading)
DHAN_ACCESS_TOKEN=your_token
DHAN_CLIENT_ID=your_client_id

# Angel One (optional fallback)
ANGELONE_API_KEY=
ANGELONE_CLIENT_CODE=
ANGELONE_PASSWORD=
ANGELONE_TOTP=

# Server
PORT=3001
NODE_ENV=development

# Google Drive (optional)
GOOGLE_DRIVE_FOLDER_ID=
```

### Frontend `.env`

```env
# Backend URL
VITE_API_URL=http://127.0.0.1:3001

# Firebase (required for session persistence)
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
```

---

## 10. Setup & Running

### Prerequisites
- Node.js v18+
- Dhan API credentials
- Firebase project (for session persistence)

### Backend

```bash
cd backend
npm install
cp .env.example .env   # fill in credentials
npm run dev            # development with hot-reload (nodemon)
npm run build          # compile TypeScript → dist/
npm start              # run compiled build
```

Default port: **3001**

### Frontend

```bash
cd frontend
npm install
# create .env with VITE_API_URL and Firebase vars
npm run dev            # Vite dev server → http://localhost:5173
npm run build          # production build → dist/
npm run preview        # preview production build
```

Default port: **5173**

### Verify

1. Backend health: `GET http://localhost:3001/health`
2. Open `http://localhost:5173` in browser
3. Enter a security ID and date range in the Instrument Selector
4. Click **Load** — chart should render with candles
