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
| `position` | PositionOverlay, SessionStats, PlaybackControls, checkSLTPHits, AdvancedChart, runAutoTrailStop, runAutoExitCheck | executeTrade, initiateTrade, updatePositionTarget, updatePositionSL, resetSession, runAutoTrailStop | HIGH — now also carries `autoEntry`/`entryRegime`/`entryBarIndex`/`exitWithTrendSeen`/`exitAgainstBars`/`slTrailed` (auto exit engine state; all optional, absent on manual positions) |
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
→ if live mode → syncs to backend monitor via `syncTargetWithMonitor()`, which now returns `boolean` — on sync failure (PATCH 404, e.g. the position was never registered), `updatePositionTarget` notifies an **error** (not the misleading "Target updated" success) and returns without updating the "success" toast, since the local state already changed but the backend has no monitor for it. Deliberately does **not** auto-heal by calling `registerMonitorIfNeeded()` on failure — the backend's 404 is ambiguous between "never registered" and "already exited," and blind re-registration could re-arm exits on a position the backend already cleaned up.
→ notifies user ("Target updated to X") only on confirmed backend sync success (live) or always (backtest, no backend to sync)

**Check when changing:** Live mode sync, notification spam, flag reset side-effects

#### `executeTrade(type, qty, price, ..., exitReason, journal, entryMetricsOverride, autoMeta)`
→ **Live path (top guard):** on a fresh entry (`currentQty === 0`), blocks and notifies if both `stopLoss` and `target` are `undefined` — mirrors `POST /api/live/monitor`'s own requirement (400 `"At least one of stopLoss or target must be provided"`), but checked *before* the broker order is placed. Without this guard a trade could reach the broker (real position, real money) while `registerMonitorIfNeeded()`'s registration 400s and is swallowed in a `.catch()` — leaving a live position with **no backend SL/TP monitor at all**. Root cause was `PlaybackControls.tsx`'s `handleExecuteTrade` silently passing `sl`/`target` as `undefined` when no `manualLevels` and no matching pivot exist yet. Fixed 2026-07-16.
→ **Live path (top guard):** calls `executeLiveOrder()` in `liveExecutionService.ts` → returns early if result is null
→ **Shared path:** FIFO P&L calculation, updates `position`, pushes to `trades[]`
→ on entry (not `isReducing`): stamps `atrDepthAtEntry`, `barOverlapAtEntry`, `barRangeAvgAtEntry`/`bullBarRangeAvgAtEntry`/`bearBarRangeAvgAtEntry`, `efficiencyRatioAtEntry`, `highBreakCountAtEntry`/`lowBreakCountAtEntry`/`barBreakWindowAtEntry`, `ema21SlopeAtEntry`/`ema50SlopeAtEntry`, and `ema20GapBarRatioAtEntry`/`ema20CloseAboveRatioAtEntry`/`ema20InteractionWindowAtEntry` (raw regime instrumentation, read-only for now — see `calculateBarOverlap`/`calculateBarRanges`/`calculateEfficiencyRatio`/`calculateBarBreaks`/`calculateEMASlope`/`calculateEMAInteraction` in `pivotAnalysis.ts`, lookbacks controlled by `autoBacktestConfig.barOverlapLookback`/`barRangeLookback`/`efficiencyRatioLookback`/`barBreakLookback`/`ema21SlopeLookback`/`ema50SlopeLookback`/`emaInteractionLookback`)
→ **`exitReason` widened to `ExitReason`** (`types/index.ts`): `'SL'|'TP'|'MANUAL'|'TIME_OVER'|'REVERSAL'|'OPP_SIGNAL'|'LEG_DECAY'` — the last three only ever passed by `runAutoExitCheck` (see "Auto-Backtest Price-Action Exit Engine" below). Any code still matching the old 4-value union (switch statements, badge lookups) needs updating — see `exitReasonBadge()` in `tradeAnalysis.ts` for the shared badge-color/label mapping used by `TradeHistoryDialog`/`TradeReportDialog`.
→ **new optional `autoMeta?: { auto: true; regime: RegimeKey; barIndex: number }` param** (only passed by `runAutoBacktestCheck`) — on a fresh open/flip, stamps `position.autoEntry`/`entryRegime`/`entryBarIndex` and resets `exitWithTrendSeen`/`exitAgainstBars`/`slTrailed` to `undefined`; same-side adds/reduces carry the opener's stamps through unchanged. Manual entries (`autoMeta` omitted) leave all these fields `undefined` — **this is the gate that keeps the exit engine off manual positions.**
→ if new position and live mode and **no** `pendingOrderId`: calls `registerMonitorIfNeeded()` immediately
→ if `pendingOrderId` set and live mode: calls `pollOrderFillStatus()` 2s later; `registerMonitorIfNeeded()` is called inside `onFilled`/`onPartialFill` callbacks (not before fill confirmation)

**Check when changing:** P&L math (FIFO), TradeJournalDialog, TradeExitDialog, SessionStats, live monitor registration, pending-order guard in checkSLTPHits, `autoMeta` stamping (auto exit engine depends on it)

#### `checkSLTPHits(index, currentPrice?)`
→ called on every candle advance (backtest) and on every live price tick
→ **Pending-order guard (line ~72):** if `position.pendingOrderId` is set, returns immediately — entry order not yet confirmed filled, exits must not fire on a phantom position
→ **Live option guard (hard return at line ~136):** if `isLiveMode && liveOptionToken`, updates hit flags for display only and returns — backtest dialog/auto-exit code is physically unreachable
→ **Backtest path:** may trigger `pendingExitRequest` dialog or auto-exit TP
→ **Fill mode (`autoBacktestConfig.slTpFillMode`, default `'exact'`):** governs the price used to trigger/fill on this path (touch-detection at lines ~98-105 is unaffected, always uses intrabar high/low). `'exact'` fires the instant intrabar high/low touches `sl`/`tp` and fills at that exact level. `'close'` (legacy) only fires once the candle's `close` crosses the level, filled at that close — can overshoot the planned risk when a bar gaps through the level intrabar. Applies uniformly to **all** backtest trades (manual + auto-engine), since this function can't distinguish position origin; does **not** apply to the live-option guard path (owned by `backend/src/services/positionMonitor.service.ts`, tick-based market-order fills, already realistic). `batchBacktestSimulator.ts`'s SL/TP check mirrors this same mode/default.
→ `resolveExitRequest` (`backtestActions.ts`) fills the confirmed manual exit at `pendingExitRequest.price` (set here to the fill-mode-aware trigger price) — do not let that regress back to `candle.close`.

**Check when changing:** live guard condition, pending-order guard, flag reset logic, autoExitTarget read timing, dialog trigger conditions, `slTpFillMode` default/semantics

#### `restoreSessionState(state)`
→ restores all fields from Firestore snapshot
→ restores `uiSettings` (targetRR, autoExitTarget, drawings, etc.) + `position` + `trades`
→ if restoring a live position with `liveOptionToken` and no `pendingOrderId`: calls `registerMonitorIfNeeded()` so backend monitor is active after page refresh
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
→ if broker position found: updates store and calls `registerMonitorIfNeeded()` **only if the synced position has a `stopLoss` or `target`** (covers page-refresh path where monitor was lost). This poll is decoupled from any specific trade's lifecycle, so it can land in the network-round-trip window of a brand-new entry before `executeTrade`'s own `set({ position })` runs — without the guard, it would register with both levels blank (`currentStorePos` still `null`), 400 against the backend's own "need SL or TP" validation, and get correctly superseded moments later by the entry flow's real registration anyway. The guard just avoids that noisy, doomed-to-fail duplicate call. Fixed 2026-07-16.
→ if no broker position found and store has one: clears store position (notifies user) — **skips clear if `pendingOrderId` is set** (entry order still pending fill at broker)
→ **`quantity` sign is derived from the CE/PE suffix of `openPosition.tradingSymbol`, never from Dhan's `positionType`.** We only ever BUY options to open (CE for long, PE for short), so the broker's `positionType` is always `'LONG'` (bought = `buyQty > sellQty`) even for a short (PE) trade — it reflects "we own the option," not "we're long/short the underlying." Deriving sign from `positionType` previously flipped short positions to a positive `quantity` within the first 3s poll after entry, which made `registerMonitorIfNeeded()` re-register the backend monitor with `direction: 'LONG'` for a short trade — since a short's spot-level `stopLoss` sits above entry, the monitor's `price <= stopLoss` (LONG) check fired instantly. Fixed 2026-07-16.

**Check when changing:** token matching logic, position clear condition, pending-order guard, notification spam, monitor re-registration, quantity sign derivation (must stay keyed off option type, not broker `positionType`)

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

### Export Loaded Data (`handleExportCandlesCSV`, Data Settings panel)
→ reads `candles`, `instrument`, `sessionConfig.interval` directly from the store (read-only, no store action) and builds a CSV client-side via `Blob`/`URL.createObjectURL`
→ **not** a data reload — exports whatever is already in `candles` as-is; does not call `performDataReload`/`fetchCandles`
→ disabled when `candles.length === 0`

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
- `onTick` skips positions where `pendingFill: true` — entry order not yet confirmed filled
- `pendingFill` is set by the `POST /api/live/monitor` request body; cleared by `confirmPositionFill()` (called via `PATCH /api/live/monitor/:id` with `{ pendingFill: false }`)
- Updated via `updatePositionMonitor(token, { target, stopLoss })`
- Called from: `updatePositionTarget`, `updatePositionSL` (when live)
- `pending_fill` column persisted in SQLite; migrated via `ALTER TABLE` in `database.ts`

**Check when changing:** ensure frontend always syncs changes to backend when live; `pendingFill` guard must match fill-confirmation path in `pollOrderFillStatus` callbacks

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

## Auto-backtest regime instrumentation (`pivotAnalysis.ts`, `autoBacktestEngine.ts`)

- **`calculateBarOverlap(candles, currentIndex, lookback)`** in `utils/pivotAnalysis.ts` — rolling bar-to-bar overlap ratio (unclamped, can be negative for gapped bars) for the `lookback` bars ending at `currentIndex`. Shared by `sharedActions.ts` (`executeTrade`) and `utils/batchBacktestSimulator.ts` (`enterPosition`) to stamp `Trade.barOverlapAtEntry` at entry time. Phase 1 — raw capture only, no thresholding/labeling yet; not read by any UI.
- **`averageBarOverlap(ratios)`** in the same file — mean of the ratios array, stamped as `Trade.barOverlapAvgAtEntry`. Kept as a shared helper (not inlined at each call site) so both entry paths compute the average identically.
- **`AutoBacktestConfig.barOverlapLookback`** (default `8`) — global setting, editable via the "Overlap" input in `AutoBacktestPanel.tsx`. Both `executeTrade` and `runBatchSimulation` fall back to `?? 8` for sessions/configs saved before this field existed.
- Do **not** confuse this with the pre-existing 10-bar overlap check inside `analyzeMarketStructure()` (same file) — that one is hardcoded to the tail of whatever candle slice it's given and only used to pick `Bull-Trend` vs `Bull-Trending-range` labels; it is not parameterized by index and is unrelated to per-trade instrumentation.
- **`calculateBarRanges(candles, currentIndex, lookback)`** / **`averageBarRanges(samples)`** — same file, same shape (raw-array function + separate average helper). Range is plain `high - low` per bar (deliberately **not** the gap-adjusted true range `calculateATR` uses — different purpose, don't conflate the two). Classifies each bar `bull`/`bear`/`neutral` (`close` vs `open`); an exact doji (`close === open`) is `neutral` — excluded from the bull/bear split but still counted in the overall average. **Known limitation:** a near-doji (tiny nonzero body, big wicks) still sorts into bull or bear by sign, so it can inflate that bucket's average — no body-ratio threshold exists yet to catch this; deliberately deferred (no real data to calibrate a threshold against), same as bar-overlap thresholding. Stamped as `Trade.barRangeAvgAtEntry`/`bullBarRangeAvgAtEntry`/`bearBarRangeAvgAtEntry`; lookback is `AutoBacktestConfig.barRangeLookback` (default `20`), editable via the "Bar Range" input in `AutoBacktestPanel.tsx`.
- **`calculateEfficiencyRatio(candles, currentIndex, lookback)`** — same file. Kaufman ER: `|close_now - close_N_bars_ago| / Σ|close_i - close_i-1|`, bounded `[0,1]`. Unlike the other two metrics this returns a single scalar directly (no raw-array counterpart — there's no meaningful "per-bar ER"). Returns `undefined` for a flat/zero-path window (would otherwise divide by zero) or when there's no prior bar at all. Complements bar overlap (adjacent-bar spatial overlap) and bar range (bull/bear bar size) by catching windows that don't overlap much locally but still cancel out net progress. Stamped as `Trade.efficiencyRatioAtEntry`; lookback is `AutoBacktestConfig.efficiencyRatioLookback` (default `10`, Kaufman's original period), editable via the "Efficiency" input in `AutoBacktestPanel.tsx`.
- **`calculateBarBreaks(candles, currentIndex, lookback)`** — same file. Counts, over the window, how many bars broke the immediately preceding bar's high (`high_i > high_{i-1}`) vs. how many broke its low (`low_i < low_{i-1}`) — independent counts, so an **outside bar counts toward both** (do not "fix" this into an either/or classification). Also returns `barsCompared`, the actual number of bar-to-bar comparisons made (`<= lookback`, shorter early in a session) — kept specifically so the counts can be normalized later without guessing the denominator, since (unlike `barOverlapAtEntry`) only aggregate counts are stored, not a raw per-bar array. Stamped as `Trade.highBreakCountAtEntry`/`lowBreakCountAtEntry`/`barBreakWindowAtEntry`; lookback is `AutoBacktestConfig.barBreakLookback` (default `20`), editable via the "Breaks" input in `AutoBacktestPanel.tsx`.
- **`calculateEMASlope(candles, currentIndex, period, slopeLookback)`** — same file. `(ema[now] - ema[now - slopeLookback]) / slopeLookback`, i.e. points-per-bar rate of change of an EMA of the given `period`. This is the **same formula** as the inline (non-exported) `getSlope` helper already used inside `analyzeMarketStructure` for regime detection (`ltSlope`/`htSlope`) — deliberately **not** refactored to share code, since `analyzeMarketStructure` is load-bearing across live/backtest/batch regime classification and this is a separate, unrelated instrumentation feature (same reasoning as why `calculateBarOverlap` didn't refactor the pre-existing 10-bar overlap check). Unlike `getSlope`'s `0` default, this returns `undefined` when there isn't enough history — `0` would misleadingly look like "flat" rather than "unknown." Stamped as `Trade.ema21SlopeAtEntry`/`ema50SlopeAtEntry`; lookbacks are `AutoBacktestConfig.ema21SlopeLookback`/`ema50SlopeLookback` (defaults `10`/`20`, matching the validated `ltSlope`/`htSlope` lookbacks already in production), editable via the "EMA21"/"EMA50" inputs in `AutoBacktestPanel.tsx`. Note: `executeTrade` already computes a separate EMA21 series for `atrDepthAtEntry` — this recomputes EMA21 independently rather than sharing that series, a known minor inefficiency accepted for consistency with the other four metrics' self-contained signatures.
- **`calculateEMAInteraction(candles, currentIndex, period, lookback)`** — same file, `period` defaults to `20` (Brooks' standard MA, distinct from the EMA21/EMA60 used elsewhere and never swapped for it). Reuses the exact touch/buffer tolerance (`0.0001` of the EMA value) already used by the private `calculateMAPosition()` helper's on-MA/gap check in this same file — **not** refactored, only the formula is borrowed. Returns `gapBarRatio` (fraction of bars whose full range never touches the EMA — a Brooks "gap bar," strong-trend signal) and `closeAboveRatio` (fraction of closes above the EMA — "always-in" bias; below = `1 - closeAboveRatio`), both `undefined` if no bar in the window has a defined EMA yet, plus `barsCompared` (the real window size, for the same denominator-preservation reason as `barBreakWindowAtEntry`). Stamped as `Trade.ema20GapBarRatioAtEntry`/`ema20CloseAboveRatioAtEntry`/`ema20InteractionWindowAtEntry`; lookback is `AutoBacktestConfig.emaInteractionLookback` (default `20`, one shared window for both ratios), editable via the "EMA20 Int" input in `AutoBacktestPanel.tsx`.

**Check when changing:** if `Trade` schema is consumed by a strict validator/export in the future, remember `barOverlapAtEntry`/`barRangeAvgAtEntry`/`efficiencyRatioAtEntry`/`highBreakCountAtEntry`/`ema21SlopeAtEntry`/`ema20GapBarRatioAtEntry`/etc. are `undefined` on exit/reducing trades, may reflect a shorter-than-configured window for early-session entries, and the bull/bear range averages (ER on a flat window, EMA slope with insufficient history, and both EMA20 interaction ratios before the EMA is defined) are `undefined` (not `0`) rather than a misleading zero. `highBreakCountAtEntry`/`lowBreakCountAtEntry` should always be read alongside `barBreakWindowAtEntry`, and the EMA20 interaction ratios alongside `ema20InteractionWindowAtEntry`, as the denominator — never assume the configured lookback was the actual window size.

**All 7 instrumentation metrics can now gate entries, not just efficiency ratio.** `RegimeRules` carries a `xxxFilter`/`xxxThreshold` pair per metric category (`atrDepthFilter`, `efficiencyRatioFilter`, `barOverlapFilter`, `barRangeFilter` (adds a 4th mode, `'dominance'`), `barBreakFilter`, `ema21SlopeFilter`, `ema50SlopeFilter`, `ema20GapBarFilter`, `ema20BiasFilter`) — same `'none'`/`min`/`max` idiom throughout, each backed by a `passesXxx()` helper in `autoBacktestEngine.ts` called from both `evalLong`/`evalShort` right after `passesAtrDepth`/`passesEfficiencyRatio`. **Directional metrics auto-align to trade direction**: Break Count uses `highBreakCount` for longs / `lowBreakCount` for shorts; EMA21/EMA50 Slope flip sign for shorts via the local `aligned()` helper (so `'min'` always means "trending in the trade's favor," not "trending up"); EMA20 Bias uses `closeAboveRatio` for longs / `1 - closeAboveRatio` for shorts. Bar Overlap and EMA20 Gap-Bar are symmetric — no alignment. `barRangeFilter: 'dominance'` compares the trade-direction-aligned average bar range (bull for longs, bear for shorts) against the opposite side, requiring it exceed by `barRangeDominanceThreshold`× — the other 3 metrics that support `'dominance'`-style reasoning don't need it since alignment already encodes direction.

To avoid computing any metric twice per signal, `evaluateAutoSignals` computes **all 7 categories once per bar** into an `EntryMetricsSnapshot` object (not just ER as before) and returns it on `AutoSignal.entryMetrics` (this **replaced** the old single-field `AutoSignal.efficiencyRatioAtEntry`). Both `batchBacktestSimulator.ts` (`enterPosition`) and `sharedActions.ts` (`executeTrade`, via the `entryMetricsOverride` param — now typed `EntryMetricsSnapshot`, not the old `{ efficiencyRatioAtEntry?: number }`) prefer the snapshot's per-field values over recomputing, falling back to a fresh calculation per-field only for manual (non-auto-engine) trades or fields the override doesn't carry. This matters because `calculateEMASlope`/`calculateEMAInteraction` rerun `calculateEMA` over the *entire* visible candle history each call — recomputing them a second time per trade entry is real, avoidable cost in batch mode.

**Check when changing `AutoSignal` or `executeTrade`'s `entryMetricsOverride` param:** any code still reading `signal.efficiencyRatioAtEntry` directly (pre-this-change pattern) will break — it's `signal.entryMetrics.efficiencyRatio` now. `sessionStore.ts`'s `executeTrade` type signature and `autoBacktestActions.ts`'s call site were both updated; check both if adding a new call site.

### `AutoBacktestConfig` / `RegimeRules` shape (`autoBacktestEngine.ts`)

Global config (`AutoBacktestConfig`): `enabled`, `skipIfPositionOpen`, `tradeStartTime`/`tradeEndTime`, `useAutoQty` (default **`true`**)/`riskPerTrade`/`minQuantity` (risk-based position sizing — already fully wired in both `batchBacktestSimulator.ts` and `autoBacktestActions.ts`'s `runAutoBacktestCheck`, identical formula: `qty = floor(riskPerTrade / |entry - sl|)`, skip if `< minQuantity`), `autoSquareOff`/`squareOffTime`, `slTpFillMode` (see `checkSLTPHits` entry above), and the 7 instrumentation lookback fields (see above). Per-regime (`RegimeRules`, one each for `uptrend`/`downtrend`/`range`/`reversal`): `enabled`, `direction`, `entryMode` (`PIVOT`/`H_SIGNAL`/`CONFLUENCE`), `allowH1/H2/L1/L2`, `confluenceLookback`, `ltPivotSequence`, `maFilter`, `atrDepthFilter?`/`atrDepthThreshold?`, `efficiencyRatioFilter?`/`efficiencyRatioThreshold?`, the 7 new quality-setup filter/threshold pairs listed above, `htStructureFilter`, `ltStructureFilter?`, `slMethod`/`slAtrMultiplier`/`slFixedPoints`, `targetRR`. `AUTO_BT_PRESETS`' `applyPreset` (`AutoBacktestPanel.tsx`) explicitly re-applies the *current* session's `useAutoQty`/`riskPerTrade`/`minQuantity` after spreading a preset — so the `useAutoQty` default only affects brand-new sessions, never an existing session's or preset's choice.

**Quality-setup filter defaults live in 3 places that can drift out of sync:** `defaultLongRules`/`defaultShortRules` (set `barOverlapFilter: 'max'` @0.4, `barRangeFilter: 'dominance'` @1.0, `ema21SlopeFilter`/`ema50SlopeFilter: 'min'` @0 — scale-invariant so safe as defaults across instruments/timeframes; `barBreakFilter`/`ema20GapBarFilter`/`ema20BiasFilter` stay `'none'`), `defaultRangeRules` (explicitly resets all 4 to `'none'` despite spreading `...defaultLongRules` — Range/Reversal regimes are chop-tolerant by design and must not inherit the trend-quality gates), and `AUTO_BT_PRESETS['Trend Follow'].uptrend/downtrend` (these are hand-written object literals, **not** spread from `defaultLongRules`/`defaultShortRules`, so the new filter defaults had to be duplicated there explicitly — `Range Trader`/`All Regimes` presets don't have this problem since their `uptrend`/`downtrend`/`range` entries do spread the `default*Rules` objects). **If you change a default threshold, check all 3 places, especially the `Trend Follow` preset literal — it's easy to update `defaultLongRules` and forget the preset silently didn't inherit it.**

**Important — `htMarket` is not independent higher-timeframe confirmation.** `analyzeMarketStructure()` in `pivotAnalysis.ts` derives `htMarket` from a longer-lookback EMA(60) slope computed on the *same* base-timeframe `candles` array as `ltMarket` — there is no real HTF resampling. In sustained trends it structurally tends to mirror `ltMarket`. Don't assume `RegimeRules.htStructureFilter` is providing genuine independent confirmation without checking `analyzeMarketStructure`'s actual computation first.

**`htMarket` gained a real Reversal branch (LT Structure filter addition).** `analyzeMarketStructure()`'s HT block now mirrors the LT block's pattern exactly — `Bull-Reversal`/`Bear-Reversal` when the weaker-slope + `hasHL`/`hasLH`-without-`hasHH`/`hasLL` pivot-label condition is met (previously HT could only ever read `Bull-Trend`/`Bear-Trend`/`Range`, no Reversal case existed). This changes what every HT badge display (`ChartToolbar.tsx`, `AutoBacktestPanel.tsx`, `EntryMetricsDashboard.tsx`, `PerformanceDashboard.tsx`, `TradeHistoryDialog.tsx`, `TradeReportDialog.tsx`) can show, not just the filter — they all read the same `htMarket` string. **`RegimeRules` also gained `ltStructureFilter?`** (optional, defaults `'any'`, mirrors `htStructureFilter` but gates on `ltMarket` instead) — both are now widened to 5 options (`any`/`bull_trend`/`bear_trend`/`range`/`reversal`) and checked via the shared `passesStructureFilter(filter, market)` (replaced the old HT-only `passesHtFilter`). `bull_trend`/`bear_trend` in this filter match the **clean** trend state only — `Bull-Trending-range`/`Bear-Trending-range` bucket under `range` here, unlike `getRegimeKey`'s uptrend/downtrend bucketing (deliberately different, filter-specific semantics — do not unify the two).

### Visual filter-configuration layer (`components/autobacktest-visuals/`, `hooks/useFilterPreviewData.ts`)

`AutoBacktestPanel.tsx`'s Quality Setup Filters and the top-row filters (MA Filter, Pivot Seq, HT Structure, ATR Depth, Efficiency Ratio, Pivot Sequence History, Pivot Gap) were rebuilt from raw `<select>` + `<input type="number">` pairs into visual controls, so a filter's threshold reads as a chart shape rather than an abstract number. This is a **UI-layer-only change** — `RegimeRules`, `AutoBacktestConfig`, and every `calculate*`/`passes*` formula are untouched.

- **`autoBacktestEngine.ts` exports added:** all 12 `passesXxx()` gate functions (`passesEfficiencyRatio`, `passesBarOverlap`, `passesBarRange`, `passesBarBreak`, `passesSeqFilter`, `passesPivotGap`, `passesEmaSlope`, `passesEma20GapBar`, `passesEma20Bias`, `passesAtrDepth`, `passesStructureFilter` — was `passesHtFilter`, renamed and widened to gate both `htStructureFilter`/`ltMarket` and `ltStructureFilter`/`ltMarket` with the same 5-option bucketing, see the LT Structure filter paragraph above — `passesMa`) were module-private before this change — now exported so the preview hook can reuse them instead of duplicating gate logic. Also newly exported: `getEmaAt`, `getAtrAt` (needed for the ATR Depth preview, since ATR-unit distance isn't part of `EntryMetricsSnapshot`).
- **`computeEntryMetrics(candles, currentIndex, config)`** — new exported function, extracted from the metrics-assembly block that used to be inlined in `evaluateAutoSignals` (still called there, behavior unchanged). Shared by `evaluateAutoSignals`'s real gating and `useFilterPreviewData`'s preview so both derive every metric identically. **Known minor redundancy:** it recomputes `calculatePivotPoints` internally rather than reusing the `pivots` array `evaluateAutoSignals` already has in scope — accepted so the function stays self-contained and callable from the hook, which has no other pivots array to share; same "don't refactor across unrelated call sites" reasoning already established for `calculateBarOverlap`/`calculateEMASlope` above. **Signature since gained a 4th `trendAnchorIndex` param — see the "Pullback trend-anchor fix" subsection below, this paragraph's `(candles, currentIndex, config)` call shape is stale.**
- **`hooks/useFilterPreviewData.ts`** — given `candles`, `currentIndex`, active `RegimeRules`, and `AutoBacktestConfig`, recomputes pass/fail for the last 30 bars (bars before index 50 are excluded — mirrors `evaluateAutoSignals`'s own warm-up guard) across every wired filter, via `computeEntryMetrics` + the exported `passesXxx` functions. Direction ambiguity for `BOTH`-direction regimes previews as long-aligned (`SHORT_ONLY` previews as short-aligned) — display simplification only, `evaluateAutoSignals` still checks both directions for real signal evaluation. Returns `FilterPreviewBar[]`, each carrying the full `EntryMetricsSnapshot` plus `atrDepth` (not part of the snapshot) so controls can show a "your data: X" live-value reference.
- **`components/autobacktest-visuals/`** — new directory, ~15 components: `FilterPreviewStrip` (a *new*, minimal `lightweight-charts` instance — deliberately not a reuse of `AdvancedChart.tsx`, which reads `candles`/indicators directly from `useSessionStore` rather than accepting props, and carries the full toolbar/drawing-tools stack that a small preview strip doesn't need); `ThresholdFilterControl` (generic slider + segmented-mode-buttons wrapper, used by every single-threshold filter); `ModePickerControl` (sibling for categorical/no-threshold filters — MA Filter, Pivot Seq, HT Structure); `BarRangeFilterControl` and `PivotSequencePatternPicker` (bespoke, not built on the generic wrappers, because Bar Range needs two different threshold units depending on mode and Pivot Sequence needs a multi-select pattern grid rather than a single value); and one illustrative SVG diagram component per filter shape (`BarOverlapDiagram`, `BarRangeDominanceDiagram`, `BreakCountDiagram`, `EmaSlopeDiagram`, `EmaInteractionDiagram`, `EfficiencyRatioDiagram`, `AtrDepthDiagram`, `MaPositionDiagram`, `PivotSeqDiagram`, `PivotSequenceStaircase`, `PivotGapDiagram`) — all pure, procedurally-drawn from the current threshold value, no external chart library.
- **`RegimeEditor` (in `AutoBacktestPanel.tsx`) signature changed again by the Strategy Builder redesign below** — the `candles`/`currentIndex`/`config` props described in the paragraph above no longer exist on it. See the redesign subsection for the current signature; don't trust this paragraph for `RegimeEditor`'s prop shape, only for the `useFilterPreviewData`/`passesXxx`/diagram-component reasoning, which is still accurate.
- **Check when adding a new filter to the visual layer:** (1) if it's a single numeric threshold, use `ThresholdFilterControl` + a new diagram component; if categorical, use `ModePickerControl`; if it doesn't fit either shape (dual-unit, multi-select), it likely needs its own bespoke control like `BarRangeFilterControl`/`PivotSequencePatternPicker` — don't force-fit the generic wrappers. (2) Add the filter's `passesXxx` call to `useFilterPreviewData.ts`'s `pass` object and a matching `PreviewFilterKey` union member if you want it to participate in the live preview strip and hover-isolate — this is optional (MA Filter/Pivot Seq/HT Structure were deliberately left out of the preview since they're categorical pickers, not thresholds, and don't carry the same "which number do I pick" ambiguity that motivated the preview strip). (3) Decide which workflow step it belongs in (Market/Entry/Confirmation/Exit/Risk, see the redesign subsection below) and add its JSX to the matching step component in `RegimeWorkflowSteps.tsx`.

### Pullback trend-anchor fix (`indicators.ts`, `autoBacktestEngine.ts`, `useFilterPreviewData.ts`) — **superseded by the "Frozen impulse-leg grading" section below**

**This section is historical.** The `trendAnchorIndex` param it describes no longer exists (`computeEntryMetrics` now takes a `legWindow` object), the anchor-derivation expressions quoted below were replaced, and `anchorIndex` semantics changed (it now points at the *original* frozen leg extreme, not the most recent minor push). Read it only for the original motivation; the current mechanics are in the frozen-leg section.

`computeEntryMetrics` used to compute Bar Overlap, Efficiency Ratio, Break Count, and EMA21/EMA50 Slope over a fixed trailing window always ending at the entry bar (`currentIndex`). For Al Brooks pullback-continuation entries (H2/H3/L2/L3..., `entryMode: 'H_SIGNAL'`/`'CONFLUENCE'`), the entry bar sits right after a multi-bar consolidation — so that window mostly measured the pullback's own choppiness, not the impulse leg the filters are meant to grade. Fixed by anchoring those 4 filters' windows at the pullback's actual swing extreme instead. **Presentation/UI unaffected — no `RegimeRules`/`AutoBacktestConfig` schema changes.**

- **`calculateAlBrooks` (`indicators.ts`)** — `AlBrooksMarker` gained `anchorIndex: number`. New trackers `latestHighBarIndex`/`latestLowBarIndex` (updated every bar alongside `latestHigh`/`latestLow`, before the `Math.max`/`Math.min` calls) and `hSwingHighBarIndex`/`lSwingLowBarIndex` (captured at arm time alongside `hSwingHigh`/`lSwingLow`) record which bar actually set the swing extreme, since the true peak/trough can sit a bar or two before the arm bar itself (inside bars). Every fired marker now carries `anchorIndex: hSwingHighBarIndex`/`lSwingLowBarIndex` — the bar index of the swing extreme, always strictly `< ` the fire bar. `AlBrooksMarker` isn't type-referenced outside this file, so widening it required no other signature changes (marker objects reach `evalLong`/`evalShort` via a `.find()` result, not an object literal, so no excess-property-check issue).
- **`computeEntryMetrics` (`autoBacktestEngine.ts`)** — gained a 4th param `trendAnchorIndex: number = currentIndex`. Only 4 of its internal calls use it as the window's end index: `calculateBarOverlap`, `calculateBarBreaks`, `calculateEfficiencyRatio`, both `calculateEMASlope` calls (EMA21/EMA50). `calculatePivotPoints`/`getPivotSequenceStats` (pivot-event-based, not bar-count, already immune), `calculateBarRanges` (Bar Range), and `calculateEMAInteraction` (EMA20 Gap-Bar/Bias) deliberately still use `currentIndex` — those describe the pullback/entry bar itself, not the leg, per an explicit user scope decision. Default parameter means every existing caller that doesn't pass a 4th arg is unaffected (identical to old behavior).
- **`evaluateAutoSignals` (`autoBacktestEngine.ts`)** — computes `trendAnchorIndex = (regimeRules.entryMode !== 'PIVOT' && currentAbMarker) ? currentAbMarker.anchorIndex : currentIndex` right after `currentAbMarker`/`regimeRules` are resolved, and passes it into `computeEntryMetrics`. `entryMetrics` is still computed once and shared between `evalLong`/`evalShort` — safe, since a bar can only ever carry one fired Al Brooks marker (H-family xor L-family; outside bars pick a side via close direction), so whichever direction actually evaluates finds its own correctly-anchored metrics. `PIVOT`-mode entries and any bar with no fired marker are unaffected (`trendAnchorIndex` collapses to `currentIndex`).
- **`useFilterPreviewData.ts`** — mirrors the same logic so the Live Preview Strip never disagrees with real engine behavior: computes `calculateAlBrooks(candles.slice(0, end + 1))` once per render (not per bar), then per previewed bar looks up its marker by timestamp and applies the identical `(rules.entryMode !== 'PIVOT' && marker) ? marker.anchorIndex : i` logic before calling `computeEntryMetrics`.
- **No changes needed** in `batchBacktestSimulator.ts` or `frontend/scripts/backtestEval.ts` — both call `evaluateAutoSignals` per bar with no separate metrics loop, so the fix propagates automatically. The manual-trade path in `stores/sharedActions.ts` (`executeTrade`) independently recomputes `entryMetrics` for manually-placed trades using plain `currentIndex` — intentionally untouched, manual clicks have no Al Brooks pullback-anchor concept.
- **Known, explicitly out-of-scope gap:** `calculateAlBrooks` still has no guard against an overly-deep pullback — the only thing that invalidates a pullback count is price exceeding the original swing extreme (`hSwingHigh`/`lSwingLow`); a pullback that retraces 90-100%+ of the leg without fully exceeding that extreme still fires as a valid continuation today. Discussed with the user and deliberately deferred (would require picking a retracement threshold and touching `calculateAlBrooks`'s signal-firing logic itself, not just the metrics windowing this fix addresses).

### Frozen impulse-leg grading + Consecutive Breaks filter (`indicators.ts`, `pivotAnalysis.ts`, `autoBacktestEngine.ts`, `useFilterPreviewData.ts`, `RegimeWorkflowSteps.tsx`) — **leg mechanics superseded by the "Completed-breakout-leg windows" section below**

**Partially historical.** The Consecutive Breaks filter parts still hold, but the leg state machine described here (freeze on pullback start / unfreeze on original-extreme break, leg start = previous pullback's deepest extreme) was replaced, `anchorIndex` was removed from `AlBrooksMarker`, and window lengths are no longer always the config lookbacks. Current mechanics are in the completed-breakout-leg section below.

Supersedes the trend-anchor fix above. Core problem: `calculateAlBrooks` resets `latestHigh` when H1 fires, so **H2's anchor pointed at the minor H1→H2 push**, not the original breakout leg. Fix: freeze the anchor at the original leg extreme when the pullback starts, keep it for H1/H2/H3… until price breaks that extreme, and anchor *all* strength metrics (not just the original 4) at it.

**History note — leg-length windows were tried and reverted in the same session:** the first implementation derived each metric's window *length* from the leg's own bar span (`legSpan`), ignoring the config lookbacks. In real 5-min data legs are frequently 1–3 bars, which made metrics degenerate (ER over one close-to-close transition is always exactly 1.0) and — the user's actual complaint — made the Session Settings Instrumentation Lookbacks completely inert in H/L-signal modes ("no change when I play with configuration"). Current behavior: **window END = frozen leg extreme; window LENGTH = the configured Instrumentation Lookbacks, always.** Don't reintroduce leg-length-derived windows without a floor.

- **`calculateAlBrooks` (`indicators.ts`)** — a **parallel leg state machine** (`hLegStartIndex`/`hLegMaxHigh(+BarIndex)`/`hLegFrozen`/`hLegEndIndex`/`hPullbackLow(+BarIndex)`, mirrored for L) that never feeds back into `hCount`/`hArmed`/`hSwingHigh` — **signal timing is byte-for-byte unchanged**, only marker metadata changed. Freeze fires on the first `lowBreak` while un-frozen (keyed on `hLegFrozen`, NOT `hArmed` — re-arms after H1 must not move the leg); unfreeze on `c.high > hLegMaxHigh` (while frozen the running max stops updating, so it IS the original leg high); the new leg starts at the pullback's deepest extreme. `AlBrooksMarker` gained `legStartIndex`/`legEndIndex`, and `anchorIndex` semantics changed to the frozen original-leg extreme. Subtlest invariant: after a minor-push `hCount` reset, fresh H1s still grade the original frozen leg — deliberate, per the user's rule.
- **`computeEntryMetrics` (`autoBacktestEngine.ts`)** — 4th param is now `legWindow?: LegWindow | null` (the `trendAnchorIndex: number` param is **gone**; TS catches stale callers). With a leg, every strength metric's window (ER/overlap/breaks/bar-ranges/EMA-slopes/EMA20-gap-bar/consecutive-breaks) **ends at `leg.endIndex`** with its own **config lookback** (Session Settings) as the length. EMA20 **bias** (`closeAboveRatio`) deliberately stays at `currentIndex` via a second `calculateEMAInteraction` call, skipped when `end === currentIndex` (gap-bar and bias come from different windows in leg mode). No leg / `PIVOT` mode → old behavior exactly (config lookbacks at `currentIndex`). Snapshot gained `legStartIndex`/`legEndIndex`/`legBarCount`/`maxConsecutiveHighBreaks`/`maxConsecutiveLowBreaks`; Trade records stamp all five as `...AtEntry` (no fallback recompute — `undefined` means entry-bar windows were used).
- **`calculateConsecutiveBreaks` (`pivotAnalysis.ts`)** — longest run of bars each breaking prior high without breaking prior low (mirror for lows); outside/inside bars reset the run. Searched over new config-top-level `consecutiveBreakLookback` (default 10, editable in Session Settings → Instrumentation Lookbacks) ending at the leg extreme / entry bar. Gated by `passesConsecutiveBreak` + new `RegimeRules.consecutiveBreakFilter`/`consecutiveBreakThreshold` (all optional → old Firestore configs load unchanged, filter off; no preset/default-rules changes). Wired into `evalLong`/`evalShort`, `useFilterPreviewData` (`'consecutiveBreak'` key), `ConfirmationStep` UI, `SessionSettingsPanel`, and `countActiveConfirmationFilters` (`StrategySummaryBar.tsx`).
- **Behavioral shift vs. pre-frozen-leg builds:** in H/L-signal modes, Bar Range and EMA20 Gap-Bar moved from entry-bar windows to leg-extreme-anchored windows, and the anchor itself moved from the minor-push extreme to the original leg extreme — trade sets will differ from older runs even with identical configs.
- **Verified:** 18-assertion synthetic leg-machine check (H1/H2 identical frozen legs, new leg from pullback low after breakout, bear mirror via price negation, outside-bar run reset) + 10-assertion lookback-sensitivity check (each Session Settings lookback changes the metric at an H2 bar; leg-anchored ER equals ER computed at the leg-high bar and differs from entry-bar ER; EMA20 bias unchanged by the anchor) + `npm run build` + `npm run backtest:eval` end-to-end.

### Completed-breakout-leg windows (`indicators.ts`, `autoBacktestEngine.ts`, `useFilterPreviewData.ts`, `sharedActions.ts`, `SessionSettingsPanel.tsx`)

Supersedes the frozen-leg mechanics above. The leg is now defined by the H/L signal machinery itself, and the leg-strength metrics window over the leg's **own bars** instead of fixed lookbacks:

- **Leg lifecycle (`runAlBrooks` in `indicators.ts`)** — three phases per side, tracked in parallel with (never feeding back into) `hCount`/`hArmed`: **candidate** (every H fired replaces the candidate start; any `lowBreak` before breakout discards it — "until `hSwingHigh` breaks, the newest H is the leg start"); **active** (the `hCount` reset — `c.high > hSwingHigh`, minor push-high resets included — promotes the candidate; running swing extreme tracked); **completed** (first `lowBreak` after confirmation freezes `{start, end: swing-extreme bar}`). Mirrored for L. In-bar order matters: completion runs BEFORE the fire block (a marker firing on the pullback's first bar already carries the just-completed leg); confirmation sits inside the reset block AFTER the fire block (a bar that fires H and breaks `hSwingHigh` starts the leg at itself). `AlBrooksMarker.legStartIndex/legEndIndex` are now **optional** (undefined until the side's first leg completes); `anchorIndex` was **removed** (no consumers). New export `calculateAlBrooksLegs(candles)` returns per-bar `{bull, bear}` completed-leg arrays for any-bar lookups (manual entries); `calculateAlBrooks` is a thin wrapper over the shared `runAlBrooks` core.
- **`computeEntryMetrics` (`autoBacktestEngine.ts`)** — with a leg window: `windowBars = min(legBarCount, legMaxBarCount ?? 15)`; ER/overlap/bar-breaks get `windowBars - 1` (pair-comparison conventions reach one bar back, so this keeps windows inside the leg; a 1-bar leg yields `undefined` metrics), bar-ranges/EMA20-interaction get `windowBars`, consecutive-breaks gets `[end - windowBars + 1, end]`. EMA21/EMA50 slopes deliberately keep config lookbacks (leg-end anchored). Snapshot gained `legTooShort` (`legBarCount < legMinBarCount ?? 5`). New config fields `legMinBarCount`/`legMaxBarCount` (top-level, optional → old Firestore configs load with 5/15 defaults), editable in Session Settings → Instrumentation Lookbacks.
- **Entry gate (`evaluateAutoSignals` + mirrored in `useFilterPreviewData`)** — for non-`PIVOT` modes, when `legStrengthFiltersActive(rules)` (new exported helper: ER, overlap, bar-range, bar-break, EMA20 gap-bar, consecutive-break filters — NOT slopes/bias) and there's no completed leg or `legTooShort`, the regime is skipped. The preview marks those six pass-keys false via the same helper so the strip never disagrees with the engine.
- **Manual trades (`sharedActions.executeTrade`)** — the inline fallback-metric block was replaced with one `computeEntryMetrics` call using the **direction-matched** per-bar leg (`calculateAlBrooksLegs`: BUY → bull, SELL → bear). Manual entries are never blocked: short legs record over available bars; no leg → entry-bar windows, leg fields undefined. Consecutive-break counts are now also stamped on manual trades (previously auto-only). Reducing/flip trades still stamp no entry metrics.
- **Behavioral shift:** in H/L modes the graded window changed both ends (leg start = last-H bar, not the pullback's deepest extreme; length = leg bars capped at Leg Max, not the config lookbacks) and short/absent legs now block filtered auto entries outright — trade sets differ from frozen-leg builds even with identical configs. The old "don't derive window length from the leg" warning is resolved by the Leg Min Bars floor (block) + Leg Max Bars cap.
- **Verified:** `npx tsc --noEmit` + synthetic-candle check (H1 before any completed leg carries no leg bounds and gates; post-breakout pullback signal carries `{start: last-H bar, end: swing-high bar}`; per-bar lookup holds the leg constant through the pullback; windowed ER=1 / breaks=3 / `barBreakWindow=windowBars-1` inside a clean 4-bar leg; PIVOT/no-leg path byte-identical to before).

### Headless eval sweep flags (`frontend/scripts/backtestEval.ts`)

`npm run backtest:eval` gained three flags (July 2026, prompted by a user investigation into "changing filter settings shows no change" — root cause: all confirmation filters were set to `'none'`, and `'none'` gates are inert by design, see the gate short-circuits in `autoBacktestEngine.ts`):
- `--config <path>` — use an exported auto-BT config JSON (the UI Export button's `{name, exportedAt, config}` wrapper or a raw `AutoBacktestConfig`) as the base config; `enabled` is forced on. Without a sweep flag it runs just that config (the hand-written variant list is only used in the no-flags mode, since spreading presets over a user config would replace whole regimes).
- `--sweep-filters` — one run per confirmation filter in `FILTER_DEFS`, toggled per enabled regime (off→enabled at the regime's saved threshold `??` UI default; active→off), with `Δtrades/Δpnl/ΔPF` vs the baseline row. This is the empirical "which filters actually bind on my data" report.
- `--sweep-thresholds <filterModeKey>` — grid-sweep one filter's threshold (grids in `FILTER_DEFS`).
**Keep `FILTER_DEFS` in sync** with UI defaults in `RegimeWorkflowSteps.tsx` and the `passesXxx` gate fallbacks when adding a filter or changing a default.

### Strategy Builder workflow redesign (`AutoBacktestPanel.tsx`, `components/autobacktest-visuals/`)

`AutoBacktestPanel.tsx` was restructured from a flat, fully-stacked layout into a step-based "Market → Entry → Confirmation → Exit → Risk" workflow per regime, with a sticky live-preview/summary header and a sticky Run Backtest footer. **This is a presentation-only change** — `RegimeRules`, `AutoBacktestConfig`, `autoBacktestEngine.ts`, `batchBacktestSimulator.ts`, and every store action signature in `autoBacktestActions.ts`/`autoBacktestConfigService.ts` are byte-for-byte unchanged. The `frontend/scripts/backtestEval.ts` headless CLI (shares `autoBacktestEngine.ts`/`batchBacktestSimulator.ts` with the UI) is unaffected.

- **New UI-only state, not persisted:** `activeStep: WorkflowStep` (`'market'|'entry'|'confirmation'|'exit'|'risk'`, defined in `StepNav.tsx`) and `isSessionSettingsOpen: boolean`, both in `AutoBacktestPanel`. Switching regime tabs resets `activeStep` to `'market'`.
- **State lifted out of `RegimeEditor` into `AutoBacktestPanel`:** the `useFilterPreviewData(...)` call and `hoveredFilterKey` state used to live in `RegimeEditor` (see the now-stale paragraph above); they now live in `AutoBacktestPanel` so the sticky `FilterPreviewStrip` (which moved out of `RegimeEditor` entirely, up into `AutoBacktestPanel`'s always-visible header zone) and the step components can share the same data without an extra prop-drilling layer.
- **`RegimeEditor`'s current signature** (`AutoBacktestPanel.tsx`): `{ regime, rules, onChange, latestBar, onHoverFilterKey, activeStep, config, onOpenSessionSettings }`. It is now a thin switch over `activeStep` that renders one of `MarketStep`/`EntryStep`/`ConfirmationStep`/`ExitStep`/`RiskStep` (`RegimeWorkflowSteps.tsx`), passing all of them the same `RegimeStepProps` shape. It still owns `showGuide` local state (Confirmation-step-only) and still defines the `up = (patch) => onChange({ ...rules, ...patch })` helper, unchanged in behavior.
- **`RegimeWorkflowSteps.tsx`** (new) — exports `MarketStep`, `EntryStep`, `ConfirmationStep`, `ExitStep`, `RiskStep`, plus `RegimeStepProps`/`RegimeMeta` types and the `QUALITY_FILTER_GUIDE` table (moved here from `AutoBacktestPanel.tsx` verbatim). Every filter's JSX, `passesXxx`/gate wiring, and default values are unchanged — only *which step* renders it changed. Notably `targetRR` moved from being grouped with SL-method fields to its own card in `ExitStep`, while SL method/amount stayed in `RiskStep` — a pure JSX relocation, `rules.targetRR` and its `up()` call are untouched.
- **New generic presentational primitives** in `components/autobacktest-visuals/`, none of which touch `RegimeRules`/`AutoBacktestConfig`: `CardShell` (shared card shell — border/shadow/radius — used everywhere a "card" appears in the redesign), `SegmentedControl` (replaces ~6 hand-rolled `flex gap-1` button groups: Direction, Entry Mode, SL Method), `Chip` (small pill, used by `StrategySummaryBar` and the Current Market State badges), `ToggleSwitch` (extracts the 2 hand-built toggle-switch divs — regime Enable, global Enabled). Regime tabs and `ModePickerControl`'s internal grid variant were deliberately **not** migrated onto `SegmentedControl` — both have bespoke needs (status dots/per-regime coloring, grid layout) that don't fit its shape.
- **`StepNav.tsx`** (new) — exports `WorkflowStep` (the canonical step-key union, imported by `AutoBacktestPanel.tsx` and `RegimeWorkflowSteps.tsx`) and `StepDef`/`StepNav`. Re-themes per active regime via `accentBg`/`accentColor` props (passed `REGIME_META[activeRegime].activeBg/.color`). Deliberately has no "completed step" concept — every step always has valid defaults, so there's no real incomplete state to represent.
- **`StrategySummaryBar.tsx`** (new) — pure, read-only derivation from the active regime's `RegimeRules`, zero new store state. Exports `countActiveConfirmationFilters(rules)` (also reused by `AutoBacktestPanel` for the Confirmation step-nav badge) and a local `formatMaFilterLabel` helper that mirrors (does not alter) the MA-filter label-branching logic originally inline in the old `ModePickerControl` call. `onJumpToStep` is literally the `setActiveStep` state setter passed down — clicking a chip navigates the step nav, nothing else.
- **`SessionSettingsPanel.tsx`** (new) — the former always-visible left sidebar (Trading Window, Quantity, Square-off, SL/TP Fill Mode, Instrumentation Lookbacks) moved verbatim into a slide-over drawer (`fixed inset-y-0 right-0`, `z-[120]`, backdrop `z-[115]`), opened via a header button and `isSessionSettingsOpen`. Same fields, same `onChange` calls as before — check `z-[200]` on `PromptDialog`/`ConfirmDialog` before adding anything above `z-[120]` here, they must stay on top.
- **Restyled in place, no prop/behavior changes:** `ThresholdFilterControl.tsx`, `ModePickerControl.tsx`, `BarRangeFilterControl.tsx`, `PivotSequencePatternPicker.tsx` — only their wrapper `className` strings changed (rounded-lg→rounded-xl, added shadow/hover states, `active:scale-95` on buttons). Their prop interfaces, and therefore every existing call site's props, are unchanged.

### Step switcher → accordion conversion (supersedes `StepNav.tsx` above)

The Market/Entry/Confirmation/Exit/Risk step nav described above (tab row, one step mounted at a time) was replaced with a **single-open accordion** — same "exactly one section visible" behavior, different rendering. Presentation-only; no store/`RegimeRules`/`AutoBacktestConfig` changes.

- **`StepNav.tsx` deleted.** Its `WorkflowStep`/`StepDef` type exports moved into `RegimeWorkflowSteps.tsx` (next to `RegimeStepProps`, since that file already owns the 5 step components). `StrategySummaryBar.tsx` and `AutoBacktestPanel.tsx` now import `WorkflowStep`/`StepDef` from `./RegimeWorkflowSteps` instead of `./StepNav`.
- **`components/autobacktest-visuals/AccordionSection.tsx`** (new) — single-section collapsible wrapper: `{ step, isExpanded, onToggle, accentBg, accentColor, children }`. Renders one full-width header button (icon + label + optional badge + chevron, rotates 180° when expanded) styled with the same `accentBg`/`accentColor` regime-theming `StepNav` used, and only renders `children` when `isExpanded`. Not built on `CardShell` — `CardShell`'s title-row/always-rendered-body shape doesn't support a clickable expand/collapse header, so this is its own container using the same visual tokens (`rounded-xl border border-gray-200 bg-white shadow-sm`).
- **`RegimeEditor`'s signature changed again** (`AutoBacktestPanel.tsx`): now `{ regime, rules, onChange, latestBar, onHoverFilterKey, steps, activeStep, onStepChange, accentBg, accentColor, config, onOpenSessionSettings }` — gained `steps`/`accentBg`/`accentColor`/`onStepChange` (previously passed straight to `<StepNav>`, which no longer exists). It now maps `steps` to `AccordionSection`s via a `STEP_COMPONENTS: Record<WorkflowStep, ComponentType<RegimeStepProps>>` lookup instead of a `switch(activeStep)`, mounting only the expanded step's component — same "collapsed steps do zero work" behavior as before, so `ConfirmationStep`'s heavy filter grid is still never mounted for the other four sections.
- **`activeStep` state is unchanged** (still a single `WorkflowStep`, still resets to `'market'` on regime-tab switch) — single-open accordion is the same "one active key" model as the old stepper, only the rendering (expand/collapse vs. tab-swap) changed. `StrategySummaryBar`'s `onJumpToStep={setActiveStep}` needs no change: clicking a chip now expands the corresponding accordion section instead of tab-swapping to it.
- Clicking the header of the already-expanded section is a no-op — `WorkflowStep` was deliberately not widened to include a "none expanded" state, since there's no current analog and the accordion is meant to always have exactly one section open, matching the old stepper.

---

## Saved Auto-Backtest Configurations (`autoBacktestConfigService.ts`, `AutoBacktestPanel.tsx`)

- **New Firestore collection:** `autoBacktestConfigs` — one doc per named, user-saved `AutoBacktestConfig` (`{ name, config, createdAt, updatedAt }`, doc id `autobt_config_<timestamp>`). Fully independent of the `sessions` collection — saving/loading a configuration does **not** touch trades/candles/drawings/session data. `sanitizeData` (now exported from `firebaseSessionService.ts`, was previously private) strips `undefined` fields before every write, same requirement as session/snapshot saves since `RegimeRules` has many optional filter fields.
- **Store fields:** `savedAutoBacktestConfigs: SavedAutoBacktestConfig[]`, `activeAutoBacktestConfigId`/`activeAutoBacktestConfigName` (which saved entry, if any, is currently loaded — determines whether the panel's "Save" button overwrites in place or is disabled).
- **Store actions** (`autoBacktestActions.ts`): `loadSavedAutoBacktestConfigsList`, `saveAutoBacktestConfigAs`, `updateActiveAutoBacktestConfig`, `applySavedAutoBacktestConfig`, `deleteSavedAutoBacktestConfig`. `applySavedAutoBacktestConfig` calls the existing `setAutoBacktestConfig` setter (so the `autoExitSL` sync side-effect still runs) rather than setting `autoBacktestConfig` directly.
- **Do not confuse with `AUTO_BT_PRESETS`/`applyPreset`** (`autoBacktestEngine.ts`/`AutoBacktestPanel.tsx`) — that remains a separate, hardcoded, non-persisted, in-memory-only mechanism (3 fixed presets). The two features are independent UI sections in the panel and neither reads/writes the other's state.
- **`handleExportConfig`** (`AutoBacktestPanel.tsx`, "Export" button next to "Save As...") — reads the live `config` (`autoBacktestConfig` from the store, i.e. whatever is currently being edited, not necessarily the saved/active one) and downloads it as JSON via `Blob`/`URL.createObjectURL`. Purely local — no Firestore read/write, independent of `saveAutoBacktestConfigAs`/`updateActiveAutoBacktestConfig`. Wraps the config with `{ name: activeConfigName ?? 'unsaved-auto-bt-config', exportedAt, config }`.

**Check when changing:** if `AutoBacktestConfig`'s shape changes, old saved Firestore docs still have the old shape — `applySavedAutoBacktestConfig` passes the stored `config` straight to `setAutoBacktestConfig` with no migration/default-backfill, so a saved config from before a new field existed will be missing that field (same class of gap as `AUTO_BT_PRESETS` partial objects already have via `?? default` fallbacks at read sites — saved configs have no such fallback layer).

---

## Auto-Backtest Price-Action Exit Engine (`autoBacktestEngine.ts`, `batchBacktestSimulator.ts`, `autoBacktestActions.ts`, `backtestActions.ts`, `sharedActions.ts`, `sessionStore.ts`, `types/index.ts`, `RegimeWorkflowSteps.tsx`)

Al Brooks-style dynamic exit management for **auto-entered backtest positions only**. Four independently-toggled mechanisms, all defaulting to `undefined`/off (zero-regression for existing saved configs — verified: `npm run backtest:eval` output byte-identical before/after with all toggles off, on every cached symbol). Manual trades are never touched.

- **Single source of truth:** two new pure functions in `autoBacktestEngine.ts` — `evaluateTrailStop(candles, currentIndex, position, config)` and `evaluateAutoExitSignal(candles, currentIndex, position, config)` — called identically by both per-bar loops so interactive and batch results stay in lockstep. Any new exit rule must be added to these two functions only; do not duplicate logic in the loops themselves.
- **Canonical per-bar order** (both loops): trail stop → SL/TP touch check → signal exits (REVERSAL → OPP_SIGNAL → LEG_DECAY, in that fixed precedence) → auto square-off → new entry check.
  - Interactive: `backtestActions.ts`'s `step()` now calls, in order: `checkTrendReversal` → **`runAutoTrailStop`** → `checkSLTPHits` → **`runAutoExitCheck`** → `runAutoSquareOff` → `runAutoBacktestCheck`. `jump`/`setCurrentIndex` deliberately skip the whole auto pipeline (unchanged behavior — they already skipped entry checks).
  - Batch: `batchBacktestSimulator.ts`'s loop calls `evaluateTrailStop` immediately before the existing SL/TP block, and `evaluateAutoExitSignal` immediately after it, before the auto-square-off block.
- **New store actions** (`autoBacktestActions.ts`), both hard-guarded by `isLiveMode` / `!config.enabled` / `!position?.autoEntry` (never runs on manual positions) / `pendingOrderId`:
  - `runAutoTrailStop(index)` — ratchets `position.stopLoss`, sets `slTrailed: true`, resets `slHit`/`slDialogShown` (same "changed level re-arms the trigger" convention as `updatePositionTarget`).
  - `runAutoExitCheck(index)` — persists `evaluateAutoExitSignal`'s per-bar `{ exitWithTrendSeen, exitAgainstBars }` state onto the position **even when no exit fires** (otherwise the reversal confirm-bars counter resets every bar); on exit calls `executeTrade(..., exit.reason)` immediately, no confirmation dialog (same precedent as the existing `autoExitSL` path in `checkSLTPHits`).
- **`RegimeRules` gained ~20 new optional fields** (`exitOnReversal`/`exitReversalConfirmBars`/`exitReversalRequireWithTrend`, `exitOnOppSignal`/`exitOppAllow1`/`exitOppAllow2`, `exitTrailPivot`/`exitTrailPivotBufferPoints`, `exitLegDecay`/`exitLegDecayMinBarsInTrade`/`exitLegDecayMinFails` + five `exitDecayXxxFilter`/`exitDecayXxxThreshold` pairs). All per-regime — the regime that opened a trade keeps managing its exits for the trade's whole life (`position.entryRegime`, stamped via `executeTrade`'s `autoMeta` param), even if live market structure later maps to a different regime. UI: new cards in `RegimeWorkflowSteps.tsx`'s `ExitStep`; live count badge via `countActiveExitMechanisms()` wired into `AutoBacktestPanel.tsx`'s workflow-step badges next to the existing confirmation-filter count.
- **Leg-decay exit reuses existing leg machinery** — `computeEntryMetrics(candles, i, config, leg)` graded against a **post-entry** completed leg (`calculateAlBrooksLegs`, requiring `leg.endIndex > entryBarIndex` so it never re-judges the entry leg the Confirmation filters already approved) and a new `passesMinMax()` helper (same shape as the existing `passesXxx` gates, but keyed by explicit filter/threshold params instead of a `RegimeRules` field name). Respects the existing `legMinBarCount`/`legMaxBarCount` — no new global config fields needed.
- **Pivot trailing stop has a strict no-lookahead rule:** `evaluateTrailStop` computes pivots from `candles.slice(0, currentIndex)` (confirmed through bar `currentIndex - 1` only), so a pivot confirming on the current bar can never move the SL that this same bar's touch check then tests. Ratchet-only — a candidate that doesn't tighten the stop is discarded.
- **`Trade`/`Position` gained new optional fields** (`types/index.ts`): `Trade.slTrailed`; `PositionBase.autoEntry`/`entryRegime`/`entryBarIndex`/`exitWithTrendSeen`/`exitAgainstBars`/`slTrailed`. All optional and Firestore/restore-safe — a restored session with an open auto position but no stamped `entryRegime` (pre-this-change save) falls back to the regime the *current* LT market structure maps to (`resolveExitRules()` in `autoBacktestEngine.ts`).
- **`ExitReason` extracted as a shared type** (`types/index.ts`): `'SL'|'TP'|'MANUAL'|'TIME_OVER'|'REVERSAL'|'OPP_SIGNAL'|'LEG_DECAY'`, reused by `Trade.exitReason`, `tradeAnalysis.ts`'s `GroupedPosition.exitReason`, `executeTrade`'s param, `sessionStore.ts`'s action signatures, `liveExecutionService.ts`'s `LiveOrderInput.exitReason` (auto reasons never actually reach live — gated off by `isLiveMode` in `runAutoTrailStop`/`runAutoExitCheck` — but the type must still align). **Check when adding a new exit reason:** every one of those call sites, plus `EntryMetricsDashboard.tsx`'s `EXIT_ORDER`/`EXIT_LABEL`, and `exitReasonBadge()` in `tradeAnalysis.ts` (shared badge color/label used by `TradeHistoryDialog`/`TradeReportDialog`).
- **Verification:** `frontend/scripts/exitEngineSmoke.ts` (`npm run backtest:exit-smoke`) — synthetic-candle scenario tests per mechanism (ratchet/no-lookahead, confirm-bars counting, opposite-signal toggles, post-entry leg selection, batch-loop binding). `frontend/scripts/backtestEval.ts`'s summary line now also prints an exit-reason breakdown (`| exits: TP=2 SL=1 REVERSAL=3 ...`) per run.

**Check when changing:** all four mechanisms must stay in the two pure functions (never split logic between the interactive/batch call sites); any new `RegimeRules` exit field must default to `undefined`/off; `executeTrade`'s `autoMeta` gate is what keeps manual positions untouched — don't let a manual entry path accidentally pass it.

---

## API Routes (backend)

| Route | Effect |
|-------|--------|
| `GET /api/candles` | Fetch + cache candles; triggers frontend reload |
| `POST /api/live/order` | Place real Dhan order |
| `POST /api/live/smart-exit` | Start order chaser loop |
| `POST /api/live/monitor` | Register position; `pendingFill: true` blocks exits until fill confirmed |
| `PATCH /api/live/monitor/:id` | Update `target`, `quantity`, or `pendingFill: false` (confirm fill → enables exits) |
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
