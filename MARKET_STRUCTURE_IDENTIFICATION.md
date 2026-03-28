# Market Structure Identification using Pivot Points

Market structure is the backbone of technical analysis. It describes the behavior, condition, and current flow of the market by identifying peak (Highs) and trough (Lows) points.

---

## 1. What is a Pivot Point (Swing Point)?

A **Pivot Point** in market structure is a turning point where price reverses direction. There are two types:

### A. Swing High (Peak)
A candle that has a **higher High** than the candles immediately to its left and its right.
*   **Visual**: `  ^  `
*   **Significance**: Represents a temporary ceiling where selling pressure overcame buying pressure.

### B. Swing Low (Trough)
A candle that has a **lower Low** than the candles immediately to its left and its right.
*   **Visual**: `  v  `
*   **Significance**: Represents a temporary floor where buying pressure overcame selling pressure.

---

## 2. Comparing Pivots: The 4 Building Blocks

To identify structure, we don't just look at one pivot; we compare the **current pivot** to the **previous pivot** of the same type.

| Term | Full Name | Definition | Market Sentiment |
| :--- | :--- | :--- | :--- |
| **HH** | Higher High | Current High is higher than the previous High | **Strongly Bullish** |
| **HL** | Higher Low | Current Low is higher than the previous Low | **Bullish Support** |
| **LH** | Lower High | Current High is lower than the previous High | **Bearish Resistance** |
| **LL** | Lower Low | Current Low is lower than the previous Low | **Strongly Bearish** |

---

## 3. Defining the Trend

### 📈 Bullish Trend (Uptrend)
Characterized by a sequence of **Higher Highs (HH)** and **Higher Lows (HL)**.
*   **Logic**: Every time the market pulls back, it stays above the previous low (HL). Every time it pushes up, it breaks the previous ceiling (HH).
*   **Label in App**: `HH-HL`

### 📉 Bearish Trend (Downtrend)
Characterized by a sequence of **Lower Highs (LH)** and **Lower Lows (LL)**.
*   **Logic**: Every time the market bounces, it fails to reach the previous high (LH). Every time it drops, it breaks the previous floor (LL).
*   **Label in App**: `LH-LL`

---

## 4. Structural Shifts (Transitions)

The trend "breaks" when the sequence of HH/HL or LH/LL is interrupted.

### Change of Character (CHoCH)
The first sign that a trend might be ending.
*   **Example**: In an uptrend (HH-HL), price suddenly drops and breaks below the most recent **HL**. This creates a **LL**, signaling potential reversal.

### Break of Structure (BOS)
Confirmation that the trend is continuing.
*   **Example**: In an uptrend, as soon as price breaks the previous **HH**, a new **BOS** occurs, confirming the bulls are still in control.

---

## 5. How to use it for Backtesting

When logging your trades in this application, you can use the **Pivot Position** metadata to categorize your entry:

1.  **HH-HL (Buying the Dip)**: Entering a LONG trade after a Higher Low is formed, anticipating a new Higher High.
2.  **LH-LL (Selling the Rally)**: Entering a SHORT trade after a Lower High is formed, anticipating a new Lower Low.
3.  **CHoCH (Reversal)**: Entering as the structure shifts from LH-LL to HH-HL (Bottom fishing) or vice-versa.

---

## Summary Checklist
*   **Uptrend?** Look for HL (Higher Lows).
*   **Downtrend?** Look for LH (Lower Highs).
*   **Sideways?** Highs and Lows are at roughly the same level (Equal Highs/Lows).
