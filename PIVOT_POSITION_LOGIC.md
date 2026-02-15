# Final Pivot Position Detection Logic

## ✅ Asymmetric Detection Rules

The detection logic is **asymmetric** - it uses different rules for checking the opposite side vs. the same side as the trade direction.

---

## 🎯 Detection Priority Order

### For LONG Trades (BUY):

1. **Gap-Opposite** (Highest Priority)
   - Check: ALL three candles' **CLOSE** prices below MA
   - Rule: Close prices only, ignore wicks
   - Example: Close1=100, Close2=102, Close3=101, MA=105 → gap-opposite ✅

2. **On-MA** (Second Priority)
   - Check: ANY candle's **WICK** (low) touches MA from above
   - Rule: Candle body is above MA, but wick reaches down to touch it
   - Example: Candle with Low=104, High=110, Close=108, MA=105 → on-MA ✅

3. **Gap** (Default)
   - When neither gap-opposite nor on-MA conditions are met
   - All candles are above MA without touching it

---

### For SHORT Trades (SELL):

1. **Gap-Opposite** (Highest Priority)
   - Check: ALL three candles' **CLOSE** prices above MA
   - Rule: Close prices only, ignore wicks
   - Example: Close1=110, Close2=112, Close3=111, MA=105 → gap-opposite ✅

2. **On-MA** (Second Priority)
   - Check: ANY candle's **WICK** (high) touches MA from below
   - Rule: Candle body is below MA, but wick reaches up to touch it
   - Example: Candle with Low=100, High=106, Close=102, MA=105 → on-MA ✅

3. **Gap** (Default)
   - When neither gap-opposite nor on-MA conditions are met
   - All candles are below MA without touching it

---

## 📊 Visual Examples

### Example 1: LONG Trade - Gap-Opposite ✅
```
Candle 1: Close=100, Low=98,  High=102, MA=105
Candle 2: Close=102, Low=100, High=104, MA=104
Candle 3: Close=101, Low=99,  High=103, MA=103

Check 1: All closes below MA? YES (100<105, 102<104, 101<103)
Result: gap-opposite
```

### Example 2: LONG Trade - On-MA ✅
```
Candle 1: Close=108, Low=104, High=110, MA=105
Candle 2: Close=112, Low=108, High=114, MA=104
Candle 3: Close=111, Low=107, High=113, MA=103

Check 1: All closes below MA? NO
Check 2: Any wick touches MA? YES (Candle 1: Low=104 <= MA=105 <= High=110)
Result: on-MA
```

### Example 3: LONG Trade - Gap ✅
```
Candle 1: Close=110, Low=108, High=112, MA=105
Candle 2: Close=112, Low=110, High=114, MA=104
Candle 3: Close=111, Low=109, High=113, MA=103

Check 1: All closes below MA? NO
Check 2: Any wick touches MA? NO (all lows > MA)
Result: gap
```

### Example 4: SHORT Trade - Gap-Opposite ✅
```
Candle 1: Close=110, Low=108, High=112, MA=105
Candle 2: Close=112, Low=110, High=114, MA=104
Candle 3: Close=111, Low=109, High=113, MA=103

Check 1: All closes above MA? YES (110>105, 112>104, 111>103)
Result: gap-opposite
```

### Example 5: SHORT Trade - On-MA ✅
```
Candle 1: Close=102, Low=100, High=106, MA=105
Candle 2: Close=98,  Low=96,  High=100, MA=104
Candle 3: Close=99,  Low=97,  High=101, MA=103

Check 1: All closes above MA? NO
Check 2: Any wick touches MA? YES (Candle 1: Low=100 <= MA=105 <= High=106)
Result: on-MA
```

---

## 🔑 Key Principles

1. **Gap-Opposite is Strict**
   - Uses CLOSE prices only
   - ALL three candles must satisfy
   - Opposite side from trade direction

2. **On-MA Uses Wicks**
   - Checks if candle body crosses MA
   - Only needs ONE candle to touch
   - Same side as trade direction

3. **Priority Matters**
   - Gap-opposite checked first
   - On-MA checked second
   - Gap is the fallback

4. **Asymmetric Logic**
   - Opposite side: strict close check
   - Same side: lenient wick check
   - This matches real trading behavior

---

## 🧪 Your Original Scenario

**Scenario:**
```
Candle 1 (current): High crossed above MA, Close below MA
Candle 2 (prev):    Close/High below MA
Candle 3 (2 back):  Close/High below MA
Trade: LONG
```

**Detection:**
```
Step 1: Check gap-opposite
  - All closes below MA? YES ✅
  - Result: gap-opposite

(On-MA check is skipped because gap-opposite already matched)
```

**Result: gap-opposite** ✅ (Correct!)

---

## 💡 Why This Logic?

This asymmetric approach makes sense because:

1. **Gap-Opposite is Risky**: Trading against the MA requires strict confirmation (all closes on wrong side)

2. **On-MA is Common**: Pullbacks to MA are normal, so we check wicks to catch these opportunities

3. **Matches Trading Reality**: Traders look at closes for trend confirmation, but wicks for support/resistance

4. **Clear Priority**: Gap-opposite (risky) is identified first, then on-MA (opportunity), then gap (safe)
