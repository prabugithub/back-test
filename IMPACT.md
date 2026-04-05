# Impact Map — Manual Backtesting System

This document answers: **"If I change X, what else do I need to check?"**

Keep this updated whenever the architecture changes (new component, store action, API route, etc.).

---

## sessionStore.ts (Zustand store)

The central store. Changes here have the widest blast radius.

### Store state fields

| Field | Read by | Written by | Risk |
|-------|---------|-----------|------|
| `position` | PositionOverlay, SessionStats, PlaybackControls, checkSLTPHits, AdvancedChart | executeTrade, initiateTrade, updatePositionTarget, updatePositionSL, resetSession | HIGH |
| `targetRR` | PlaybackControls (trade entry calc), setTargetRR | setTargetRR (Trade Settings input) | HIGH — now also recalculates position.target |
| `autoExitTarget` | checkSLTPHits (read at check-time) | setAutoExitTarget (Trade Settings checkbox) | HIGH |
| `manualLevels` | handleExecuteTrade in PlaybackControls, setTargetRR (guard) | useChartDrawings RR tool, clearManualLevels | HIGH — guards TP recalculation |
| `candles` | AdvancedChart, SessionStats, PlaybackControls | setCandles (data load), restoreSessionState | MEDIUM |
| `trades` | TradeHistoryDialog, SessionStats, PerformanceDashboard | executeTrade, deleteTrade, editTrade | MEDIUM |
| `drawings` | useChartDrawings, AdvancedChart canvas | addDrawing, clearDrawings | LOW |
| `sessionConfig` | PlaybackControls (Data Settings form) | performDataReload | MEDIUM |

### Store actions — impact chains

#### `setTargetRR(rr)`
→ updates `targetRR`
→ if no `manualLevels` AND position with valid SL → calls `updatePositionTarget(newTarget)`
→ `updatePositionTarget` → updates `position.target`, resets `tpHit`/`tpDialogShown`
→ if live mode → syncs to `positionMonitor.service.ts` via `updatePositionMonitor()`
→ PositionOverlay re-renders with new TP
→ next `checkSLTPHits` uses new target

**Check when changing:** PositionOverlay (display), checkSLTPHits (auto-exit), positionMonitor (live sync), manualLevels guard

#### `updatePositionTarget(newTarget)` / `updatePositionSL(newSL)`
→ updates `position.target` / `position.stopLoss`
→ resets `tpHit`/`tpDialogShown` (or `slHit`) — **re-enables exit trigger at new level**
→ if live mode → syncs to backend monitor
→ notifies user ("Target updated to X")

**Check when changing:** Live mode sync, notification spam, flag reset side-effects

#### `executeTrade(type, qty, price)`
→ FIFO P&L calculation
→ updates `position`, pushes to `trades[]`
→ opens TradeJournalDialog (on entry) or TradeExitDialog (on close)
→ if position closed: realized P&L calculated, position reset

**Check when changing:** P&L math (FIFO), TradeJournalDialog, TradeExitDialog, SessionStats

#### `checkSLTPHits(candle)`
→ called on **every candle advance** in PlaybackControls
→ reads `position.stopLoss`, `position.target`, `autoExitTarget`, `tpDialogShown`
→ may trigger `executeSmartExit()` or show TP/SL dialog

**Check when changing:** Any flag reset logic, autoExitTarget read timing, dialog trigger conditions

#### `initiateTrade(type, qty, sl, target)`
→ called from PlaybackControls handleExecuteTrade
→ uses `manualLevels` (if set) OR pivot-based SL/TP with `targetRR`
→ clears `manualLevels` after use

**Check when changing:** manualLevels clearing, targetRR snapshot at entry

#### `restoreSessionState(state)`
→ restores all fields from Firestore snapshot
→ restores `uiSettings` (targetRR, autoExitTarget, drawings, etc.) + `position` + `trades`
→ **Known gap:** restored `targetRR` and `position.target` may be inconsistent if RR was changed between saves

**Check when changing:** What fields are included in snapshot, field ordering, default fallbacks

---

## PlaybackControls.tsx

### Settings panels

| Panel | Trigger | What it controls |
|-------|---------|-----------------|
| Data Settings (gear icon) | `showSettings` state | Timeframe, date range, jump-to-date → "Load Data" triggers `performDataReload` |
| Trade Settings (sliders icon) | `showTradeSettings` state | targetRR (debounced 400ms), autoExitTarget, secondary chart — all instant |

**If adding a setting:** decide Data vs Trade panel based on whether it requires a data reload.

### Trade entry (`handleExecuteTrade`)
→ reads `manualLevels` first, falls back to pivot + `targetRR`
→ calls `initiateTrade()`
→ `targetRR` captured at this moment — subsequent RR changes recalculate via `setTargetRR`

### Candle advance (`handleStep`, auto-play)
→ advances `currentIndex`
→ calls `checkSLTPHits(currentCandle)`
→ fires TP/SL auto-exit if conditions met

---

## PositionOverlay.tsx

- **Reads:** `position.stopLoss`, `position.target`, `position.averagePrice`, `position.quantity`
- **Writes (via store):** `updatePositionTarget`, `updatePositionSL`
- Inline edit of SL/TP → calls store actions → triggers live sync if applicable
- **Known gap:** no flag distinguishing "user manually set TP" vs "RR-calculated TP" — changing RR overwrites manual edits

---

## positionMonitor.service.ts (backend)

- Only active during **live trading** (`isLiveMode = true`)
- Reads `MonitoredPosition.target` and `MonitoredPosition.stopLoss` on every tick
- Updated via `updatePositionMonitor(token, { target, stopLoss })`
- Called from: `updatePositionTarget`, `updatePositionSL` (when live)

**Check when changing:** ensure frontend always syncs changes to backend when live

---

## firebaseSessionService.ts

### What is persisted
```
uiSettings: { drawings, primaryIndicators, secondaryIndicators, secondaryTimeframe,
               showSecondaryChart, tradeQuantity, riskPerTrade, targetRR, autoExitTarget,
               useAtrForSignals, showPivotRR }
position: { ...full position object including stopLoss, target }
trades: [ ...all trades ]
candles + currentIndex
sessionConfig
```

**Known gap:** `targetRR` (in uiSettings) and `position.target` are persisted separately — restoring an old snapshot can produce a mismatch.

---

## useChartDrawings.ts (hook)

- **RR tool** sets `manualLevels` in store — this disables `setTargetRR` TP recalculation
- Drawings are written to store `drawings[]` and saved with session
- Does NOT affect trade execution directly — only sets `manualLevels` for the next trade

---

## AdvancedChart.tsx

- **Read-only** from a store perspective — renders candles, indicators, SL/TP lines, markers
- SL/TP lines drawn from `position.stopLoss` and `position.target`
- Safe to modify without store impact analysis (visual changes only)
- Theoretical 1:1, 1:2, 1:3 RR lines shown based on pivot — **not** the actual position TP

---

## API Routes (backend)

| Route | Effect |
|-------|--------|
| `GET /api/candles` | Fetch + cache candles; triggers frontend reload |
| `POST /api/live/order` | Place real Dhan order |
| `POST /api/live/smart-exit` | Start order chaser loop |
| `PUT /api/live/monitor/:id` | Update live position SL/TP in backend monitor |
| `POST /api/screenshot/upload` | Upload chart PNG to Google Drive |
| `POST /api/options/backtest` | Run options P&L simulation |

---

## Change Checklist

Before merging any change to a HIGH-risk area:

- [ ] Read IMPACT.md section for the changed area
- [ ] Checked all "Read by" components for the affected store field
- [ ] Verified live-mode sync path (positionMonitor) if changing position fields
- [ ] Verified session save/restore still works for changed fields
- [ ] No notification spam introduced (debounce on frequent inputs)
- [ ] No silent no-op when preconditions not met (notify user)
- [ ] FEATURES_GUIDE.md updated if user-facing behavior changed
