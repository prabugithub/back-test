# Manual Backtesting System for Indian Stock Market

A web-based manual backtesting application for Indian stock market (NSE/BSE) that allows you to replay historical price data and manually execute trades. Built with Node.js, Express, React, and integrated with **Angel One SmartAPI (FREE)** for fetching historical candle data.

## Features

### Current (MVP)
- 📊 **Visual Candlestick Charts** - TradingView Lightweight Charts integration
- ▶️ **Playback Controls** - Play/Pause, Step forward/backward, Speed control (0.5x to 10x)
- 💹 **Manual Trading** - Execute BUY/SELL orders at current candle close price
- 📈 **Position Tracking** - Real-time position and P&L calculation (FIFO method)
- 📋 **Trade History** - Complete session trade log with P&L per trade
- 💾 **Data Caching** - SQLite caching for fast data reload
- ⌨️ **Keyboard Shortcuts** - Space (Play/Pause), Arrow keys (Step)
- 🔄 **5-Minute Candles** - Primary timeframe support

### Supported Instruments
- Stocks (NSE/BSE Equity)
- Nifty Index
- Bank Nifty Index
- Index Futures
- Stock Futures

## Tech Stack

### Backend
- **Node.js** + **Express.js** + **TypeScript**
- **SQLite** (sql.js) for data caching
- **Angel One SmartAPI** (FREE) for historical data
- **Winston** for logging
- **date-fns** for date manipulation

### Frontend
- **React 18** + **Vite** + **TypeScript**
- **Zustand** for state management
- **TanStack Query** (React Query) for data fetching
- **Lightweight Charts** (TradingView) for candlestick charts
- **Tailwind CSS** for styling
- **Lucide React** for icons

## Project Structure

```
back-test/
├── backend/
│   ├── src/
│   │   ├── config/
│   │   │   └── database.ts          # SQLite configuration
│   │   ├── services/
│   │   │   ├── angelone.service.ts  # Angel One API wrapper
│   │   │   ├── data.service.ts      # Data fetching & caching
│   │   │   └── backtest.engine.ts   # Trade execution engine
│   │   ├── routes/
│   │   │   └── data.routes.ts       # API endpoints
│   │   ├── types/
│   │   │   └── index.ts             # TypeScript types
│   │   ├── utils/
│   │   │   ├── logger.ts            # Winston logger
│   │   │   └── date-helpers.ts      # Date utilities
│   │   └── server.ts                # Express app
│   ├── data/
│   │   └── backtesting.db           # SQLite database
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── CandlestickChart.tsx
│   │   │   ├── PlaybackControls.tsx
│   │   │   ├── TradingPanel.tsx
│   │   │   ├── SessionStats.tsx
│   │   │   └── InstrumentSelector.tsx
│   │   ├── stores/
│   │   │   └── sessionStore.ts      # Zustand session state
│   │   ├── services/
│   │   │   └── api.ts               # Backend API client
│   │   ├── types/
│   │   │   └── index.ts             # TypeScript types
│   │   ├── utils/
│   │   │   └── formatters.ts        # Formatting utilities
│   │   └── App.tsx
│   └── package.json
└── README.md
```

## Setup Instructions

### Prerequisites
- **Node.js** v18+ (LTS recommended)
- **npm** (comes with Node.js)
- **Angel One Account** with SmartAPI access (FREE)

### Step 1: Clone the Repository

```bash
git clone <repository-url>
cd back-test
```

### Step 2: Get Angel One API Credentials

**See [ANGELONE_SETUP.md](ANGELONE_SETUP.md) for detailed setup instructions.**

Quick steps:
1. Register at [SmartAPI Portal](https://smartapi.angelbroking.com/)
2. Create an app and get your **API Key**
3. Note your **Client Code** (trading account ID)
4. Your Angel One **Password**
5. Enable TOTP and save the **TOTP Secret**

### Step 3: Backend Setup

```bash
cd backend

# Install dependencies
npm install

# Create .env file
cp .env.example .env

# Edit .env and add your Angel One credentials:
# ANGELONE_API_KEY=your_api_key_here
# ANGELONE_CLIENT_CODE=your_client_code_here
# ANGELONE_PASSWORD=your_password_here
# ANGELONE_TOTP=your_totp_secret_here
# PORT=3001
# NODE_ENV=development
```

### Step 4: Frontend Setup

```bash
cd frontend

# Install dependencies
npm install
```

### Step 5: Run the Application

Open two terminal windows:

**Terminal 1 - Backend:**
```bash
cd backend
npm run dev
```

Backend will start on `http://localhost:3001`

**Terminal 2 - Frontend:**
```bash
cd frontend
npm run dev
```

Frontend will start on `http://localhost:5173`

### Step 6: Access the Application

Open your browser and navigate to: `http://localhost:5173`

## Usage Guide

### 1. Loading Data

1. Enter **Symbol Token** (e.g., `2885` for RELIANCE, `1594` for INFY, `3045` for SBIN)
2. Select **Exchange Segment** (NSE_EQ, NSE_FNO, BSE_EQ)
3. Choose **Instrument Type** (EQUITY, INDEX, FUTIDX, FUTSTK)
4. Set **Interval** (1, 5, 15, or 60 minutes)
5. Select **Date Range** (Max 90 days per request due to API limits)
6. Click **Fetch Data**

Common Symbol Tokens (Angel One):
- RELIANCE: `2885`
- INFOSYS: `1594`
- TCS: `11536`
- SBIN: `3045`
- HDFC BANK: `1333`
- NIFTY 50: `99926000`
- BANK NIFTY: `99926009`

**Find more tokens**: Download [Instrument Master](https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json)

### 2. Backtesting Controls

**Playback Controls:**
- **Play/Pause Button** - Start/stop automatic candle progression
- **Step Backward (←)** - Go back one candle
- **Step Forward (→)** - Advance one candle
- **Speed Selector** - Control playback speed (0.5x, 1x, 2x, 5x, 10x)
- **Progress Bar** - Shows current position in the dataset

**Keyboard Shortcuts:**
- `Space` - Play/Pause
- `←` - Step backward
- `→` - Step forward

### 3. Trading

**Executing Trades:**
1. Set **Quantity** (number of shares)
2. Click **BUY** to buy at current candle's close price
3. Click **SELL** to sell at current candle's close price

**Position Tracking:**
- Average Price calculated using weighted average
- P&L updated in real-time
- FIFO (First In First Out) method for position management

### 4. Session Statistics

The right panel shows:
- **Current Position** - Quantity and average price
- **Unrealized P&L** - Mark-to-market profit/loss
- **Realized P&L** - Profit/loss from closed trades
- **Win Rate** - Percentage of profitable trades
- **Trade History** - Complete log of all trades with P&L

### 5. Resetting Session

Click **Reset Session** to:
- Clear all trades
- Reset position to zero
- Return to first candle
- Keep loaded candle data

Click **Load Different Data** to fetch new data.

## API Endpoints

### Backend API

**Base URL:** `http://localhost:3001`

#### GET /api/data/candles
Fetch candles with caching.

**Query Parameters:**
- `securityId` - Symbol Token (e.g., "2885" for RELIANCE)
- `exchangeSegment` - Exchange segment (e.g., "NSE_EQ")
- `instrument` - Instrument type (e.g., "EQUITY")
- `interval` - Candle interval (e.g., "5")
- `fromDate` - Start date (YYYY-MM-DD)
- `toDate` - End date (YYYY-MM-DD)

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "timestamp": 1704096900,
      "open": 2456.50,
      "high": 2458.75,
      "low": 2455.00,
      "close": 2457.80,
      "volume": 125000
    }
  ],
  "count": 1000,
  "cached": false
}
```

#### DELETE /api/data/cache
Clear cached data.

#### GET /health
Health check endpoint.

## Development

### Backend Development

```bash
cd backend
npm run dev    # Start with hot reload
npm run build  # Build TypeScript
npm start      # Run production build
```

### Frontend Development

```bash
cd frontend
npm run dev    # Start dev server with hot reload
npm run build  # Build for production
npm run preview # Preview production build
```

## Architecture

### Data Flow

1. **Loading Candles:**
   - Frontend → Backend API → Check SQLite cache
   - If not cached → Fetch from Angel One API → Store in cache
   - Return candles → Frontend stores in Zustand + React Query

2. **Backtesting Session:**
   - User clicks Play → Timer advances `currentCandleIndex`
   - Chart displays `candles[0...currentIndex]`
   - User executes trade → Execute at `candles[currentIndex].close`
   - Update position in Zustand → Recalculate P&L

### State Management

**Zustand Store** (frontend/src/stores/sessionStore.ts):
- Manages all session state (candles, trades, position, playback)
- Client-side only (no persistence)
- Computed getters for P&L calculations

### Database Schema

**SQLite Tables:**

```sql
-- Candles cache
CREATE TABLE candles (
  security_id TEXT,
  exchange_segment TEXT,
  interval TEXT,
  timestamp INTEGER,
  open REAL,
  high REAL,
  low REAL,
  close REAL,
  volume INTEGER,
  UNIQUE(security_id, exchange_segment, interval, timestamp)
);

-- Instruments (future use)
CREATE TABLE instruments (
  security_id TEXT PRIMARY KEY,
  exchange_segment TEXT,
  symbol TEXT,
  name TEXT
);
```

## Troubleshooting

### Backend Issues

**"Angel One API client initialization failed"**
- Check if `.env` file exists in backend directory
- Verify `ANGELONE_API_KEY`, `ANGELONE_CLIENT_CODE`, `ANGELONE_PASSWORD`, and `ANGELONE_TOTP` are set correctly
- Ensure TOTP secret is the base32 secret key, not the 6-digit OTP code
- See [ANGELONE_SETUP.md](ANGELONE_SETUP.md) for detailed troubleshooting

**"Database not initialized"**
- Ensure `backend/data/` directory exists
- Check file permissions

### Frontend Issues

**"Failed to fetch data"**
- Verify backend is running on port 3001
- Check browser console for CORS errors
- Ensure backend URL is correct in `frontend/src/services/api.ts`

**Chart not displaying**
- Ensure data is loaded successfully
- Check browser console for JavaScript errors
- Verify `lightweight-charts` package is installed

### Angel One API Issues

**"No data received"**
- Verify Symbol Token is correct (check [Instrument Master](https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json))
- Check date range (max 90 days)
- Ensure market was open on selected dates (Mon-Fri, not holidays)
- Verify exchange is correct (NSE vs BSE)
- Try a different interval or instrument

**"Login failed" or "TOTP validation failed"**
- TOTP secret must be the base32 secret key, not the 6-digit OTP code
- Verify your Angel One password is correct
- Check Client Code matches your trading account ID
- Re-enable TOTP and save the new secret if issues persist

## Future Enhancements

Planned features (not in MVP):

### Phase 2.0 - Multi-Timeframe
- Support for 1min, 15min, 1hour, daily candles
- Dynamic timeframe switching during replay
- Multi-timeframe synchronization

### Phase 2.1 - Advanced Trading
- Limit orders, Stop loss, Take profit
- Slippage modeling
- Brokerage and tax calculation
- Position sizing calculator

### Phase 2.2 - Automated Backtesting
- Code custom strategies (JavaScript DSL)
- Batch testing across instruments
- Performance metrics (Sharpe ratio, max drawdown)
- Equity curve visualization

### Phase 2.3 - Technical Indicators
- Moving averages (SMA, EMA)
- Oscillators (RSI, MACD, Stochastic)
- Drawing tools (trendlines, support/resistance)
- Multi-chart layouts

### Phase 2.4 - Persistence & Analytics
- Save/load backtesting sessions
- Export reports (PDF, CSV)
- Session replay feature
- Performance analytics dashboard

## License

MIT

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

## Support

For issues or questions:
- Open an issue on GitHub
- Check Angel One API documentation: https://smartapi.angelbroking.com/docs
- Email Angel One support: smartapi@angelbroking.com

## Acknowledgments

- **Angel One** for providing FREE API access to historical data
- **TradingView** for Lightweight Charts library
- **Indian Stock Market** community

---

**Happy Backtesting! 📈**
