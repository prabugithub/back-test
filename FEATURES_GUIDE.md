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
14. [Performance Analytics Dashboard](#14-performance-analytics-dashboard)
15. [Session Persistence](#15-session-persistence)
16. [Screenshots](#16-screenshots)
17. [Live Trading](#17-live-trading)
18. [Smart Exit (Order Chaser)](#18-smart-exit-order-chaser)
19. [Keyboard Shortcuts](#19-keyboard-shortcuts)
20. [Auto-Backtest Saved Configurations](#20-auto-backtest-saved-configurations)

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
- **Click a candle with a trade on it** (no drawing tool active) to open a popup showing the complete raw trade record — a pretty-printed object dump (like inspecting an object in the browser console), so every field is visible at once, including the instrumentation values (`brrAtEntry`, `clvAtEntry`, `uwrAtEntry`, `lwrAtEntry`, and every other `*AtEntry` metric — see section 6's "Entry Instrumentation & Quality Setup Filters" for what they mean) alongside the journal (LT/HT market, entry position, LLHH pivot, align flags, notes, screenshot link). Closes on outside click or when playback advances. Reached automatically after using Trade History's "Jump to entry" (see section 10) since that also highlights the candle.

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

When `autoExitTarget` is enabled in settings, the chart checks on every candle advance whether the candle's low/high breaches the set Stop Loss or Target, and exits automatically. The **fill price** is controlled by `autoBacktestConfig.slTpFillMode` (default `'exact'`), and applies uniformly to every backtest trade — manual and auto-backtest alike:
- **`exact`** (default): fills at the exact SL/TP price the instant intrabar high/low touches it — no slippage beyond the planned risk.
- **`close`** (legacy/opt-in): only fires once the candle's *close* crosses the level, filled at that close price — can overshoot the planned risk substantially when a bar gaps through the level intrabar (measured ~51% average overshoot on a real sample before this mode existed).

### Settings Panels

Two separate panels are accessible from the control bar:

#### Data Settings (gear icon ⚙️)

Requires **"Load Data"** to apply. The reload itself runs through `sessionStore.reloadCandlesWithRange()` — the same action backing the [Auto-Backtest Panel's Date Range control](#6-trade-execution-backtesting), so a range/timeframe change behaves identically from either page.

| Field | Description |
|-------|-------------|
| Timeframe | 1 min / 5 min / 15 min / 30 min / 60 min / 4H / Daily |
| From Date | Start of data range |
| To Date | End of data range |
| Jump To Date | Loads full range but starts playback at this date |

**Export Loaded Data** button (below "Load Data"): downloads the candles currently held in the session (`sessionStore.candles`) as a CSV (`Timestamp,DateTime,Open,High,Low,Close,Volume`). This is a pure client-side export of whatever is already loaded — it does **not** trigger a new fetch/reload, and respects whatever timeframe/date range/instrument is currently active (e.g. 5-min Nifty data loaded via the Local source). Disabled when no candles are loaded. Filename: `{instrument}-{timeframe}m-{date}.csv`.

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

### Auto-Backtest Strategy Builder Workflow

**Component:** `AutoBacktestPanel` (full-screen panel, portals to `document.body`). Reachable from the Playback toolbar's Zap button, or directly from any other full-page view via its header's [PageNavTabs](#quick-reference--ui-layout) — see the cross-page navigation note in the Quick Reference section below. Because it's a `createPortal`, App.tsx controls its visibility with a `hidden` prop on the component itself (not a wrapping CSS class) — a wrapping `display:none` div has no effect on portaled content.

Per-regime rules are configured through a 5-section **Market → Entry → Confirmation → Exit → Risk** workflow, rendered as a **single-open accordion**: each section is a collapsible `AccordionSection` header (icon + label + optional badge + chevron) stacked beneath the regime tabs (Uptrend/Downtrend/Range/Reversal), and expanding one section auto-collapses whichever other section was open — only one section's content is ever mounted at a time. Switching regime tabs collapses back to Market-only for orientation; a `WorkflowStep` value (`activeStep`) is local UI state only — it is never persisted to `RegimeRules`/`AutoBacktestConfig`, so it doesn't affect saved configs or presets.

- **Market section** — regime Enable toggle, Direction (Long/Short/Both), and two structure gates: **HT Structure** and **LT Structure**. Both offer 5 options (Any / Bull Trend / Bear Trend / Range / Reversal) and gate signal generation in `evaluateAutoSignals` — a regime's rules are skipped for the bar unless both gates pass. `bull_trend`/`bear_trend` match only the clean trend state (the choppy "Trending-range" variant is bucketed under `range`); `reversal` matches either direction. LT Structure reads the same `ltMarket` value used elsewhere to pick which regime's rules try first for a bar — this filter turns that into a hard requirement instead of just an ordering preference, so a regime's rules can be locked to only fire when the bar's own structure genuinely matches (previously a regime's rules could fire on a bar structurally classified into a *different* regime, gated only by whatever other filters were configured). HT Structure now has a real Reversal state too (`pivotAnalysis.ts`'s `analyzeMarketStructure`, mirroring the LT branch's slope+pivot-label logic) — previously HT could only ever read Bull-Trend/Bear-Trend/Range. `ltStructureFilter` is optional and defaults to `'any'`, so saved configs from before this field existed behave unchanged.
- **Entry section** — Entry Signal mode (Pivot/H-L Signal/Confluence) with H1/H2/L1/L2 toggles and confluence lookback, MA Filter, and the single most-recent Pivot Seq filter.
- **Confirmation section** — all Quality Setup Filters (ATR Depth, Efficiency Ratio, Bar Overlap, Bar Range, Break Count, Consecutive Breaks, EMA21/EMA50 Slope, EMA20 Gap-Bar/Bias) plus Pivot Sequence History (High/Low Sequence, Pivot Gap). Its accordion header shows a live badge counting how many of these are currently active.
- **Exit section** — Target RR, the four Price-Action Exit Engine mechanisms (Reversal, Opposite Signal, Pivot Trailing Stop, Leg Decay — see below), plus a read-only shortcut summarizing the session's auto square-off time and SL/TP fill mode with a button that opens Session Settings. Its accordion header shows a live badge counting how many exit mechanisms are active.
- **Risk section** — Stop-loss method (Pivot/ATR/Fixed) and its amount, plus a read-only shortcut summarizing position-sizing (auto risk-based vs. manual) with a button that opens Session Settings.

Two elements stay pinned above the scrollable accordion regardless of which section is expanded: the **Live Preview Strip** (see below) and a **Strategy Summary** chip bar — a plain-language, read-only recap of the active regime's current rules (direction, entry mode, MA filter, confirmation-filter count, SL method, RR), derived entirely from `RegimeRules` with no new state. Clicking a chip expands the accordion section that owns that setting. A **Run Full Backtest** footer (status + progress bar + the button itself) stays pinned below the scrollable area so it's always reachable without scrolling.

Session-wide settings that apply across all regimes — Position Management, Trading Window, Quantity/Risk sizing, Auto Square-off, SL/TP Fill Mode, and the Instrumentation Lookbacks — live in a **Session Settings** slide-over drawer (opened from a header button), separate from the per-regime workflow since they aren't scoped to Market/Entry/Confirmation/Exit/Risk. The Instrumentation Lookbacks card additionally hosts **Leg Min Bars** / **Leg Max Bars** (defaults 5/15) — the bounds for the completed-breakout-leg metric windows described under Entry Instrumentation below.

**Date Range control (header):** a button next to the page title showing the currently loaded span (e.g. `2021-01-01 → 2026-01-20`) — click it to open a compact popover with a **Year** quick-select, **From Date**/**To Date** inputs, and a **Load Data** button, so the date range being backtested can be changed without leaving this page (previously required switching back to the Chart page's Data Settings panel). Reuses the same Year quick-select behaviour as the Chart page (`fromDate` = Jan 1, `toDate` = Dec 31, capped at today for the current year) and keeps the current timeframe from the session's config. Refetches (API source) or re-filters (Local source) via the shared `sessionStore.reloadCandlesWithRange()` action — the same one the Chart page's Data Settings panel uses — so both stay in sync. Disabled until a session is loaded.

### Auto-Backtest Entry Modes — one position vs. independent trades

**Setting:** `skipIfPositionOpen` — the **"Skip if open"** checkbox in the AutoBacktestPanel header, mirrored in Session Settings → **Position Management**.

| Mode | Behaviour |
|------|-----------|
| **Checked (default) — single position** | A signal is ignored outright while any position is open. Exactly one position at a time, exactly as before. Nothing about this path changed. |
| **Unchecked — multi-trade** | Every qualifying signal opens **its own independent trade** with its own quantity, SL, TP and exit. Existing trades are never averaged into, reduced, or flipped. Longs and shorts can be open at the same time — an opposite-direction signal opens a new trade on the other side rather than closing what's running. |

Multi-trade mode is a **backtest-only** mode: it is never active in live trading, and never active while "Skip if open" is checked (`isMultiTradeMode()` in `autoBacktestEngine.ts` is the single predicate every code path gates on).

- **Max concurrent trades** (`maxOpenPositions`, default **5**, `0` = unlimited) — Session Settings → Position Management. Once the cap is reached, further signals are skipped and the reason appears in the Live Preview Strip's status line. Since `evaluateAutoSignals` returns at most one signal per bar, at most one new trade opens per bar.
- **Per-trade lifecycle** — each open trade runs the full canonical order on every bar independently: trail stop → SL/TP touch → signal exits → square-off. One trade hitting its stop does not touch the others. Auto square-off closes them all, each as its own `TIME_OVER` row.
- **Position panel** — `PositionOverlay` shows a NET summary (net quantity, weighted avg price, combined unrealized P&L) plus an expandable **"N trades"** list: one row per open trade with its direction, quantity, entry, SL, TP, live P&L and an ✕ to exit *only* that trade.
- **Manual trading is disabled** while this mode is active — there is no single position for a BUY/SELL to act on. TradingPanel's buttons are greyed out with an explanation, and `initiateTrade` refuses with a notification as a backstop. Exits are per trade, from the position panel.
- **Trade History / reports** — every entry and exit fill carries a `positionId` linking the two, so `groupTradesIntoPositions` pairs them exactly instead of walking a net quantity. Each trade appears once, with its own entry metrics, exit reason and P&L, in Trade History, the Performance Dashboard, the Trade Report and the Entry Metrics Dashboard.
- **Switching modes mid-session** — unchecking with a position open adopts it as the first independent trade. Re-checking with a single trade open collapses it back to the normal position; with **more than one** open, they are all closed at the current bar's close as `MANUAL` rows (with a notification), since single-position mode cannot represent them. Nothing is ever closed silently.
- **Interaction with the rest of the app** — `position` becomes a derived net mirror of the open trades in this mode, so mid-trade RR changes and the overlay's target edit are unavailable (each trade keeps the target its own signal computed). Sessions save and restore the open trades; sessions saved before this mode existed restore straight onto the single-position path.

### Auto-Backtest Price-Action Exit Engine

**Engine:** `evaluateTrailStop` / `evaluateAutoExitSignal` in `autoBacktestEngine.ts` — pure functions called identically by both the interactive step-through (`runAutoTrailStop`/`runAutoExitCheck` in `autoBacktestActions.ts`) and the batch simulator (`batchBacktestSimulator.ts`), so results are identical whether you step through a session or run a full batch backtest.

Al Brooks-style trade management for **auto-entered backtest positions only** — manually entered trades are never touched by any of these mechanisms, only by the existing SL/TP/square-off logic. In multi-trade mode the same engine runs per open trade, managed by the regime that opened *that* trade. Every trade closed by this engine is stamped with a distinct `exitReason` shown in Trade History, the Performance Report, and the Entry Metrics Dashboard. Configured per regime in the **Exit** step of the Auto-Backtest Strategy Builder; the regime that opened the trade keeps managing it for its whole life, even if the live market structure later maps to a different regime.

All four mechanisms default to **off** — existing saved configurations and sessions are unaffected until explicitly enabled.

Canonical per-bar evaluation order (identical in both loops): trail stop → SL/TP touch check → signal exits (Reversal → Opposite Signal → Leg Decay) → auto square-off → new entry check.

| Mechanism | Toggle | Trigger | Exit Reason |
|-----------|--------|---------|--------------|
| **Reversal Exit** | `exitOnReversal` | The LT market structure (same read as the Trend Reversal flag) reads against the position for `exitReversalConfirmBars` consecutive bars (default 1). `exitReversalRequireWithTrend` (default on) requires structure to have read *with* the trade at least once before the exit can arm — turn off for counter-trend regimes (Range/Reversal), which may never see a with-trend read. | `REVERSAL` |
| **Opposite Signal Exit** | `exitOnOppSignal` | An opposite Brooks pullback signal fires on the current bar against the position (L1/L2 for a long, H1/H2 for a short) — `exitOppAllow1`/`exitOppAllow2` pick which count (default: 2nd only, the classic Brooks reversal trigger; 3rd+ signals never count). | `OPP_SIGNAL` |
| **Pivot Trailing Stop** | `exitTrailPivot` | Ratchets the stop-loss behind the 3-bar swing extreme of the most recent **confirmed** same-side pivot (bullish pivot's low cluster for longs, bearish pivot's high cluster for shorts), padded by `exitTrailPivotBufferPoints` (default 2). Only pivots confirmed through the prior bar are used, so a pivot can never move the same bar's own SL touch check — and the stop only ever tightens, never loosens. The actual exit still goes through the normal SL machinery; the closing trade is flagged `slTrailed`. | `SL` (+ `slTrailed`) |
| **Leg Decay Exit** | `exitLegDecay` | Re-grades the newest **completed** with-trend leg formed *after* entry (never re-judges the entry leg the Confirmation filters already approved) using the same metrics as the Confirmation step's leg-strength filters — Efficiency Ratio, Consecutive Breaks, Break Count, EMA21 Slope, EMA20 Gap-Bar — each with its own `none`/`min`/`max` mode + threshold. Waits at least `exitLegDecayMinBarsInTrade` bars (default 3) before checking; exits once at least `exitLegDecayMinFails` of the enabled checks fail on the same bar (default 1). Windows respect the session's Leg Min/Max Bars. | `LEG_DECAY` |

All three signal-based exits (Reversal, Opposite Signal, Leg Decay) fill at the current bar's **close** and exit immediately — there is no "tighten stop first" option in this version. The Pivot Trailing Stop instead only ever moves the SL; the actual exit fires later through the regular SL touch check (`slTpFillMode` still governs the fill price there).

---

### Entry Instrumentation & Quality Setup Filters

Every entry trade (manual, auto-backtest live-replay, and batch backtest) is stamped with raw regime metrics on the `Trade` record. For auto-backtest regimes, 6 of these 7 metric categories can also **gate entries** — reject a signal outright unless the market-structure condition holds — via a `RegimeRules.xxxFilter` (`none`/`min`/`max`, plus `dominance` for Bar Range) + paired `xxxThreshold`, configured per regime in the **Confirmation** step of the Auto-Backtest Strategy Builder (Uptrend/Downtrend/Range/Reversal tabs). Directional metrics (Break Count, EMA Slope, EMA20 Bias) auto-align to the trade's own direction — one filter+threshold per regime covers both longs and shorts, no manual sign-flipping needed.

- `atrDepthAtEntry` — distance from EMA21 in ATR units. Gates via `atrDepthFilter` (`none`/`max`/`min`) + `atrDepthThreshold` (default `1.5`).
- `barOverlapAtEntry` / `barOverlapAvgAtEntry` — per-bar overlap ratio for the last N bars, and its mean (choppiness proxy: high overlap = range/chop, low overlap = clean trend bars). Lookback `N` via the **Overlap** field (default 8). Gates via `barOverlapFilter` (`none`/`max`/`min`) + `barOverlapThreshold` (default `0.4`) — **enabled by default** (`max` 0.4) on Uptrend/Downtrend regimes.
- `barRangeAvgAtEntry` / `bullBarRangeAvgAtEntry` / `bearBarRangeAvgAtEntry` — mean candle range (high-low) over the last N bars ending at entry, overall and split by bull/bear bar direction. Lookback `N` via the **Bar Range** field (default 20). An exact doji (close = open) counts toward the overall average only, not bull or bear. Gates via `barRangeFilter`: `none` / `min` / `max` (threshold in points, `barRangeThreshold`) / `dominance` (the trade-direction-aligned average must exceed the opposite side's average by `barRangeDominanceThreshold`×, e.g. bull range > bear range for longs) — **enabled by default** (`dominance` 1.0×) on Uptrend/Downtrend regimes.
- `brrAvgIQRAtEntry` — IQR-trimmed mean Body-to-Range Ratio (`|close-open|/(high-low)`) over the last N bars ending at entry: values outside the Tukey fence `[Q1-1.5×IQR, Q3+1.5×IQR]` are dropped before averaging, so one freak doji/marubozu bar can't skew the window the way a plain mean would (falls back to the plain mean if the fence would drop every sample). Robust companion to the leg-windowed `brrAvg` inside `legSequenceAtEntry`. Lookback `N` via the **Bar Quality** field (default 20). Instrumentation only — no `RegimeRules` filter/threshold gate yet.
- `brrAtEntry` / `clvAtEntry` / `uwrAtEntry` / `lwrAtEntry` (+ `brrAvgAtEntry` / `clvAvgAtEntry` / `uwrAvgAtEntry` / `lwrAvgAtEntry`) — per-candle bar-quality ratios across the graded window, oldest→newest (a 7-bar leg yields 7-length arrays — index 0 is the leg's first bar, the last index is its swing-extreme bar), plus each array's mean. **Body-to-Range Ratio (BRR)** = `|close-open|/(high-low)` — high = trend/conviction bar, low = doji/spinning-top indecision. **Close Location Value (CLV)** = `(close-low)/(high-low)` — near 1 = closed near the high (bullish), near 0 = closed near the low (bearish); "where the bar finished the fight". **Upper/Lower Wick Ratio (UWR/LWR)** = `(high-max(open,close))/(high-low)` and `(min(open,close)-low)/(high-low)` — a large UWR on an up-close bar (or LWR on a down-close bar) exposes rejection at the extreme that the close alone would hide, i.e. a "big bull bar" that's actually a fakeout. Lookback `N` (when no completed leg applies) via the **Bar Quality** field (default 20). Instrumentation only — no `RegimeRules` filter/threshold gates on these yet.
- `efficiencyRatioAtEntry` — Kaufman Efficiency Ratio over the last N bars: net price displacement divided by total bar-to-bar distance traveled, bounded 0–1 (near 1 = efficient one-directional trend, near 0 = chop/cancelling moves). Lookback `N` via the **Efficiency** field (default 10). Gates via `efficiencyRatioFilter` (`none`/`min`/`max`) + `efficiencyRatioThreshold` (default `0.3`) — e.g. require ER ≥ threshold to avoid trend-following entries into chop.
- `highBreakCountAtEntry` / `lowBreakCountAtEntry` / `barBreakWindowAtEntry` — over the last N bars, how many bars broke the immediately preceding bar's high vs. its low (independent counts — an outside bar counts toward both), plus the actual window size used (shorter early in a session). A momentum/persistence proxy: a fading trend shows the count dropping even while other metrics still look fine. Lookback `N` via the **Breaks** field (default 20). Gates via `barBreakFilter` (`none`/`min`/`max`) + `barBreakThreshold` (default `5`), direction-aligned (high-break count for longs, low-break count for shorts).
- `ema21SlopeAtEntry` / `ema50SlopeAtEntry` — points-per-bar rate of change of the EMA21/EMA50 over their own configurable lookbacks (same formula used internally for regime detection). Lookbacks via the **EMA21**/**EMA50** fields (defaults 10 and 20). Gate via `ema21SlopeFilter` / `ema50SlopeFilter` (`none`/`min`/`max`) + paired thresholds (default `0` — sign-only: require the EMA sloping in the trade's favor, any steepness; a nonzero threshold adds a minimum-steepness requirement, but is instrument/timeframe-scale-dependent since slope is in raw price points-per-bar) — **enabled by default** (`min` 0) on Uptrend/Downtrend regimes.
- `maxConsecutiveHighBreaksAtEntry` / `maxConsecutiveLowBreaksAtEntry` — longest run of consecutive bars that each broke the prior bar's high **without** breaking its low (mirror for low-breaks) — the Brooks "impulse micro-channel" test, e.g. a clean 4-bar breakout. Unlike Break Count (total breaks, possibly scattered), this demands an unbroken streak; outside and inside bars reset the run. In H/L entry modes the run is searched over the completed breakout leg's own bars (see the leg-window paragraph below); the **Consecutive** lookback (Session Settings, default 10) applies to `PIVOT`-mode / entry-bar windows. Gates via `consecutiveBreakFilter` (`none`/`min` "Streak Required"/`max` "Streak Capped") + `consecutiveBreakThreshold` (default `4`), direction-aligned. Off by default on all regimes and presets.
- `legStartIndexAtEntry` / `legEndIndexAtEntry` / `legBarCountAtEntry` — the bar-index bounds (and inclusive length) of the **completed breakout leg** whose bars the leg-strength metric windows covered. `undefined` means the entry was graded with entry-bar windows instead (`PIVOT` mode, or no completed leg existed yet at entry).
- `legSequenceAtEntry` — **market-context leg sequence**: the last **Leg Seq N** (Session Settings, default 10) Al Brooks impulse legs *plus the pullback candles between them*, captured as a contiguous `LegSegment[]` ordered **newest→oldest** (index 0 is the segment closest to the entry bar, walking back in time). Unlike the single-leg `leg*AtEntry` above, this is a walkable history for reading structure/trend/context. Legs come from the same H/L signal machinery (`calculateAlBrooksLegHistory`, no pivots); a `leg` segment is one impulse (start→swing-extreme), a `pullback` segment is the retrace between two legs (tagged with the direction opposite to the leg it retraces), so every candle from the oldest kept leg up to the entry bar belongs to exactly one segment — pullbacks are never dropped. Each segment carries `direction`, `barCount`, `startIndex`/`endIndex`, `startTime`/`endTime` (candle timestamps, for index-alignment-free chart mapping), `startPrice`/`endPrice`/`movePct`, the segment's price `high`/`low` (range extremes), per-segment `brrAvg`/`clvAvg`/`uwrAvg`/`lwrAvg` and `highBreakCount`/`lowBreakCount`. **Two detail modes** via **Leg Seq Detail** (Session Settings): `full` also attaches per-candle `brr`/`clv`/`uwr`/`lwr` arrays per segment (in-memory + JSON export); `avg` keeps only the averages. The per-candle arrays are **not persisted to Firestore** (stripped on save — averages/structure retained) to keep session docs small; the full arrays are recoverable via **Export JSON (full detail)** on the Performance dashboard. Rendered as a compact leg/pullback chip strip in the chart's trade-record popup; **clicking a chip highlights that segment's candles on the chart** (a translucent band, dashed for pullbacks, panned into view) and **expands a detail panel** with the segment's move/high/low/range/breaks/averages and a per-candle BRR/CLV/UWR/LWR table aligned to the highlighted bars. Instrumentation only in Phase 1 (no `RegimeRules` filter gates yet — see Phase 2).

  **Completed-breakout-leg windows for pullback entries:** the leg-strength filters — Efficiency Ratio, Bar Overlap, Break Count, Consecutive Breaks, Bar Range (incl. dominance), and EMA20 Gap-Bar — plus the (currently unfiltered) Bar Quality instrumentation (BRR/CLV/UWR/LWR) grade the breakout leg that led into the pullback the entry sits in, over **the leg's own bars** (no fixed lookback). A leg **starts at the last H/L signal bar fired before its breakout** — breaking `hSwingHigh`/`lSwingLow` (the H/L-count reset) confirms it; if the pullback makes a deeper extreme before breaking out, the candidate is discarded and the next H/L signal becomes the new start — and **ends at the swing extreme frozen when the next pullback begins**. Every signal of the same pullback grades the same completed leg; the reference moves only when a newer leg completes. Legs longer than **Leg Max Bars** (Session Settings, default 15) are trimmed to their most recent that-many bars; pair-wise metrics (overlap, breaks, ER, consecutive runs) use one fewer comparison so the window never reaches before the leg start. Auto entries with a leg shorter than **Leg Min Bars** (default 5) — or with no completed leg yet — are **blocked** whenever at least one leg-strength filter is active (`legTooShort` on the metrics snapshot; the Live Filter Preview shows those filters failing). Manual trades are never blocked: they grade the completed leg **matching the trade's direction** (BUY → bull leg, SELL → bear leg, via `calculateAlBrooksLegs`), record over the available bars even when under the minimum (`legBarCountAtEntry` shows it), and fall back to entry-bar windows when no leg exists. EMA21/EMA50 Slopes keep their configured Instrumentation Lookbacks (window ending at the leg extreme in H/L modes); EMA20 Bias (always-in direction), ATR Depth, and the pivot-sequence filters always measure at the entry bar, since they describe current context rather than leg strength. `PIVOT`-mode entries keep all windows at the entry bar with the configured lookbacks.
- `ema20GapBarRatioAtEntry` / `ema20CloseAboveRatioAtEntry` / `ema20InteractionWindowAtEntry` — Brooks-style EMA20 interaction over the last N bars ending at entry: the fraction of bars whose full range never touches the EMA20 ("gap bars" — a strong-trend signal) and the fraction of closes above the EMA20 ("always-in" direction bias; below = 1 minus this), plus the actual window size used. Lookback `N` via the **EMA20 Int** field (default 20). Two independent gates: `ema20GapBarFilter` (`none`/`min`/`max`) + `ema20GapBarThreshold` (default `0.5`, not direction-aligned), and `ema20BiasFilter` (`none`/`min`/`max`) + `ema20BiasThreshold` (default `0.5`, direction-aligned).

Range/Reversal regimes leave all 4 default-on filters at `none` (chop-tolerant by design). When a trade comes from the auto-engine, all stamped instrumentation values are the exact ones used for the entry decision (computed once in `evaluateAutoSignals`), not a fresh recompute — avoids double-running the EMA-slope/EMA-interaction calculations, which rerun EMA over the full visible candle history.

### Visual Filter Configuration

Every filter in the Auto-Backtest panel (Quality Setup Filters plus MA Filter, Pivot Seq, HT Structure, ATR Depth, Efficiency Ratio, and Pivot Sequence History) is configured visually rather than via a raw dropdown + number pair — aimed at reading a threshold as a chart shape instead of an abstract number:

- **Segmented mode buttons** replace the `<select>` (e.g. "Clean/Trend" / "Choppy" instead of "≤ X" / "≥ X").
- **Slider + live-redrawing diagram** replaces the raw number input — a small illustration (shaded candle overlap, an EMA-slope angle, a straight-vs-zigzag efficiency path, a candle-vs-EMA position, a swing-pattern staircase, etc.) redraws as the slider moves, so the threshold is never just a number.
- **"Currently requires: ≥ X" / "≤ X"** appears the instant a mode button is clicked, even before touching the slider — clarifies that a filter's two directional modes (e.g. Trending/Choppy) share one threshold value and only flip which side of it counts as a pass.
- **"Your data: X"** — a live value computed from the currently loaded candles' actual metric, shown next to the label and as a tick mark on the slider, so a threshold can be set relative to what the market is actually doing right now instead of guessing.
- **Live Preview Strip** — a real-candlestick mini-chart pinned above the workflow steps (rebuilt for whichever regime tab is active, stays visible across all 5 steps while you configure), showing the last 30 loaded bars with a pass/fail dot under each bar for the combined set of currently-active filters, plus an "N/30 pass" count. Hovering or focusing any filter's control isolates that filter's own pass/fail on the strip, so cause-and-effect between a slider and the actual candles is visible directly.
- Categorical filters with no numeric threshold — MA Filter, Pivot Seq, HT Structure — get the same segmented-button treatment plus an illustrative diagram (candle position relative to an EMA line, a 2-point swing zigzag, a trend-direction icon), just without a slider.
- Pivot Sequence History patterns are picked from a 4×4 grid where each button shows a mini staircase icon (rising for a run of "Higher" swings, falling for a run of "Lower" swings) instead of only the raw four-letter code.

### Pivot Sequence History & Pivot Gap

Two per-regime filters alongside the single most-recent Pivot Seq filter above, both configured in the **Pivot Sequence History (last 4)** section:

- **High/Low Sequence** (`highSeqFilter`/`lowSeqFilter`: Off/Pick patterns, with `highSeqPatterns`/`lowSeqPatterns` holding the chosen whitelist) — matches the last 4 same-type pivots (4 consecutive swing highs for High Sequence, 4 consecutive swing lows for Low Sequence), oldest to newest, against a whitelist of allowed 4-in-a-row patterns (e.g. `HH-HH-HH-HH`, `LH-LH-HH-HH`) picked from all 16 possible combinations. With fewer than 4 pivots recorded yet in the session, the filter passes through — no rejection.
- **Pivot Gap** (Off/Fast/Slow + a bars threshold, default `5`) — average bar-count gap between consecutive pivots across both the high and low sequences, a trend-pace check. **Fast** requires the average gap at or below the threshold (pivots forming quickly — accelerating/choppy). **Slow** requires it at or above (pivots spaced out — a slower, more mature trend).

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
- **Exit reason** — `SL`, `TP`, `MANUAL`, `TIME_OVER`, plus `REVERSAL`/`OPP_SIGNAL`/`LEG_DECAY` for auto-backtest trades closed by the Price-Action Exit Engine (see section 6)
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

Full log of every trade executed in the session, grouped into positions.

### Layout

Renders as a **full-page view** (`absolute inset-0 z-[105]`, same pattern as the [Performance Analytics Dashboard](#14-performance-analytics-dashboard)) rather than a floating modal — no backdrop, no drag-to-move, no click-outside-to-close. Its header carries the [PageNavTabs](#quick-reference--ui-layout) switcher (replacing the old "Back to Chart"/X-close and the standalone "Dashboard" button — Chart and Dashboard are just other tabs now). Opened from `PositionOverlay`'s detail button or `PlaybackControls`' history trigger (`onOpenHistory`/`onOpenDetail` → `navigateTo('tradeLog')` in `App.tsx`). Kept mounted (hidden via CSS, not unmounted) once opened, so scroll position and expanded position rows survive navigating to another page and back — see the state-persistence note in the Quick Reference section below.

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
- **Jump to candle** — click a trade to pan the chart to that candle; only recenters the viewport, does not rewind playback (`currentIndex` is untouched, so no already-revealed candles are hidden). The candle also flashes an amber highlight band + "JUMPED HERE" arrow for ~3.5s so it's visually obvious which one was navigated to. Click the highlighted candle itself to open the same execution-details popup described in section 2 (Chart Rendering → Interaction)
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
**Data source:** Dhan API — `POST /v2/charts/rollingoption`

Simulate a credit spread options strategy (Bull Put or Bear Call) layered over your spot backtest trades. For each spot position, two option legs are fetched from the Dhan rolling option API and the spread P&L is calculated at the entry and exit timestamps of the spot trade.

### Inputs

| Field | Description |
|-------|-------------|
| Spot Trades | Auto-populated from the Performance Analytics Dashboard filter |
| Sell Strike Offset | Number of strikes OTM to sell (e.g. 2 = 2 strikes from ATM) |
| Buy Strike Offset | Number of strikes OTM to buy as hedge (must be > Sell offset) |
| Instrument | Auto-detected from the selected instrument — `NIFTY` (securityId 13) or `BANKNIFTY` (securityId 25) |

### Strategy logic

| Spot direction | Options strategy | Sell leg | Buy leg |
|----------------|-----------------|----------|---------|
| LONG | Bull Put Spread | ATM − offsetSell (Put) | ATM − offsetBuy (Put) |
| SHORT | Bear Call Spread | ATM + offsetSell (Call) | ATM + offsetBuy (Call) |

Monthly expiry contracts are used for consistency across historical dates.

### Output

- Per-trade: sell leg entry/exit, buy leg entry/exit, spread P&L
- Summary: total option P&L, spot P&L, win rate, trade count

### Accessing the modal

Available from the **Performance Analytics Dashboard** sidebar via the "Option Backtest (Dhan)" button. Receives the currently filtered positions automatically.

---

## 14. Performance Analytics Dashboard

**Component:** `PerformanceDashboard`  
**Data source:** Firebase Firestore snapshots (`snapshot_session_*` documents)

Cross-session analytics dashboard. Aggregates trades across multiple saved snapshots to give a holistic view of strategy performance over time — unlike the in-session Performance Report which covers only the current session.

### Opening

Reachable from the chart icon in the top toolbar, `TradeHistoryDialog`'s or `AutoBacktestPanel`'s [PageNavTabs](#quick-reference--ui-layout), or any trigger that calls `navigateTo('dashboard')` in `App.tsx`.

### Data loading

On first open, the dashboard calls `listSnapshots()` from `firebaseSessionService.ts`, which fetches all documents in the Firestore `sessions` collection with the `snapshot_session_*` prefix. A loading spinner is shown while fetching. Since the component stays mounted (hidden via CSS) after that first open, snapshots are **not** re-fetched on subsequent visits — filters, the selected sub-tab (Dashboard/Entry Analytics/Detailed Log), and the Detailed Log search box all survive navigating away and back too.

> **Important:** Only **saved snapshots** are included. The current in-memory session is excluded to prevent double-counting. To include your latest trades, save a snapshot first.

### Snapshot selector (sidebar)

| Control | Behaviour |
|---------|-----------|
| Checkbox per snapshot | Check = include in analytics, uncheck = exclude |
| **All** link | Include all snapshots (default state on open) |
| **None** link | Exclude all (useful as a starting point to cherry-pick) |
| Snapshot label | Shows snapshot name + date saved |

Deselecting all checkboxes returns to "all included" mode automatically.

### Filters (sidebar)

| Filter | Options |
|--------|---------|
| Instrument | All, or any instrument found across loaded snapshots |
| Category | All / System / Discretionary |

Date range filter has been removed — snapshot selection replaces it.

### Dashboard tab — Metrics

| Metric | Description |
|--------|-------------|
| Total Net P&L | Sum of realized P&L across all filtered closed positions |
| Win Rate | % of closed positions with positive P&L |
| Profit Factor | Gross profit ÷ gross loss |
| Max Drawdown | Largest peak-to-trough equity drop |
| Expectancy | Average expected P&L per trade |

### Dashboard tab — Charts

- **Equity Growth** — area chart of cumulative P&L over time
- **Profit Distribution** — histogram of P&L values bucketed by ₹500
- **Top 5 Profitable Setups** — ranked by total P&L (LT Market | Entry Signal combos)
- **Top 5 Scenarios to Avoid** — worst-performing setups
- **Entry Signal Effectiveness** — horizontal bar chart, P&L by entry signal
- **Hourly Performance** — area chart, P&L aggregated by hour of day
- **LLHH Pivot Pattern Performance** — horizontal bar chart
- **Entry Position Performance** — horizontal bar chart
- **Category Split** — pie chart (System vs Discretionary) with P&L per category
- **Market Structure Matrix** — heatmap of LT × HT market structure combinations

### Detailed Log tab

Full searchable/sortable position table across all selected snapshots. Each row expands to show individual execution details, journal fields, and screenshot links.

### Export

**Export Filtered Data** button downloads a CSV of all filtered positions (instrument, direction, entry/exit time and price, qty, P&L, journal fields).

### Option Backtest integration

The "Option Backtest (Dhan)" button in the sidebar opens `OptionBacktestModal`, passing the currently filtered positions. Instrument is inferred from the active instrument filter.

---

## 15. Session Persistence

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

## 16. Screenshots

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

## 17. Live Trading

**Component:** `LiveTradingPanel`  
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

## 18. Smart Exit (Order Chaser)

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

## 19. Keyboard Shortcuts

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

## 20. Auto-Backtest Saved Configurations

**Component:** `AutoBacktestPanel`
**Service:** `autoBacktestConfigService.ts`
**Store:** `savedAutoBacktestConfigs`, `activeAutoBacktestConfigId`/`Name`, and the `*AutoBacktestConfig` actions in `autoBacktestActions.ts`

Lets you save the entire current Auto-Backtest filter setup (global settings + all 4 regimes' rules) as a named, persisted configuration — independent of any trading session — so you can build up a library of setups and switch between them.

### Distinct from Quick Presets

The existing **Quick Presets** row (Trend Follow / Range Trader / All Regimes) is a separate, hardcoded, non-editable mechanism (`AUTO_BT_PRESETS` in `autoBacktestEngine.ts`) — clicking one instantly overwrites the current config in memory only. **Saved Configurations** are user-created, editable, and persisted to Firebase Firestore (`autoBacktestConfigs` collection) — they survive a page reload and are available on any device signed into the same Firestore project.

### Actions

| Action | Behaviour |
|--------|-----------|
| **Save As...** | Opens a name prompt, then saves the current full configuration as a new entry. Becomes the "active" configuration. |
| **Save** | Overwrites the currently active configuration with the current filter values. Disabled until a configuration has been loaded or saved via Save As. |
| **Load** | Select an entry from the dropdown, click Load — replaces the entire current configuration (all regimes + global settings) with the saved one. |
| **Delete** | Select an entry, confirm, and it's removed from Firestore and the dropdown. |
| **Export** | Downloads the current in-memory Auto-Backtest configuration (all 4 regimes + global settings) as a JSON file — client-side only, no Firestore write. Includes the active saved-config name (or `unsaved-auto-bt-config`) and an `exportedAt` timestamp. Filename: `autobt-config-{name}-{date}.json`. |

The dropdown lists every saved configuration by name, marking the currently active one. Loading or saving as always keeps the dropdown selection in sync with the active configuration.

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

Full-page overlays (open on demand, `absolute inset-0`, stacked by z-index):
- Trade History (`z-[105]`)
- Performance Analytics Dashboard (`z-[110]`, cross-session, snapshot-based)
- Auto-Backtest Panel (`z-[110]`, portals to `document.body`)

### Cross-page navigation (`PageNavTabs`)

**Component:** `PageNavTabs.tsx` — a small pill-button switcher (Chart / Trade Log / Backtest / Dashboard) rendered in the header of every full-page view **and** in the chart page's bottom controls bar, so any of the four pages is reachable directly from any other — not just back to the chart.

- **State:** `App.tsx` owns a single `activePage: ActivePage` plus a `visitedPages: Set<ActivePage>` (`'chart'` always included). `navigateTo(page)` sets both.
- **Mount-once, hide-don't-unmount:** a page's component only mounts the first time it's visited (`visitedPages.has(page)`), then stays mounted — visibility toggles via a wrapping `style={{ display: activePage === page ? undefined : 'none' }}` instead of conditional `&&` rendering. This means **scroll position, expanded rows, search text, filter selections, and the active sub-tab are preserved** when navigating away and back, instead of resetting on every open (e.g. Trade History's expanded position row, the Performance Dashboard's Detailed Log search box and Dashboard/Entry Analytics/Detailed Log sub-tab, snapshot data already fetched from Firestore).
- **Exception — portaled components:** `AutoBacktestPanel` renders via `createPortal(..., document.body)`, so a hiding wrapper `<div>` around it in `App.tsx`'s tree has **no effect** — its own root element must carry the hide/show logic. It takes a `hidden?: boolean` prop for this; don't try to hide a portaled component from the caller's side.
- **Check when adding a new full-page view:** give it an `ActivePage` entry, an `onNavigate` prop, embed `<PageNavTabs active="yourPage" onNavigate={onNavigate} />` in its header, and mount it in `App.tsx` following the same `visitedPages.has(...)` + hidden-style pattern (or the `hidden` prop pattern if it's portal-based).

Dialogs (open on demand, floating modal):
- Trade Journal
- Trade Exit Confirmation
- Performance Report (current session)
- Options Backtest (Dhan API)
- Backup History
- Screenshot Save

---

**Last Updated:** 2026-07-28 (Added a Date Range control to the Auto-Backtest Panel header so the loaded date span can be changed without leaving that page; extracted the shared `sessionStore.reloadCandlesWithRange()` action so it and the Chart page's Data Settings panel stay in sync)
