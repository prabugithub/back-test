# Gap-Opposite Detection Logic - Visual Examples

## Understanding the Improved Detection

The **Gap-Opposite** detection now uses a **strict rule**: **ALL three pivot candles must close on the opposite side of the MA**.

---

## Example Scenarios for LONG Trades (BUY)

### Scenario 1: Gap-Opposite ✅
```
Candle 1 Close: 100 | MA: 105 | Close < MA ✓
Candle 2 Close: 102 | MA: 104 | Close < MA ✓
Candle 3 Close: 101 | MA: 103 | Close < MA ✓

Result: gap-opposite (all three closes below MA)
```

### Scenario 2: Gap (Not Gap-Opposite) ✅
```
Candle 1 Close: 100 | MA: 105 | Close < MA ✓
Candle 2 Close: 106 | MA: 104 | Close > MA ✗
Candle 3 Close: 101 | MA: 103 | Close < MA ✓

Result: gap (NOT all closes below MA - one is above)
```

### Scenario 3: Gap ✅
```
Candle 1 Close: 110 | MA: 105 | Close > MA
Candle 2 Close: 112 | MA: 104 | Close > MA
Candle 3 Close: 111 | MA: 103 | Close > MA

Result: gap (all closes above MA - same side as trade direction)
```

### Scenario 4: On-MA (Takes Priority) ✅
```
Candle 1: Low=100, High=110, Close=108 | MA: 105 (MA between low and high)
Candle 2: Low=102, High=108, Close=106 | MA: 104
Candle 3: Low=101, High=107, Close=105 | MA: 103

Result: on-MA (candle 1 touches MA, this takes priority)
```

---

## Example Scenarios for SHORT Trades (SELL)

### Scenario 1: Gap-Opposite ✅
```
Candle 1 Close: 110 | MA: 105 | Close > MA ✓
Candle 2 Close: 112 | MA: 104 | Close > MA ✓
Candle 3 Close: 111 | MA: 103 | Close > MA ✓

Result: gap-opposite (all three closes above MA)
```

### Scenario 2: Gap (Not Gap-Opposite) ✅
```
Candle 1 Close: 110 | MA: 105 | Close > MA ✓
Candle 2 Close: 102 | MA: 104 | Close < MA ✗
Candle 3 Close: 111 | MA: 103 | Close > MA ✓

Result: gap (NOT all closes above MA - one is below)
```

### Scenario 3: Gap ✅
```
Candle 1 Close: 100 | MA: 105 | Close < MA
Candle 2 Close: 98  | MA: 104 | Close < MA
Candle 3 Close: 99  | MA: 103 | Close < MA

Result: gap (all closes below MA - same side as trade direction)
```

---

## Key Points

1. **On-MA has highest priority**: If any candle touches MA (MA between low and high), result is "on-MA"

2. **Gap-Opposite is strict**: ALL three candles must close on opposite side
   - Long trade: ALL three must close below MA
   - Short trade: ALL three must close above MA

3. **Gap is the default**: When not on-MA and not gap-opposite
   - Includes cases where candles are on "correct" side
   - Includes mixed cases (some above, some below)

4. **Wicks don't matter for gap-opposite**: Only the **close price** is checked
   - A candle can have a wick touching MA, but if close is on one side, that's what counts
   - Exception: If wick causes candle to "touch" MA, then it's "on-MA"

---

## Decision Tree

```
Is any candle touching MA (MA between low and high)?
├─ YES → on-MA
└─ NO
   ├─ LONG Trade:
   │  ├─ All 3 closes below MA? → gap-opposite
   │  └─ Otherwise → gap
   └─ SHORT Trade:
      ├─ All 3 closes above MA? → gap-opposite
      └─ Otherwise → gap
```

---

## Why This Logic?

This improved logic provides:
- **More accurate detection**: Checks actual close prices, not just pivot point
- **Clearer distinction**: Gap-opposite is now a specific, strict condition
- **Better alignment with trading**: Close prices are what matter for actual trades
- **Handles mixed scenarios**: Mixed candles default to "gap" which is safer
