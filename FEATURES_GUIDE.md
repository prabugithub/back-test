# Features Guide — Manual Backtesting System

A complete reference of every feature available in the application.

---

## Table of Contents

1. [Data Loading](#1-data-loading)
2. [Chart Rendering](#2-chart-rendering)
3. [Technical Indicators](#3-technical-indicators)
4. [Drawing Tools](#4-drawing-tools)
5. [Playback & Navigation](#5-playback--navigation)
6. [Trade Execution (Backtesting)](#6-trade-execution-backtesting)
7. [Position Tracking & P&L](#7-position-tracking--pl)
8. [Trade Journal](#8-trade-journal)
9. [Session Statistics](#9-session-statistics)
10. [Trade History](#10-trade-history)
11. [Performance Report](#11-performance-report)
12. [Multi-Timeframe Analysis](#12-multi-timeframe-analysis)
13. [Options Backtesting](#13-options-backtesting)
14. [Session Persistence](#14-session-persistence)
15. [Screenshots](#15-screenshots)
16. [Live Trading](#16-live-trading)
17. [Smart Exit (Order Chaser)](#17-smart-exit-order-chaser)
18. [Keyboard Shortcuts](#18-keyboard-shortcuts)

---

## 1. Data Loading

**Component:** `InstrumentSelector`

Load historical candlestick data to backtest against.

### Parameters

| Field | Options | Notes |
|-------|---------|-------|
| Security ID | Any Dhan security ID | e.g. `1333` for HDFC Bank |
| Exchange Segment | `NSE_EQ`, `NSE_FNO`, `BSE_EQ` | |
| Instrument Type | `EQUITY`, `INDEX`, `FUTIDX`, `FUTSTK` | |
| Timeframe | 1 min, 5 min, 15 min, 60 min | |
| From Date | Any past date | Max 90 days per request |
| To Date | Any past date | |
| Data Source | API or Local | Local = from SQLite cache |

### Caching

- First load fetches from Dhan API and stores in SQLite
- Subsequent loads for the same symbol/interval/date range return instantly from cache
- Cache can be cleared per symbol or in full via `DELETE /api/data/cache`

---

## 2. Chart Rendering

**Component:** `AdvancedChart`  
**Library:** TradingView Lightweight Charts v5

### What is rendered

- **Candlestick series** — open, high, low, close per candle
- **Volume histogram** — below main chart
- **Indicator overlays** — on top of price (SMA, EMA, Pivot, Al Brooks)
- **Trade markers** — coloured triangles at entry/exit points
- **Drawing layers** — canvas overlay for user drawings
- **SL/TP lines** — horizontal lines when a position is open

### Interaction

- Scroll to zoom in/out
- Click and drag to pan
- Chart auto-scales to visible candles
- Responsive to container resize

---

## 3. Technical Indicators

All indicators are calculated client-side and update as candles advance.

### SMA (Simple Moving Average)

- Periods available: **20, 50**
- Toggle: ChartToolbar
- Formula: `SMA(n) = sum(close[i-n+1 .. i]) / n`

### EMA (Exponential Moving Average)

- Periods available: **20, 50**
- Toggle: ChartToolbar
- Formula: `EMA(i) = (close[i] − EMA(i-1)) × (2/(n+1)) + EMA(i-1)`
- Initialised with SMA for first period

### Pivot Points (Reversal Detection)

Auto-marks reversal pivots on the chart.

| Label | Condition |
|-------|-----------|
| Bullish pivot | `close > prev_high` AND `close > open` |
| Bearish pivot | `close < prev_low` AND `close < open` |

Each pivot marker shows:
- Entry price
- Suggested SL (lowest/highest of current + previous candle ± 2 pts)
- SL distance

### Al Brooks H/L System

Pullback counting for trend-following setups.

- **H system (Bull context):** Counts H1, H2, H3 pullbacks in uptrends
  - A pullback starts when a bearish candle appears
  - "H" fires when a bullish candle closes above the previous bullish high
- **L system (Bear context):** Mirror logic for downtrends (L1, L2, L3)

Labels appear on the chart at each H/L event.

### ATR (Average True Range)

- Period: 14 (default)
- Displayed in a separate panel below volume
- Used internally for SL calculations

---

## 4. Drawing Tools

**Component:** `ChartToolbar` + `useChartDrawings` hook

All drawings persist in the Zustand store and save with the session.

| Tool | How to use | Description |
|------|-----------|-------------|
| **Trendline** | Click two points | Draws a line between two price levels |
| **Horizontal Line** | Click one point | Extends a horizontal level across the chart |
| **Rectangle** | Click and drag | Highlights a price-time zone |
| **Fibonacci Retracement** | Click high and low | Auto-draws 7 fib levels (0, 23.6, 38.2, 50, 61.8, 78.6, 100%) |
| **Risk/Reward Tool** | Click entry, drag | Visualises risk:reward ratio with coloured zones |
| **Callout / Text** | Click a candle | Adds an annotation label at that point |

### Managing Drawings

- **Select** a drawing to move/resize it
- **Delete** selected drawing via toolbar or Delete key
- **Clear All** button removes all drawings from active chart
- Drawings are saved with session and restored on reload

### Auto-save

Drawings are automatically saved to Firestore **2 seconds after any change** (add, move, resize, delete) using a lightweight patch (`updateDoc`) that does not rotate the session history. This means drawings survive a page refresh or live chart reload without requiring a manual Save.

> **Note:** The auto-save patch requires a session document to already exist in Firestore. If you have never manually saved a session, drawings will not persist across page reloads until the first manual save is done.

### Undo (Ctrl+Z)

Up to **5 drawing actions** can be undone with `Ctrl+Z` (or `Cmd+Z` on Mac). Each of the following counts as one undo step:

| Action | Undoable |
|--------|---------|
| Draw a new shape | Yes |
| Delete a drawing | Yes |
| Move (drag) a drawing | Yes — captures state before drag |
| Resize a drawing | Yes — captures state before resize |

Ctrl+Z is ignored when the cursor is inside a text input or textarea (native browser undo still works there).

---

## 5. Playback & Navigation

**Component:** `PlaybackControls`

Simulate real-time market replay candle-by-candle.

### Controls

| Button | Action |
|--------|--------|
| Play ▶ | Auto-advance candles at selected speed |
| Pause ⏸ | Stop auto-advance |
| Step Forward ▶| | Advance one candle |
| Step Backward |◀ | Go back one candle |
| Jump to start | Reset to first candle |
| Jump to end | Skip to last candle |

### Speed Options

`0.5×`, `1×`, `2×`, `3×`, `5×`, `10×`

At 1× speed, one candle advances per second. At 10×, ten candles per second.

### Progress Bar

- Shows current position as percentage of total candles
- Click anywhere on the bar to jump to that position

### SL/TP Auto-Exit

When `autoExitTarget` is enabled in settings, the chart checks on every candle advance whether:
- The candle's low/high breaches the set Stop Loss → auto-executes exit at SL price
- The candle's high/low breaches the Target → auto-executes exit at TP price

### Settings Panels

Two separate panels are accessible from the control bar:

#### Data Settings (gear icon ⚙️)

Requires **"Load Data"** to apply.

| Field | Description |
|-------|-------------|
| Timeframe | 1 min / 5 min / 15 min / 30 min / 60 min / 4H / Daily |
| From Date | Start of data range |
| To Date | End of data range |
| Jump To Date | Loads full range but starts playback at this date |

#### Trade Settings (sliders icon ▤)

All changes apply **immediately** — no button needed.

| Setting | Description |
|---------|-------------|
| Target RR Ratio (1:X) | Risk-reward multiplier for TP calculation (default: 2) |
| Auto Exit Target (TP) | When enabled, auto-exits position when TP is hit; when disabled, shows dialog |
| Show Parallel Timeframe | Toggle secondary chart + select its timeframe |

**Mid-trade RR adjustment:** Changing Target RR while a position is open recalculates `position.target` in real-time, so the TP line on the overlay and the auto-exit check both update immediately. This is intentional — you can raise the RR if price action is stronger than expected.

> Guard: if SL/TP were set via the drawing tool (manual levels), changing RR does **not** overwrite them.

---

## 6. Trade Execution (Backtesting)

**Component:** `TradingPanel`  
**Store:** `sessionStore.executeTrade()`

Trades are fully simulated — no real money involved.

### Entering a Trade

1. Set **quantity** in the TradingPanel
2. Click **BUY** or **SELL**
3. A **TradeJournalDialog** opens (optional) to record notes
4. A **TradeExitDialog** confirms exit reason when closing

### Trade Parameters

- **Entry price:** Close price of the current candle
- **Quantity:** User-defined
- **Direction:** BUY (long) or SELL (to close long)
- **Short selling:** Not supported — you cannot sell more than your position

### Manual SL/TP Levels

- Set SL and Target prices in the TradingPanel
- Lines are drawn on the chart
- Enable `autoExitTarget` for automatic execution when levels are hit

---

## 7. Position Tracking & P&L

**Store:** `sessionStore`  
**Component:** `PositionOverlay`, `SessionStats`

### Position Calculation (FIFO)

```
Opening a position (BUY):
  total_cost = (existing_qty × avg_price) + (new_qty × new_price)
  avg_price  = total_cost / (existing_qty + new_qty)

Closing a position (SELL):
  realized_pnl = (exit_price − avg_price) × qty_sold

Unrealized P&L (while position is open):
  unrealized_pnl = (current_close − avg_price) × current_qty
```

### What is displayed

| Metric | Location |
|--------|----------|
| Current quantity + avg price | PositionOverlay on chart |
| Unrealized P&L | PositionOverlay, SessionStats |
| Realized P&L | SessionStats |
| Total P&L (Realized + Unrealized) | SessionStats, PlaybackControls |
| Win rate | SessionStats |

---

## 8. Trade Journal

**Component:** `TradeJournalDialog`

Attach structured notes to each trade at the time of entry.

### Auto-Detected Fields

The system analyses the last few candles before your entry and auto-fills:

#### LLHH-Pivot
Identifies the market structure leading into your trade:

| Value | Meaning |
|-------|---------|
| `HH-HL` | Higher High followed by Higher Low (bull trend) |
| `LH-LL` | Lower High followed by Lower Low (bear trend) |
| `HH-LL` | Higher High then Lower Low (reversal in progress) |
| `LH-HL` | Lower High then Higher Low (consolidation/reversal) |

#### PivotPosition
Describes where the entry candle sits relative to the EMA:

| Value | Meaning |
|-------|---------|
| `gap` | All candles since pivot close on the same side as your trade — breakout entry |
| `on-MA` | At least one candle wick touched the EMA — pullback to MA entry |
| `gap-opposite` | All candles close opposite to your trade direction — counter-trend or early entry |

### Manual Fields

- **Confidence level** (1–5)
- **Notes** (free text)
- **Exit reason** — `SL`, `TP`, `MANUAL`, `TIME_OVER`
- **R:R Ratio** (auto-calculated from SL/Target)

---

## 9. Session Statistics

**Component:** `SessionStats`

Live summary always visible during a session.

| Metric | Description |
|--------|-------------|
| Realized P&L | Sum of all closed trade P&Ls |
| Unrealized P&L | Current open position P&L at current candle close |
| Total P&L | Realized + Unrealized |
| Trade Count | Total number of completed round-trips |
| Win Rate | % of trades with positive P&L |
| Current Position | Quantity and average entry price |

---

## 10. Trade History

**Component:** `TradeHistoryDialog`

Full log of every trade executed in the session.

### Columns

| Column | Description |
|--------|-------------|
| # | Trade number |
| Time | Candle timestamp |
| Type | BUY / SELL |
| Price | Execution price |
| Qty | Quantity |
| P&L | Realized profit/loss on close |
| Journal | LLHH-Pivot and PivotPosition if recorded |

### Actions

- **Edit trade** — modify price, quantity, or notes
- **Delete trade** — remove and recalculate all subsequent P&Ls
- **Jump to candle** — click a trade to jump the chart to that candle
- **Sort** by any column
- **P&L recalculation** propagates correctly through all subsequent trades when one is edited

---

## 11. Performance Report

**Component:** `TradeReportDialog`

Deep-dive analytics over all trades in the current session.

### Metrics

| Metric | Description |
|--------|-------------|
| Total P&L | Net profit/loss |
| Win Rate | % profitable trades |
| Profit Factor | Gross profit ÷ gross loss |
| Average Win | Mean P&L on winning trades |
| Average Loss | Mean P&L on losing trades |
| Max Drawdown | Largest peak-to-trough drop in equity |
| Consecutive Wins/Losses | Longest streaks |
| Average R:R | Mean risk-reward ratio achieved |

### Charts & Tables

- **Equity Curve** — cumulative P&L plotted over time
- **Drawdown Chart** — drawdown depth over time
- **Monthly Breakdown** — P&L aggregated by month
- **Daily Breakdown** — P&L by day of week
- **Position Analysis** — size, hold time, and performance by position

---

## 12. Multi-Timeframe Analysis

**Component:** `TimeframeSwitcher`, `AdvancedChart` (secondary instance)

View two timeframes simultaneously for top-down analysis.

### How to enable

1. Toggle **Show Secondary Chart** in settings or toolbar
2. Select a **secondary timeframe** (independent from primary)
3. Candles are resampled client-side from the loaded primary data

### Secondary chart features

- Independent indicator set
- Independent drawing layer
- Shared playback position (advances in sync with primary)
- Shared drawing toolbar selection

---

## 13. Options Backtesting

**Component:** `OptionBacktestModal`  
**Endpoint:** `POST /api/options/backtest`

Simulate an options strategy layered over your spot backtest trades.

### Inputs

| Field | Description |
|-------|-------------|
| Spot Trades | Auto-populated from current session |
| Offset Buy | Price offset applied to buy legs |
| Offset Sell | Price offset applied to sell legs |
| Instrument | `NIFTY` or `BANKNIFTY` |

### Output

- Options P&L for each spot trade
- Comparison: spot P&L vs options P&L
- Total strategy result

---

## 14. Session Persistence

**Service:** `firebaseSessionService.ts`  
**Component:** `BackupHistoryDialog`

Never lose your session — everything is saved to Firebase Firestore.

### Auto-save

The session is automatically saved to Firestore whenever significant changes occur (trades executed, settings changed).

### Manual Save / Snapshot

| Action | Description |
|--------|-------------|
| **Save Session** | Saves current state as "current_session" |
| **Create Snapshot** | Saves a named permanent checkpoint |
| **Restore Snapshot** | Load any named snapshot |
| **Auto-history** | Last 4 saves are archived automatically |
| **Restore from History** | Restore any of the last 4 auto-archives |

### What is saved

- All candles and current playback index
- All trades + journal entries
- Current open position
- Indicator settings
- Chart drawings
- Session configuration

### Local Storage Fallback

`tradeStorage.ts` also writes the session to browser `localStorage` as an additional fallback.

---

## 15. Screenshots

**Component:** `ScreenshotSaveDialog`  
**Endpoint:** `POST /api/screenshot/upload`

Capture and save the chart for trade documentation.

### Steps

1. Press the screenshot button in `ChartToolbar`
2. Chart canvas is captured as a PNG
3. `ScreenshotSaveDialog` opens — enter a filename
4. Choose: **Upload to Google Drive** or **Download locally**

### Google Drive upload

- File is uploaded to the configured Drive folder
- A shareable link is returned and can be copied
- Useful for attaching to trade journals or reviews

---

## 16. Live Trading

**Component:** `PerformanceDashboard`  
**Routes:** `/api/live/*`

Connect to your real Dhan account for live order execution.

> **Requires:** Valid `DHAN_ACCESS_TOKEN` and `DHAN_CLIENT_ID` in backend `.env`

### Features

| Feature | Description |
|---------|-------------|
| Real-time price | WebSocket tick feed via Dhan Market Feed |
| Live positions | Fetch current account positions |
| Place order | Market or limit order to Dhan |
| ATM option lookup | Auto-find nearest expiry + ATM strike for NIFTY/BANKNIFTY |
| Option chain display | Live LTP for ATM CE and PE |
| Greeks display | Option Greeks for ATM options |

### Order Parameters

| Field | Options |
|-------|---------|
| Transaction Type | `BUY`, `SELL` |
| Quantity | Number of lots |
| Order Type | `MARKET`, `LIMIT` |
| Product Type | `INTRADAY`, `CNC`, `MARGIN` |

---

## 17. Smart Exit (Order Chaser)

**Service:** `smartExit.service.ts`  
**Endpoint:** `POST /api/live/smart-exit`

An intelligent exit mechanism that ensures your stop-loss order gets filled even in fast-moving markets.

### How it works

The chaser runs asynchronously — your HTTP call returns immediately with the initial order ID, and the loop continues in the backend.

```
You provide: SL price

Step 1 — Aggressive Limit
  Place limit order at (SL_price − 0.5% buffer)
  Wait 2 seconds
  → If filled: done ✓
  → If still pending: proceed to Step 2

Step 2 — Deeper Limit
  Modify the existing order to (SL_price − 2% buffer)
  Wait 3 seconds
  → If filled: done ✓
  → If still pending: proceed to Step 3

Step 3 — Market Order
  Convert to market order
  → Guaranteed fill ✓
```

### When to use

- When you want a guaranteed SL execution without manual intervention
- Useful for fast moves where limit orders might not fill

---

## 18. Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` | Play / Pause playback |
| `→` (Right Arrow) | Step one candle forward |
| `←` (Left Arrow) | Step one candle backward |
| `B` | Quick BUY at current price |
| `S` | Quick SELL at current price |
| `Delete` | Delete selected drawing |
| `Ctrl+Z` / `Cmd+Z` | Undo last drawing action (up to 5) |
| `Esc` | Cancel current drawing tool |

---

## Quick Reference — UI Layout

```
┌─────────────────────────────────────────────────────┐
│  Instrument Selector  │  Chart Toolbar               │
├─────────────────────────────────────────────────────┤
│                                                     │
│              Advanced Chart (Primary)               │
│         [Candlesticks + Indicators + Drawings]      │
│                                                     │
├─────────────────────────────────────────────────────┤
│  (Optional) Advanced Chart (Secondary Timeframe)   │
├─────────────────────────────────────────────────────┤
│         Playback Controls  │  Session Stats         │
├────────────────┬────────────────────────────────────┤
│  Trading Panel │  Position Overlay                  │
└────────────────┴────────────────────────────────────┘
```

Dialogs (open on demand):
- Trade History
- Trade Journal
- Trade Exit Confirmation
- Performance Report
- Options Backtest
- Backup History
- Screenshot Save
- Performance Dashboard (Live Trading)

---

*Last updated: 2026-04-05*
