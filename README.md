# Manual Backtesting System — Indian Stock Market

A full-stack web application for manual backtesting and live trading of Indian equities and derivatives (NSE/BSE). Replay historical candlestick data candle-by-candle, execute simulated trades, and optionally route live orders through Dhan.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + TypeScript + Vite |
| State | Zustand 5 |
| Charts | TradingView Lightweight Charts 5 |
| Styling | Tailwind CSS 4 |
| Backend | Node.js + Express 4 + TypeScript |
| Database | SQLite (sql.js, file-persisted) |
| Real-time | Socket.io 4 |
| Session Persistence | Firebase Firestore |
| Market Data | Angel One SmartAPI (historical) + Dhan API (live) |
| Cloud Storage | Google Drive API (screenshots) |

---

## Architecture

```
Browser (React SPA)
       │
       │  HTTP REST + Socket.io WebSocket
       ▼
Express API Server  (:3001)
       │
       ├── SQLite cache  (backtesting.db — candles only)
       │
       ├── Angel One SmartAPI  (historical candle data)
       ├── Dhan API            (live orders, WebSocket tick feed)
       └── Google Drive API    (screenshot upload)

Session Persistence (client → cloud, no backend):
  Browser ──► Firebase Firestore  (trades, position, drawings, settings)
```

All trade execution logic (FIFO, P&L) runs **client-side** in Zustand. The backend handles data fetching, caching, and live order routing only.

---

## Project Structure

```
back-test/
├── backend/
│   ├── src/
│   │   ├── config/
│   │   │   └── database.ts              # SQLite init, schema, auto-save
│   │   ├── routes/
│   │   │   ├── data.routes.ts           # GET /api/data/candles, cache clear
│   │   │   ├── live.routes.ts           # Orders, smart-exit, positions, ATM option
│   │   │   ├── options.routes.ts        # POST /api/options/backtest
│   │   │   └── screenshot.routes.ts     # POST /api/screenshot/upload
│   │   ├── services/
│   │   │   ├── angelone.service.ts      # Angel One SmartAPI auth + candle fetch
│   │   │   ├── data.service.ts          # Cache-aware candle fetching
│   │   │   ├── dhan.service.ts          # Dhan REST (orders, positions)
│   │   │   ├── dhanMarketFeed.service.ts# Dhan WebSocket tick feed
│   │   │   ├── smartExit.service.ts     # 3-step order chaser loop
│   │   │   ├── optionChain.service.ts   # ATM option lookup
│   │   │   ├── symbolMaster.service.ts  # Dhan scrip master CSV
│   │   │   ├── backtest.options.service.ts # Options P&L simulation
│   │   │   └── googleDrive.service.ts   # OAuth2 Drive upload
│   │   ├── types/index.ts
│   │   ├── utils/
│   │   │   ├── logger.ts                # Winston logger
│   │   │   └── date-helpers.ts
│   │   └── server.ts                    # Express entry point
│   ├── data/backtesting.db              # SQLite file (auto-created)
│   └── package.json
│
├── frontend/
│   ├── src/
│   │   ├── components/                  # ~20 React components
│   │   ├── stores/
│   │   │   ├── sessionStore.ts          # Core backtesting state (critical)
│   │   │   ├── liveStore.ts             # Live trading state
│   │   │   └── notificationStore.ts     # Toast queue
│   │   ├── services/
│   │   │   ├── api.ts                   # Axios HTTP client
│   │   │   └── firebaseSessionService.ts# Firestore save/restore
│   │   ├── hooks/
│   │   │   └── useChartDrawings.ts      # Canvas drawing interaction
│   │   ├── utils/
│   │   │   ├── indicators.ts            # SMA, EMA, Pivot, Al Brooks, ATR
│   │   │   ├── pivotAnalysis.ts         # LLHH-Pivot + PivotPosition detection
│   │   │   ├── tradeAnalysis.ts         # P&L stats, position grouping
│   │   │   ├── resampler.ts             # Multi-timeframe candle resampling
│   │   │   ├── formatters.ts            # Currency, date formatters
│   │   │   └── tradeStorage.ts          # localStorage fallback
│   │   ├── config/firebase.ts
│   │   ├── types/index.ts               # Candle, Trade, Position, Drawing, etc.
│   │   └── App.tsx                      # Root layout, dialog orchestration
│   └── package.json
│
├── README.md                            # This file
├── CLAUDE.md                            # Claude Code instructions
├── IMPACT.md                            # Component dependency + impact map
├── FEATURES_GUIDE.md                    # Complete user-facing feature reference
├── INDICATORS_LOGIC.md                  # Indicator math + pivot position logic
├── ANGELONE_SETUP.md                    # Angel One API credentials setup
├── ANGEL_ONE_TOKENS.md                  # Symbol token lookup
├── FIREBASE_SETUP.md                    # Firebase project setup
└── GOOGLE_DRIVE_SETUP.md                # Google Drive service account setup
```

---

## Setup

### Prerequisites

- Node.js v18+
- Angel One account with SmartAPI access (for historical data)
- Firebase project (for session persistence) — see `FIREBASE_SETUP.md`
- Dhan account with API access (optional — for live trading only)
- Google Cloud service account (optional — for screenshot upload)

### Backend

```bash
cd backend
npm install
cp .env.example .env   # fill in credentials (see Environment section below)
npm run dev            # dev server with hot-reload on :3001
```

### Frontend

```bash
cd frontend
npm install
# create frontend/.env with VITE_API_URL and Firebase vars
npm run dev            # Vite dev server on :5173
```

### Verify

1. `GET http://localhost:3001/health` → should return `{ status: "ok" }`
2. Open `http://localhost:5173`
3. Select a symbol, date range, and click Load Data

---

## Environment Variables

### `backend/.env`

```env
# Angel One (required for historical data)
ANGELONE_API_KEY=
ANGELONE_CLIENT_CODE=
ANGELONE_PASSWORD=
ANGELONE_TOTP=

# Dhan (required for live trading)
DHAN_ACCESS_TOKEN=
DHAN_CLIENT_ID=

# Server
PORT=3001
NODE_ENV=development

# Google Drive (optional — screenshot upload)
GOOGLE_DRIVE_FOLDER_ID=
```

### `frontend/.env`

```env
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

## Documentation

| Document | Purpose |
|----------|---------|
| `FEATURES_GUIDE.md` | Every user-facing feature — what it does, which component owns it |
| `IMPACT.md` | What breaks when you change X — read before any non-trivial change |
| `INDICATORS_LOGIC.md` | Math for SMA, EMA, Al Brooks, ATR, Pivot Position detection |
| `CLAUDE.md` | Instructions for Claude Code (AI assistant) |
| `ANGELONE_SETUP.md` | Step-by-step Angel One SmartAPI credential setup |
| `ANGEL_ONE_TOKENS.md` | Security ID lookup for popular NSE/BSE instruments |
| `FIREBASE_SETUP.md` | Firebase project + Firestore rules setup |
| `GOOGLE_DRIVE_SETUP.md` | Service account setup for screenshot upload |
