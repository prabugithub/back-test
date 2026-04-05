# Technical Indicators Logic

This document details the logic and calculations for the technical indicators and trade performance metrics used in the generic backtesting application.

**Last Updated:** 2026-02-24

---

## 1. Moving Averages

### Simple Moving Average (SMA)
The SMA is calculated by taking the arithmetic mean of a given set of prices over a specific number of days in the past.

- **Formula:** `Sum(Close Price, N) / N`
- **Inputs:**
  - `candles`: Array of candle data.
  - `period`: Number of periods (e.g., 21, 60).
- **Logic:**
  - Iterates through the candles.
  - For each candle `i`, sums the closing prices of the previous `period` candles (inclusive).
  - Divides the sum by `period`.
- **Validation:** Requires at least `period` number of candles.

### Exponential Moving Average (EMA)
The EMA places a greater weight and significance on the most recent data points.

- **Formula:**
  - `Multiplier = 2 / (Period + 1)`
  - `EMA = (Close - Previous EMA) * Multiplier + Previous EMA`
- **Initialization:** The first EMA value is calculated using the SMA of the initial `period`.
- **Logic:**
  - Calculates the initial SMA to start the series.
  - Iterates through subsequent candles, applying the EMA formula recursively.

---

## 2. Fibonacci Retracement

Calculates potential support and resistance levels based on a high and low range.

- **Formula:**
  - `Diff = High - Low`
- **Levels:**
  - **0%:** `Low`
  - **23.6%:** `Low + Diff * 0.236`
  - **38.2%:** `Low + Diff * 0.382`
  - **50%:** `Low + Diff * 0.5`
  - **61.8%:** `Low + Diff * 0.618`
  - **78.6%:** `Low + Diff * 0.786`
  - **100%:** `High`

---

## 3. Reversal Pivot Points

This custom indicator identifies potential bullish and bearish reversal points based on multi-candle patterns. It requires a minimum of 5 candles to calculate.

### Bullish Reversal Pivot
Identifies a potential upward trend reversal.

**Conditions (Any of the following combined patterns):**
1.  **Simple Break:**
    - Current Close > Previous High
    - Current Close > Current Open (Green Candle)
2.  **3-Candle Reversal:**
    - Current is Bullish
    - Previous is Bullish
    - Previous Close < Current Close
    - 2-Back is Bearish
    - (Previous Low < 2-Back Low) OR (2-Back Low < 3-Back Low) OR (Current Low < Previous Low)
3.  **Confirmation:**
    - 2-Back is Bearish AND ((Previous Low < 2-Back Low) OR (2-Back Low < 3-Back Low) OR (Current Low < Previous Low))

**Logic:**
- A signal is valid if `(Condition 1 OR Condition 2) AND Condition 3` is met.
- Prevents consecutive signals by checking if the previous candle was already a Bullish Pivot.

**Stop Loss Calculation:**
- `MinLow = Min(Current Low, Previous Low)`
- `SL Distance = abs(Current Close - MinLow) + 2` (padding)

### Bearish Reversal Pivot
Identifies a potential downward trend reversal.

**Conditions (Any of the following combined patterns):**
1.  **Simple Break:**
    - Current Close < Previous Low
    - Current Close < Current Open (Red Candle)
2.  **3-Candle Reversal:**
    - Current is Bearish
    - Previous is Bearish
    - Previous Close > Current Close
    - 2-Back is Bullish
    - (Previous High > 2-Back High) OR (2-Back High > 3-Back High) OR (Current High > Previous High)
3.  **Confirmation:**
    - 2-Back is Bullish AND ((Previous High > 2-Back High) OR (2-Back High > 3-Back High) OR (Current High > Previous High))

**Logic:**
- A signal is valid if `(Condition 1 OR Condition 2) AND Condition 3` is met.
- Prevents consecutive signals by checking if the previous candle was already a Bearish Pivot.

**Stop Loss Calculation:**
- `MaxHigh = Max(Current High, Previous High)`
- `SL Distance = abs(Current Close - MaxHigh) + 2` (padding)

---

## 4. Visualisation (Risk-Reward Lines)

When a Pivot Point is detected, the chart renders risk-reward levels based on the calculated Close `Entry` and `SL Distance`.

- **Entry Line:** Plotted at the Close price of the signal candle.
- **Stop Loss (SL) Line:**
  - **Bullish:** `Entry - SL Distance`
  - **Bearish:** `Entry + SL Distance`
- **Target Lines (Risk:Reward):**
  - **1:1:** `Entry +/- (1 * SL Distance)`
  - **1:2:** `Entry +/- (2 * SL Distance)`
  - **1:3:** `Entry +/- (3 * SL Distance)`

---

## 5. Trade Analytics & Performance

Logic for grouping individual trade orders into positions and calculating performance metrics.

### Position Grouping
- **Concept:** Individual `BUY` and `SELL` executions are grouped into a "Position".
- **Opening:** A position starts when the net quantity is 0 and a new trade is executed.
- **Scaling In:** Executing a trade in the same direction as the current position increases the quantity and updates the `Average Entry Price`.
- **Scaling Out:** Executing a trade in the opposite direction reduces the quantity and realizes PnL on the closed portion.
- **Flipping:** If a trade in the opposite direction exceeds the current quantity, the position is closed, and a new position is opened in the opposite direction with the remainder.

### Key Metrics
- **Win Rate:** `(Winning Trades / Total Closed Trades) * 100`
- **Profit Factor:** `Total Profit from Winning Trades / Total Loss from Losing Trades` (Returns `Infinity` if no losses).
- **Average Win:** `Total Profit / Number of Winning Trades`
- **Average Loss:** `Total Loss / Number of Losing Trades`
- **Realized PnL:** Calculated using the difference between Entry Price and Exit Price multiplied by the Quantity closed.

---

## 6. Al Brooks H/L Pullback Counting

Identifies pullback buy/sell signals (H1, H2, H3… and L1, L2, L3…) using a **leg-based model with separate H and L counting**.

### Core Concept
H and L systems are tracked **independently**. Each detects pullback legs within its own trend context (bull for H, bear for L).

### H System (Bull-Context Pullback Counting)
1. **Continuous high breaks** without low breaks = bull trend.
2. **Low break** (`c.low < c1.low`) → **arms** for H signal, sets `hSwingHigh = latestHigh` (running max high since last H signal, captures the true high even through inside bars).
3. **High break** (`c.high > c1.high`) while armed → **H signal fires** (H1, H2, H3…).
4. **Reset:** If price exceeds `hSwingHigh` → `hCount` resets to 0 and arm is cleared. Next signal restarts from H1.

### L System (Bear-Context Pullback Counting)
1. **Continuous low breaks** without high breaks = bear trend.
2. **High break** (`c.high > c1.high`) → **arms** for L signal, sets `lSwingLow = latestLow` (running min low since last L signal).
3. **Low break** (`c.low < c1.low`) while armed → **L signal fires** (L1, L2, L3…).
4. **Reset:** If price drops below `lSwingLow` → `lCount` resets to 0 and arm is cleared.

### Inside Bar Handling
- `latestHigh` / `latestLow` are **running extremes** (not just the previous bar), so swing points capture the true high/low of the preceding move even through clusters of inside bars.
- `latestHigh` resets when an H signal fires; `latestLow` resets when an L signal fires.

### Outside Bar Resolution
When a single bar breaks **both** the previous bar's high and low:
- **Bullish close** (`close >= open`) → fires **H only**
- **Bearish close** (`close < open`) → fires **L only**

### Same-Bar Guard
The bar that **starts** a pullback (arms the system) **cannot** also fire the signal on the same bar. The signal uses the arm state from before the current bar.

### Optional Depth Filter
- When `usePullbackDepth` is enabled, H signals only fire if `c.low <= EMA21 + ATR * multiplier` and L signals only fire if `c.high >= EMA21 - ATR * multiplier`.

---

## Pivot Position Detection (Trade Journal)

Determines where the entry candle sits relative to the EMA at the time of trade entry. Looks at the 3 candles preceding entry.

### Detection Priority (asymmetric)

**For LONG trades:**

| Priority | Label | Rule |
|----------|-------|------|
| 1 (highest) | `gap-opposite` | ALL 3 candle **closes** are below the MA |
| 2 | `on-MA` | ANY candle's **wick (low)** touches or crosses the MA from above |
| 3 (default) | `gap` | Neither above condition met — all candles above MA without touching it |

**For SHORT trades:**

| Priority | Label | Rule |
|----------|-------|------|
| 1 (highest) | `gap-opposite` | ALL 3 candle **closes** are above the MA |
| 2 | `on-MA` | ANY candle's **wick (high)** touches or crosses the MA from below |
| 3 (default) | `gap` | Neither above condition met |

### Key Principles

- **Gap-Opposite** uses close prices only, all 3 must satisfy — strict because it's a counter-trend entry
- **On-MA** uses wicks, only 1 candle needs to touch — lenient because pullbacks to MA are common
- Priority is checked in order; first match wins

### Visual Examples

```
LONG - gap-opposite:  Close1=100, Close2=102, Close3=101, MA=105  → all closes < MA ✓
LONG - on-MA:         Candle with Low=104, MA=105, High=110       → wick touches MA ✓
LONG - gap:           All closes and lows above MA                 → default ✓

SHORT - gap-opposite: Close1=110, Close2=112, Close3=111, MA=105  → all closes > MA ✓
SHORT - on-MA:        Candle with High=106, MA=105, Low=100       → wick touches MA ✓
```
