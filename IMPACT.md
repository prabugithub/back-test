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
→ on entry (not `isReducing`): stamps `atrDepthAtEntry`, `barOverlapAtEntry`, `barRangeAvgAtEntry`/`bullBarRangeAvgAtEntry`/`bearBarRangeAvgAtEntry`, `efficiencyRatioAtEntry`, `highBreakCountAtEntry`/`lowBreakCountAtEntry`/`barBreakWindowAtEntry`, `ema21SlopeAtEntry`/`ema50SlopeAtEntry`, and `ema20GapBarRatioAtEntry`/`ema20CloseAboveRatioAtEntry`/`ema20InteractionWindowAtEntry` (raw regime instrumentation, read-only for now — see `calculateBarOverlap`/`calculateBarRanges`/`calculateEfficiencyRatio`/`calculateBarBreaks`/`calculateEMASlope`/`calculateEMAInteraction` in `pivotAnalysis.ts`, lookbacks controlled by `autoBacktestConfig.barOverlapLookback`/`barRangeLookback`/`efficiencyRatioLookback`/`barBreakLookback`/`ema21SlopeLookback`/`ema50SlopeLookback`/`emaInteractionLookback`)
→ if new position and live mode and **no** `pendingOrderId`: calls `registerMonitorIfNeeded()` immediately
→ if `pendingOrderId` set and live mode: calls `pollOrderFillStatus()` 2s later; `registerMonitorIfNeeded()` is called inside `onFilled`/`onPartialFill` callbacks (not before fill confirmation)

**Check when changing:** P&L math (FIFO), TradeJournalDialog, TradeExitDialog, SessionStats, live monitor registration, pending-order guard in checkSLTPHits

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
→ if broker position found: updates store and calls `registerMonitorIfNeeded()` (covers page-refresh path where monitor was lost)
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

Global config (`AutoBacktestConfig`): `enabled`, `skipIfPositionOpen`, `tradeStartTime`/`tradeEndTime`, `useAutoQty` (default **`true`**)/`riskPerTrade`/`minQuantity` (risk-based position sizing — already fully wired in both `batchBacktestSimulator.ts` and `autoBacktestActions.ts`'s `runAutoBacktestCheck`, identical formula: `qty = floor(riskPerTrade / |entry - sl|)`, skip if `< minQuantity`), `autoSquareOff`/`squareOffTime`, `slTpFillMode` (see `checkSLTPHits` entry above), and the 7 instrumentation lookback fields (see above). Per-regime (`RegimeRules`, one each for `uptrend`/`downtrend`/`range`/`reversal`): `enabled`, `direction`, `entryMode` (`PIVOT`/`H_SIGNAL`/`CONFLUENCE`), `allowH1/H2/L1/L2`, `confluenceLookback`, `ltPivotSequence`, `maFilter`, `atrDepthFilter?`/`atrDepthThreshold?`, `efficiencyRatioFilter?`/`efficiencyRatioThreshold?`, the 7 new quality-setup filter/threshold pairs listed above, `htStructureFilter`, `slMethod`/`slAtrMultiplier`/`slFixedPoints`, `targetRR`. `AUTO_BT_PRESETS`' `applyPreset` (`AutoBacktestPanel.tsx`) explicitly re-applies the *current* session's `useAutoQty`/`riskPerTrade`/`minQuantity` after spreading a preset — so the `useAutoQty` default only affects brand-new sessions, never an existing session's or preset's choice.

**Quality-setup filter defaults live in 3 places that can drift out of sync:** `defaultLongRules`/`defaultShortRules` (set `barOverlapFilter: 'max'` @0.4, `barRangeFilter: 'dominance'` @1.0, `ema21SlopeFilter`/`ema50SlopeFilter: 'min'` @0 — scale-invariant so safe as defaults across instruments/timeframes; `barBreakFilter`/`ema20GapBarFilter`/`ema20BiasFilter` stay `'none'`), `defaultRangeRules` (explicitly resets all 4 to `'none'` despite spreading `...defaultLongRules` — Range/Reversal regimes are chop-tolerant by design and must not inherit the trend-quality gates), and `AUTO_BT_PRESETS['Trend Follow'].uptrend/downtrend` (these are hand-written object literals, **not** spread from `defaultLongRules`/`defaultShortRules`, so the new filter defaults had to be duplicated there explicitly — `Range Trader`/`All Regimes` presets don't have this problem since their `uptrend`/`downtrend`/`range` entries do spread the `default*Rules` objects). **If you change a default threshold, check all 3 places, especially the `Trend Follow` preset literal — it's easy to update `defaultLongRules` and forget the preset silently didn't inherit it.**

**Important — `htMarket` is not independent higher-timeframe confirmation.** `analyzeMarketStructure()` in `pivotAnalysis.ts` derives `htMarket` from a longer-lookback EMA(60) slope computed on the *same* base-timeframe `candles` array as `ltMarket` — there is no real HTF resampling. It also has no Range/Reversal branches, so in sustained trends it structurally tends to mirror `ltMarket` (confirmed empirically: `ltMarket === htMarket` on every trade in an 8-trade sample). Don't assume `RegimeRules.htStructureFilter` is providing genuine independent confirmation without checking `analyzeMarketStructure`'s actual computation first, especially across Range/Reversal `ltMarket` states, which have no HT equivalent to diverge into.

### Visual filter-configuration layer (`components/autobacktest-visuals/`, `hooks/useFilterPreviewData.ts`)

`AutoBacktestPanel.tsx`'s Quality Setup Filters and the top-row filters (MA Filter, Pivot Seq, HT Structure, ATR Depth, Efficiency Ratio, Pivot Sequence History, Pivot Gap) were rebuilt from raw `<select>` + `<input type="number">` pairs into visual controls, so a filter's threshold reads as a chart shape rather than an abstract number. This is a **UI-layer-only change** — `RegimeRules`, `AutoBacktestConfig`, and every `calculate*`/`passes*` formula are untouched.

- **`autoBacktestEngine.ts` exports added:** all 12 `passesXxx()` gate functions (`passesEfficiencyRatio`, `passesBarOverlap`, `passesBarRange`, `passesBarBreak`, `passesSeqFilter`, `passesPivotGap`, `passesEmaSlope`, `passesEma20GapBar`, `passesEma20Bias`, `passesAtrDepth`, `passesHtFilter`, `passesMa`) were module-private before this change — now exported so the preview hook can reuse them instead of duplicating gate logic. Also newly exported: `getEmaAt`, `getAtrAt` (needed for the ATR Depth preview, since ATR-unit distance isn't part of `EntryMetricsSnapshot`).
- **`computeEntryMetrics(candles, currentIndex, config)`** — new exported function, extracted from the metrics-assembly block that used to be inlined in `evaluateAutoSignals` (still called there, behavior unchanged). Shared by `evaluateAutoSignals`'s real gating and `useFilterPreviewData`'s preview so both derive every metric identically. **Known minor redundancy:** it recomputes `calculatePivotPoints` internally rather than reusing the `pivots` array `evaluateAutoSignals` already has in scope — accepted so the function stays self-contained and callable from the hook, which has no other pivots array to share; same "don't refactor across unrelated call sites" reasoning already established for `calculateBarOverlap`/`calculateEMASlope` above. **Signature since gained a 4th `trendAnchorIndex` param — see the "Pullback trend-anchor fix" subsection below, this paragraph's `(candles, currentIndex, config)` call shape is stale.**
- **`hooks/useFilterPreviewData.ts`** — given `candles`, `currentIndex`, active `RegimeRules`, and `AutoBacktestConfig`, recomputes pass/fail for the last 30 bars (bars before index 50 are excluded — mirrors `evaluateAutoSignals`'s own warm-up guard) across every wired filter, via `computeEntryMetrics` + the exported `passesXxx` functions. Direction ambiguity for `BOTH`-direction regimes previews as long-aligned (`SHORT_ONLY` previews as short-aligned) — display simplification only, `evaluateAutoSignals` still checks both directions for real signal evaluation. Returns `FilterPreviewBar[]`, each carrying the full `EntryMetricsSnapshot` plus `atrDepth` (not part of the snapshot) so controls can show a "your data: X" live-value reference.
- **`components/autobacktest-visuals/`** — new directory, ~15 components: `FilterPreviewStrip` (a *new*, minimal `lightweight-charts` instance — deliberately not a reuse of `AdvancedChart.tsx`, which reads `candles`/indicators directly from `useSessionStore` rather than accepting props, and carries the full toolbar/drawing-tools stack that a small preview strip doesn't need); `ThresholdFilterControl` (generic slider + segmented-mode-buttons wrapper, used by every single-threshold filter); `ModePickerControl` (sibling for categorical/no-threshold filters — MA Filter, Pivot Seq, HT Structure); `BarRangeFilterControl` and `PivotSequencePatternPicker` (bespoke, not built on the generic wrappers, because Bar Range needs two different threshold units depending on mode and Pivot Sequence needs a multi-select pattern grid rather than a single value); and one illustrative SVG diagram component per filter shape (`BarOverlapDiagram`, `BarRangeDominanceDiagram`, `BreakCountDiagram`, `EmaSlopeDiagram`, `EmaInteractionDiagram`, `EfficiencyRatioDiagram`, `AtrDepthDiagram`, `MaPositionDiagram`, `PivotSeqDiagram`, `PivotSequenceStaircase`, `PivotGapDiagram`) — all pure, procedurally-drawn from the current threshold value, no external chart library.
- **`RegimeEditor` (in `AutoBacktestPanel.tsx`) signature changed again by the Strategy Builder redesign below** — the `candles`/`currentIndex`/`config` props described in the paragraph above no longer exist on it. See the redesign subsection for the current signature; don't trust this paragraph for `RegimeEditor`'s prop shape, only for the `useFilterPreviewData`/`passesXxx`/diagram-component reasoning, which is still accurate.
- **Check when adding a new filter to the visual layer:** (1) if it's a single numeric threshold, use `ThresholdFilterControl` + a new diagram component; if categorical, use `ModePickerControl`; if it doesn't fit either shape (dual-unit, multi-select), it likely needs its own bespoke control like `BarRangeFilterControl`/`PivotSequencePatternPicker` — don't force-fit the generic wrappers. (2) Add the filter's `passesXxx` call to `useFilterPreviewData.ts`'s `pass` object and a matching `PreviewFilterKey` union member if you want it to participate in the live preview strip and hover-isolate — this is optional (MA Filter/Pivot Seq/HT Structure were deliberately left out of the preview since they're categorical pickers, not thresholds, and don't carry the same "which number do I pick" ambiguity that motivated the preview strip). (3) Decide which workflow step it belongs in (Market/Entry/Confirmation/Exit/Risk, see the redesign subsection below) and add its JSX to the matching step component in `RegimeWorkflowSteps.tsx`.

### Pullback trend-anchor fix (`indicators.ts`, `autoBacktestEngine.ts`, `useFilterPreviewData.ts`)

`computeEntryMetrics` used to compute Bar Overlap, Efficiency Ratio, Break Count, and EMA21/EMA50 Slope over a fixed trailing window always ending at the entry bar (`currentIndex`). For Al Brooks pullback-continuation entries (H2/H3/L2/L3..., `entryMode: 'H_SIGNAL'`/`'CONFLUENCE'`), the entry bar sits right after a multi-bar consolidation — so that window mostly measured the pullback's own choppiness, not the impulse leg the filters are meant to grade. Fixed by anchoring those 4 filters' windows at the pullback's actual swing extreme instead. **Presentation/UI unaffected — no `RegimeRules`/`AutoBacktestConfig` schema changes.**

- **`calculateAlBrooks` (`indicators.ts`)** — `AlBrooksMarker` gained `anchorIndex: number`. New trackers `latestHighBarIndex`/`latestLowBarIndex` (updated every bar alongside `latestHigh`/`latestLow`, before the `Math.max`/`Math.min` calls) and `hSwingHighBarIndex`/`lSwingLowBarIndex` (captured at arm time alongside `hSwingHigh`/`lSwingLow`) record which bar actually set the swing extreme, since the true peak/trough can sit a bar or two before the arm bar itself (inside bars). Every fired marker now carries `anchorIndex: hSwingHighBarIndex`/`lSwingLowBarIndex` — the bar index of the swing extreme, always strictly `< ` the fire bar. `AlBrooksMarker` isn't type-referenced outside this file, so widening it required no other signature changes (marker objects reach `evalLong`/`evalShort` via a `.find()` result, not an object literal, so no excess-property-check issue).
- **`computeEntryMetrics` (`autoBacktestEngine.ts`)** — gained a 4th param `trendAnchorIndex: number = currentIndex`. Only 4 of its internal calls use it as the window's end index: `calculateBarOverlap`, `calculateBarBreaks`, `calculateEfficiencyRatio`, both `calculateEMASlope` calls (EMA21/EMA50). `calculatePivotPoints`/`getPivotSequenceStats` (pivot-event-based, not bar-count, already immune), `calculateBarRanges` (Bar Range), and `calculateEMAInteraction` (EMA20 Gap-Bar/Bias) deliberately still use `currentIndex` — those describe the pullback/entry bar itself, not the leg, per an explicit user scope decision. Default parameter means every existing caller that doesn't pass a 4th arg is unaffected (identical to old behavior).
- **`evaluateAutoSignals` (`autoBacktestEngine.ts`)** — computes `trendAnchorIndex = (regimeRules.entryMode !== 'PIVOT' && currentAbMarker) ? currentAbMarker.anchorIndex : currentIndex` right after `currentAbMarker`/`regimeRules` are resolved, and passes it into `computeEntryMetrics`. `entryMetrics` is still computed once and shared between `evalLong`/`evalShort` — safe, since a bar can only ever carry one fired Al Brooks marker (H-family xor L-family; outside bars pick a side via close direction), so whichever direction actually evaluates finds its own correctly-anchored metrics. `PIVOT`-mode entries and any bar with no fired marker are unaffected (`trendAnchorIndex` collapses to `currentIndex`).
- **`useFilterPreviewData.ts`** — mirrors the same logic so the Live Preview Strip never disagrees with real engine behavior: computes `calculateAlBrooks(candles.slice(0, end + 1))` once per render (not per bar), then per previewed bar looks up its marker by timestamp and applies the identical `(rules.entryMode !== 'PIVOT' && marker) ? marker.anchorIndex : i` logic before calling `computeEntryMetrics`.
- **No changes needed** in `batchBacktestSimulator.ts` or `frontend/scripts/backtestEval.ts` — both call `evaluateAutoSignals` per bar with no separate metrics loop, so the fix propagates automatically. The manual-trade path in `stores/sharedActions.ts` (`executeTrade`) independently recomputes `entryMetrics` for manually-placed trades using plain `currentIndex` — intentionally untouched, manual clicks have no Al Brooks pullback-anchor concept.
- **Known, explicitly out-of-scope gap:** `calculateAlBrooks` still has no guard against an overly-deep pullback — the only thing that invalidates a pullback count is price exceeding the original swing extreme (`hSwingHigh`/`lSwingLow`); a pullback that retraces 90-100%+ of the leg without fully exceeding that extreme still fires as a valid continuation today. Discussed with the user and deliberately deferred (would require picking a retracement threshold and touching `calculateAlBrooks`'s signal-firing logic itself, not just the metrics windowing this fix addresses).

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
