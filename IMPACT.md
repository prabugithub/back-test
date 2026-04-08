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
| `trades` | TradeHistoryDialog, SessionStats | executeTrade, deleteTrade, editTrade | MEDIUM |
| `drawings` | useChartDrawings (primary), AdvancedChart (primary) | setDrawings (auto-patches Firestore 2s debounce) | LOW |
| `secondaryDrawings` | useChartDrawings (secondary), AdvancedChart (secondary) | setSecondaryDrawings (auto-patches Firestore 2s debounce) | LOW |
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

## PerformanceDashboard.tsx

- **Data source:** Firebase Firestore snapshots only (`listSnapshots()` — `snapshot_session_*` prefix, sorted by `archivedAt` desc). **Does NOT read `sessionStore.trades` or localStorage.** This prevents double-counting when the current session is already saved as a snapshot.
- **Snapshot selector state:** `selectedSnapshotIds: Set<string>` — empty = all included; non-empty = only matching IDs included. Toggling automatically returns to "all" when all boxes are re-checked.
- **Instrument filter** is populated from `snapshot.instrument` across all loaded snapshots.
- **`liveTrades` prop** is still accepted (for backward compat with App.tsx) but is no longer processed — it has no effect on displayed data. If the current session should appear in analytics, save a snapshot first.
- **Option Backtest button** passes `filteredPositions` (already instrument+category filtered) to `OptionBacktestModal`. Instrument is inferred from `selectedInstrument` (falls back to `'NIFTY'` when `'All'`).

**Check when changing:** Ensure `listSnapshots()` still filters to `snapshot_session_*` prefix — any change to Firestore document naming would break the data load. Snapshot selector logic relies on `s.id` being defined; new snapshot writes must always include an `id` field.

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

**`updateCurrentSessionDrawings(drawings)`** — new lightweight patch function. Uses `updateDoc` to patch only `uiSettings.drawings` without rotating history. Called by `setDrawings` (2s debounce). Silently no-ops if the session document does not yet exist.

---

## useChartDrawings.ts (hook)

- **RR tool** sets `manualLevels` in store — this disables `setTargetRR` TP recalculation
- Drawings are written to store `drawings[]` and saved with session
- Does NOT affect trade execution directly — only sets `manualLevels` for the next trade
- **Per-chart drawings:** `isSecondary` prop controls which store field (`drawings` vs `secondaryDrawings`) and which setter the hook reads/writes. Clear All and Undo only affect the active chart.
- **Undo history:** maintains up to 5 previous snapshots per chart instance in a local ref; Ctrl+Z restores them via the chart-specific setter (which also triggers the auto-save debounce).
- **Known gap:** undoing an RR drawing deletion restores the drawing visually but does NOT restore `manualLevels`. The user must nudge the RR drawing to re-trigger `setManualLevels`.

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
| `POST /api/options/backtest` | Run options P&L simulation via Dhan rolling option API |

### `backtest.options.service.ts`

- `INSTRUMENT_CONFIG` map drives `securityId` selection: `NIFTY → '13'`, `BANKNIFTY → '25'`. Add new instruments here.
- `instrument` param comes from `OptionBacktestModal` which infers it from the active instrument filter in `PerformanceDashboard`.
- **Check when changing:** If Dhan changes `securityId` values or adds new instruments, update `INSTRUMENT_CONFIG`. Strike offset notation (`ATM+N`) is Dhan-specific — verify the rolling option API still accepts this format.

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
