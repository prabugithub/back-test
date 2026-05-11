# Impact Map — Manual Backtesting System

This document answers: **"If I change X, what else do I need to check?"**

Keep this updated whenever the architecture changes (new component, store action, API route, etc.).

---

## Store Architecture (Phase 3 — Action Module Split)

`sessionStore.ts` is now a **thin composition layer** — it holds state definitions and wires three action modules via spread. Logic lives in the action files, not in sessionStore itself.

| File | Owns | Boundary contract |
|------|------|-------------------|
| `stores/sessionStore.ts` | State shape, `StoreSet`/`StoreGet` types, initial values | No logic — composition only |
| `stores/backtestActions.ts` | Playback, candle nav, trade dialog, session reset | `@backtest-only` — must never import `liveExecutionService` or live API fns |
| `stores/liveActions.ts` | Live tick handling, candle updates, position sync | `@live-only` — must never import backtest or playback logic |
| `stores/sharedActions.ts` | `executeTrade`, `checkSLTPHits`, Firebase, drawings, indicators | May import `liveExecutionService` for the live dispatch path |
| `services/liveExecutionService.ts` | All Dhan broker API calls, ATM resolution, smart exit, fill polling | `@live-only` — never import by backtest-only code |

**When adding a new action:** put it in the module that matches its mode. If it truly belongs to both, put it in `sharedActions.ts` with a live guard at the top (`if (isLiveMode) { ... return; }`).

---

## sessionStore.ts (state fields)

### Store state fields

| Field | Read by | Written by | Risk |
|-------|---------|-----------|------|
| `position` | PositionOverlay, SessionStats, PlaybackControls, checkSLTPHits, AdvancedChart | executeTrade, initiateTrade, updatePositionTarget, updatePositionSL, resetSession | HIGH |
| `targetRR` | PlaybackControls (trade entry calc), setTargetRR | setTargetRR (Trade Settings input) | HIGH — now also recalculates position.target |
| `autoExitTarget` | checkSLTPHits (read at check-time) | setAutoExitTarget (Trade Settings checkbox) | HIGH |
| `manualLevels` | handleExecuteTrade in PlaybackControls, setTargetRR (guard) | useChartDrawings RR tool, clearManualLevels | HIGH — guards TP recalculation |
| `candles` | AdvancedChart, SessionStats, PlaybackControls | loadCandles (data load), addLiveCandle, restoreSessionState | MEDIUM |
| `trades` | TradeHistoryDialog, SessionStats | executeTrade, deleteTrade, editTrade | MEDIUM |
| `drawings` | useChartDrawings (primary), AdvancedChart (primary) | setDrawings (auto-patches Firestore 2s debounce) | LOW |
| `secondaryDrawings` | useChartDrawings (secondary), AdvancedChart (secondary) | setSecondaryDrawings (auto-patches Firestore 2s debounce) | LOW |
| `sessionConfig` | PlaybackControls (Data Settings form) | performDataReload | MEDIUM |
| `secondaryCandles` | AdvancedChart (secondary chart in live mode) | loadSecondaryCandles, addLiveCandle, setSecondaryTimeframe | LOW — live mode only; backtest ignores this field |

---

## backtestActions.ts

Owns all backtest-only logic. Every action guards `if (get().isLiveMode) return` at the top.

#### `loadCandles(candles, instrument, config)`
→ blocked when `position.liveOptionToken` is set (active live option) — not by `isLiveMode` broadly
→ resets trades, position, playback state, manualLevels

**Check when changing:** live position guard condition, state fields reset list

#### `initiateTrade(type, qty, sl, target)`
→ called from PlaybackControls handleExecuteTrade
→ uses `manualLevels` (if set) OR pivot-based SL/TP with `targetRR`
→ clears `manualLevels` after use

**Check when changing:** manualLevels clearing, targetRR snapshot at entry

#### `resolveExitRequest(confirm, journal)`
→ called when user confirms/dismisses SL or TP dialog
→ on confirm: calls `executeTrade()` with the pending exit type
→ on dismiss: marks `slDialogShown`/`tpDialogShown` so dialog won't re-fire

**Check when changing:** flag reset logic, pendingExitRequest cleared path

#### `resetSession()`
→ blocked in live mode (notifies user)
→ resets index, trades, position, playback state

---

## sharedActions.ts

Handles logic that runs in both modes. Live path is always top-guarded with an early return so backtest code below is never reached in live mode.

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
→ **Live path (top guard):** calls `executeLiveOrder()` in `liveExecutionService.ts` → returns early if result is null
→ **Shared path:** FIFO P&L calculation, updates `position`, pushes to `trades[]`
→ if new position and live mode: calls `registerMonitorIfNeeded()`
→ if `pendingOrderId` set and live mode: calls `pollOrderFillStatus()` 2s later

**Check when changing:** P&L math (FIFO), TradeJournalDialog, TradeExitDialog, SessionStats, live monitor registration

#### `checkSLTPHits(index, currentPrice?)`
→ called on every candle advance (backtest) and on every live price tick
→ **Live option guard (hard return at line ~136):** if `isLiveMode && liveOptionToken`, updates hit flags for display only and returns — backtest dialog/auto-exit code is physically unreachable
→ **Backtest path:** may trigger `pendingExitRequest` dialog or auto-exit TP

**Check when changing:** live guard condition, flag reset logic, autoExitTarget read timing, dialog trigger conditions

#### `restoreSessionState(state)`
→ restores all fields from Firestore snapshot
→ restores `uiSettings` (targetRR, autoExitTarget, drawings, etc.) + `position` + `trades`
→ **Known gap:** restored `targetRR` and `position.target` may be inconsistent if RR was changed between saves

**Check when changing:** What fields are included in snapshot, field ordering, default fallbacks

---

## liveActions.ts

#### `setLiveMode(isLive)`
→ starts/clears the 3s `syncLivePositions` interval (interval scoped inside closure — not module-level)
→ on enable: jumps `currentIndex` to latest candle, fires initial sync

#### `syncLivePositions()`
→ polls `getLivePositions()` from broker every 3s
→ matches by `liveOptionToken` if store has one, otherwise takes first open FNO position
→ if no broker position found and store has one: clears store position (notifies user)

**Check when changing:** token matching logic, position clear condition, notification spam

#### `loadSecondaryCandles()`
→ fetches HTF candles from Dhan API for the active `secondaryTimeframe`
→ Dhan-unsupported intervals (30min, 2hr, 4hr) are fetched at the nearest supported interval then resampled
→ trims result to the last 3000 candles and writes to `secondaryCandles`
→ called automatically on `setLiveMode(true)` (if secondary TF is set) and on `setSecondaryTimeframe()` in live mode

**Check when changing:** `HTF_INTERVAL_MAP` / `HTF_LOOKBACK_DAYS` constants in liveActions.ts, `sessionConfig` shape (securityId, exchangeSegment, instrumentType)

#### `addLiveCandle(candle)`
→ if same timestamp as last candle: updates OHLCV in-place (sets `isLivePriceUpdate = true`)
→ if new timestamp: appends new candle (sets `isLivePriceUpdate = false`)
→ `isLivePriceUpdate` flag lets AdvancedChart skip expensive rebuilds on price-only ticks
→ also incrementally updates `secondaryCandles`: extends last HTF candle if tick is in same IST bucket, otherwise appends a new HTF candle

**Check when changing:** `getISTBucket()` in resampler.ts (bucket alignment must match `loadSecondaryCandles` resampling)

---

## liveExecutionService.ts

All Dhan broker API calls live here. Called only from `sharedActions.ts` executeTrade live path.

#### `executeLiveOrder(input, notify)`
→ resolves ATM option (NIFTY/BANKNIFTY) or uses existing `liveOptionToken` for exits
→ for SL exits: fetches option LTP → fires `executeSmartExit()` (3-step chaser)
→ for other orders: places LIMIT (with LTP) or MARKET fallback
→ returns `{ atmOptionToken, tradeOptionType, finalQuantity, pendingOrderId }` or `null` if blocked/failed
→ **Guard:** never sends index token (`IDX_I`, securityId 13/25) to Dhan — throws on violation

#### `pollOrderFillStatus(orderId, callbacks)`
→ polls `getOrderStatus()` 2s after placement
→ calls `onRejected` / `onPartialFill` / `onFilled` — state updates handled by caller (sharedActions)
→ unregisters backend monitor on rejection to prevent phantom position

**Check when changing:** token validation guard, smart exit vs LIMIT/MARKET selection logic, fill callback contract

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
