# Automatic Pivot Detection Implementation

## Overview
This implementation adds automatic detection and population of pivot-related fields in the Trade Journal Dialog:
1. **LLHH-Pivot**: Automatically detects the pivot pattern (HH-HL, HH-LL, LH-HL, LH-LL)
2. **PivotPosition**: Automatically determines if the pivot is on-MA, gap, or gap-opposite

## Changes Made

### 1. New Utility Module: `pivotAnalysis.ts`
**Location**: `frontend/src/utils/pivotAnalysis.ts`

This module provides the `analyzePivotForTrade()` function that:
- Analyzes candles up to the current index
- Calculates pivot points using existing `calculatePivotPoints()` function
- Determines LLHH-Pivot pattern based on recent bullish and bearish pivots
- Determines PivotPosition based on the relationship between pivot candles and EMA21

#### LLHH-Pivot Detection Logic
- Finds the most recent bullish pivot (with HL or LL label)
- Finds the most recent bearish pivot (with HH or LH label)
- Combines them to form the pattern: `{BearishLabel}-{BullishLabel}`
- Examples: HH-HL, HH-LL, LH-HL, LH-LL

#### PivotPosition Detection Logic
The position is determined using **asymmetric rules** - different checks for opposite side vs. same side:

**For LONG Trades (BUY):**

1. **Gap-Opposite** (Priority 1): ALL three candles' **close prices** below MA
   - Checks: Close prices only, ignores wicks
   - Strict condition: All three must satisfy

2. **On-MA** (Priority 2): ANY candle's **wick** (low) touches MA from above
   - Checks: If low ≤ MA ≤ high (candle crosses MA)
   - Lenient condition: Only one candle needs to touch

3. **Gap** (Default): Neither gap-opposite nor on-MA
   - All candles above MA without touching

**For SHORT Trades (SELL):**

1. **Gap-Opposite** (Priority 1): ALL three candles' **close prices** above MA
   - Checks: Close prices only, ignores wicks
   - Strict condition: All three must satisfy

2. **On-MA** (Priority 2): ANY candle's **wick** (high) touches MA from below
   - Checks: If low ≤ MA ≤ high (candle crosses MA)
   - Lenient condition: Only one candle needs to touch

3. **Gap** (Default): Neither gap-opposite nor on-MA
   - All candles below MA without touching

**Key Principle**: 
- **Opposite side** (gap-opposite): Strict check using **close prices only**
- **Same side** (on-MA): Lenient check using **wicks**
- This asymmetry matches real trading behavior where closes confirm trend but wicks show support/resistance


### 2. Updated TradeJournalDialog Component
**Location**: `frontend/src/components/TradeJournalDialog.tsx`

**Changes**:
- Added import for `analyzePivotForTrade` utility
- Added access to `candles` and `currentIndex` from session store
- Modified `useEffect` hook to automatically populate pivot fields when dialog opens
- Only runs automatic detection for entry trades (not exit trades)
- Users can still manually override the auto-detected values

**Code Flow**:
```typescript
useEffect(() => {
    if (pendingTradeRequest) {
        // Automatically analyze pivot for entry trades
        let autoPivotPosition = 'gap';
        let autoLlhhPivot = 'HH-HL';
        
        if (!isPositionOpen && candles.length > 0 && currentIndex >= 0) {
            const pivotAnalysis = analyzePivotForTrade(
                candles, 
                currentIndex, 
                pendingTradeRequest.type
            );
            if (pivotAnalysis.pivotPosition) {
                autoPivotPosition = pivotAnalysis.pivotPosition;
            }
            if (pivotAnalysis.llhhPivot) {
                autoLlhhPivot = pivotAnalysis.llhhPivot;
            }
        }
        
        setJournal({
            ...defaultValues,
            pivotPosition: autoPivotPosition,
            llhhPivot: autoLlhhPivot,
        });
    }
}, [pendingTradeRequest, isPositionOpen, candles, currentIndex]);
```

## User Experience

### Before
- Users had to manually select LLHH-Pivot from dropdown (HH-HL, HH-LL, LH-HL, LH-LL)
- Users had to manually select PivotPosition from dropdown (gap, on-MA, gap-opposite)

### After
- **LLHH-Pivot** is automatically populated based on the most recent pivot points
- **PivotPosition** is automatically populated based on the pivot's relationship to EMA21
- Users can still manually change these values if the automatic detection is incorrect
- Only applies to entry trades (not exit trades)

## Technical Details

### Dependencies
- Uses existing `calculatePivotPoints()` from `utils/indicators.ts`
- Uses existing `calculateEMA()` from `utils/indicators.ts`
- Leverages the `PivotPoint` interface with `trendLabel` property

### Edge Cases Handled
1. **Insufficient candles**: Returns empty strings if not enough data
2. **No pivots detected**: Returns empty strings
3. **Missing trend labels**: Returns empty string for LLHH-Pivot
4. **MA not available**: Returns empty string for PivotPosition
5. **Exit trades**: Skips automatic detection (manual entry only)

### Performance
- Analysis runs only when the dialog opens
- Uses existing candle data (no additional API calls)
- Efficient array operations with early returns

## Testing Recommendations

1. **Test with various pivot patterns**:
   - Verify HH-HL detection in uptrend
   - Verify LH-LL detection in downtrend
   - Verify mixed patterns (HH-LL, LH-HL)

2. **Test pivot position detection**:
   - **On-MA**: Any pivot candle touching MA → should show "on-MA"
   - **Gap (Long trade)**:
     - All three pivot candles close above MA → should show "gap"
     - Mixed candles (some above, some below MA) → should show "gap"
     - Two candles close above, one below → should show "gap"
   - **Gap-Opposite (Long trade)**:
     - All three pivot candles close below MA → should show "gap-opposite"
     - Two candles below, one above → should show "gap" (not gap-opposite)
   - **Gap (Short trade)**:
     - All three pivot candles close below MA → should show "gap"
     - Mixed candles → should show "gap"
   - **Gap-Opposite (Short trade)**:
     - All three pivot candles close above MA → should show "gap-opposite"
     - Two candles above, one below → should show "gap" (not gap-opposite)

3. **Test edge cases**:
   - Very early in chart (few candles)
   - No clear pivots
   - Manual override still works
   - Candles with wicks touching MA but closes on one side


## Future Enhancements

Potential improvements for future iterations:
1. Add visual indicators on the chart showing detected pivots
2. Allow configuration of which MA to use (currently hardcoded to EMA21)
3. Add confidence score for automatic detection
4. Show tooltip explaining why a particular value was auto-selected
5. Add option to disable automatic detection in settings
