# Claude Instructions — Manual Backtesting System

## Project Overview

A manual backtesting and live trading system for Indian markets (NSE/BSE).
- **Frontend:** React + TypeScript + Zustand + TradingView Lightweight Charts
- **Backend:** Node.js/Express + SQLite (candle cache) + Firebase (session persistence)
- **Live trading:** Dhan API (WebSocket ticks + REST orders)

---

## Single Source of Truth

| Document | Purpose |
|----------|---------|
| `FEATURES_GUIDE.md` | Every user-facing feature, how it works, which component owns it |
| `IMPACT.md` | Component dependency map — what breaks when you change X |

**After every change that adds, removes, or modifies a feature:** update `FEATURES_GUIDE.md`.
**After every structural change (new component, store action, API endpoint):** update `IMPACT.md`.

---

## Standard Workflow Before Any Change

1. **Read `IMPACT.md`** — find the section for the area you're changing, note all affected files
2. **Read the affected files** before proposing or making edits
3. **Do an impact analysis** — call out edge cases, gaps, and unintended side effects
4. **Implement** — minimal changes, no speculative abstractions
5. **Update `FEATURES_GUIDE.md`** if a user-facing feature changed
6. **Commit** with a clear message

---

## Key File Locations

### Frontend (`frontend/src/`)
| File | Responsibility |
|------|---------------|
| `stores/sessionStore.ts` | Central state: position, trades, candles, settings. Most critical file. |
| `components/PlaybackControls.tsx` | Data loading, settings panels, trade entry trigger, auto-advance |
| `components/AdvancedChart.tsx` | Candlestick chart, SL/TP lines, trade markers |
| `components/PositionOverlay.tsx` | Live position display, mid-trade SL/TP edits |
| `components/SessionStats.tsx` | P&L summary bar |
| `components/TradeHistoryDialog.tsx` | Trade log, edit/delete trades |
| `hooks/useChartDrawings.ts` | Drawing tools (trendline, fib, RR tool, etc.) |
| `services/firebaseSessionService.ts` | Save/restore session to Firestore |
| `services/api.ts` | All HTTP calls to backend |

### Backend (`backend/src/`)
| File | Responsibility |
|------|---------------|
| `services/positionMonitor.service.ts` | Live SL/TP monitoring per tick (live trading only) |
| `services/smartExit.service.ts` | Order chaser — guaranteed SL fill |
| `routes/candles.ts` | Candle data fetch + SQLite cache |
| `routes/live.ts` | Live trading endpoints (Dhan) |

---

## Safety Rules

### High-Risk Areas (always do impact analysis first)

- **`sessionStore.ts` store actions** — consumed by almost every component
- **`setTargetRR` / `updatePositionTarget` / `updatePositionSL`** — affect live position, auto-exit, backend monitor
- **`executeTrade` / `initiateTrade`** — core trade lifecycle, FIFO P&L calculation
- **`checkSLTPHits`** — called on every candle advance; bugs here cause silent incorrect exits
- **`firebaseSessionService`** — bugs here cause data loss on session restore
- **`positionMonitor.service.ts`** — runs async in production; bugs cause missed exits

### Lower-Risk Areas (usually safe to edit without full impact analysis)
- `AdvancedChart.tsx` — visual rendering only; doesn't write to store
- `SessionStats.tsx` — read-only display
- `TradeHistoryDialog.tsx` — display + delete (isolated)
- CSS / styling changes

### Known Design Decisions (do not change without discussion)
- `manualLevels` in store takes priority over `targetRR` for TP calculation
- `tpHit` / `tpDialogShown` flags must be reset when TP price changes
- Session persistence uses Firestore; SQLite is candle cache only (not session)
- `autoExitTarget` is read at check-time (reactive), not captured at trade entry

---

## Updating Docs

Run `/update-docs` (`.claude/commands/update-docs.md`) at the end of any session where features changed.
