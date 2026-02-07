# Technical Indicators Logic

This document details the logic and calculations for the technical indicators and trade performance metrics used in the generic backtesting application.

**Last Updated:** 2026-02-05

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
