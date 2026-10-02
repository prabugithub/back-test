# Market Structure Taxonomy — Regime Classification Reference

A reference for classifying 5-min candle legs into structural regimes, for use in the NIFTY futures regime classifier (Brooks Price Action approach).

---

## 1. Directional Trend Structures

These describe legs where price is making sustained progress in one direction. Each has a bull and bear mirror — same geometry, opposite direction.

### 1.1 Strong Trend (Stairs)
- **Bull:** Clean higher-highs and higher-lows, each pullback shallow and short, minimal overlap between legs (like climbing stairs).
- **Bear:** Clean lower-highs and lower-lows, each bounce shallow and short.
- **Identification:** Pullback depth stays under ~30–40% of the prior leg; very few overlapping bars between swings.
- **Trading implication:** Trend-following entries on the pullback/bounce, in the direction of the stair pattern. Highest-conviction regime for with-trend entries.

### 1.2 Trending Range
- **Bull:** Bigger up-legs than down-legs, but pullbacks are choppier/deeper than in a clean stair pattern — some overlap between swings.
- **Bear:** Bigger down-legs than up-legs, choppier bounces.
- **Identification:** Net directional progress over the sequence of legs, but individual legs overlap more than in a strong trend.
- **Trading implication:** Still buy pullbacks / sell bounces in trend direction, but expect more failed breakouts and false starts than in a strong trend — size down slightly vs. 1.1.

### 1.3 Expanding Trend
- **Bull/Bear:** Trending in one direction, but each successive leg's amplitude (range) is larger than the last.
- **Identification:** Leg-to-leg range is increasing while net direction stays consistent.
- **Trading implication:** Strong momentum, but volatility is rising — stops need to widen as swings grow, or risk being stopped out on noise.

### 1.4 Shrinking Trend
- **Bull/Bear:** Trending in one direction, but each successive leg's amplitude is smaller than the last.
- **Identification:** Leg-to-leg range is decreasing while net direction is maintained.
- **Trading implication:** Trend is losing momentum. Tighten trailing stops and watch for a transition into a range or reversal — this pattern often precedes 2.1 (Range) or a wedge (1.5).

### 1.5 Wedge (Exhaustion)
- **Bull (rising wedge):** Rising highs and rising lows, but the two boundary lines are converging (highs rising slower than lows are rising).
- **Bear (falling wedge):** Falling highs and falling lows, converging (lows falling slower than highs are falling).
- **Identification:** Both boundary lines slope the same direction as the trend, but the channel narrows into an apex.
- **Trading implication:** Classic climactic/exhaustion structure. Treat late entries in the wedge's direction with caution — watch for reversal at or near the apex rather than adding to the trend.

---

## 2. Non-Directional (Range) Structures

These are volatility/structure regimes rather than directional ones — no separate bull/bear version needed, since they describe how price is behaving, not which way it's net moving.

### 2.1 Range – Sideways
- **Identification:** Price oscillates between a roughly flat top (resistance) and flat bottom (support), no net progress over the sequence.
- **Trading implication:** Fade the extremes (buy near support, sell near resistance). Avoid breakout entries until range resolves; breakout attempts inside a confirmed range are lower-probability.

### 2.2 Tight Range
- **Identification:** Very small-bodied candles, narrow high-low band, minimal separation between swing highs and lows.
- **Trading implication:** Low-conviction chop. Best avoided, or scalped small. Often a compression phase — flag as a potential pre-breakout setup rather than a tradeable regime on its own.

### 2.3 Expanding Triangle
- **Identification:** Each successive swing is larger than the last (higher highs AND lower lows both expanding outward), unlike a wedge where both boundaries slope the same way.
- **Trading implication:** Volatility expansion / broadening regime. Reduce position size — direction is unresolved and whipsaw risk is high. Wait for the range to break and hold before committing directionally.

### 2.4 Shrinking Pattern (Converging Triangle)
- **Identification:** Each successive swing is smaller than the last (classic symmetrical/converging triangle), boundaries pinching toward an apex.
- **Trading implication:** Volatility contraction. Often precedes a breakout — treat as a "coiling" setup and watch for the eventual expansion move rather than trading the chop inside it.

---

## 3. Regime Summary Table

| Regime | Directional? | Volatility trend | Primary action |
|---|---|---|---|
| Strong trend (stairs) | Yes | Stable | Trade pullbacks with trend |
| Trending range | Yes | Stable/choppy | Trade pullbacks, smaller size |
| Expanding trend | Yes | Rising | Trade with trend, widen stops |
| Shrinking trend | Yes | Falling | Tighten stops, expect transition |
| Wedge | Yes (exhausting) | Converging | Caution on continuation, watch reversal |
| Range – sideways | No | Stable | Fade extremes |
| Tight range | No | Very low | Avoid / scalp / flag as pre-breakout |
| Expanding triangle | No | Rising | Reduce size, wait for resolution |
| Shrinking pattern | No | Falling | Watch for breakout |

---

## 4. Implementation Notes for the Classifier

**Candle count:** 5-min candles give ~75 bars/day (open to close). Expect roughly 8–15 legs/swings per day under Brooks-style leg detection, depending on volatility — use this as a sanity check on the leg-detection algorithm so it isn't over- or under-segmenting.

**Day open gap handling:**
- Treat the day's opening gap as its own discrete event/leg rather than folding it into the first intraday swing — a gap changes the reference point for whether the next move counts as continuation or reversal of the prior day's structure.
- Decide explicitly whether a gap-fill (or failure to fill) resets the leg-counting state. A large unfilled gap can otherwise look like a "shrinking" or "expanding" pattern in the first few candles that is really just gap noise, not organic price action.
- Consider tagging each session with gap size (e.g., in ATR terms) as a feature, since regime probabilities likely differ meaningfully between gap and no-gap days.

**Classification order of operations (suggested):**
1. Detect legs (swing highs/lows) from the 5-min series, with the gap handled as step 0.
2. Measure each leg's size and overlap with the prior leg.
3. Classify the leg sequence into one of the 9 regimes above based on: (a) net direction, (b) overlap/pullback depth, (c) leg-to-leg amplitude trend (expanding/shrinking/stable).
4. Track regime transitions across the day, since regimes commonly evolve (e.g., shrinking trend → range → expanding triangle → breakout into new trend).
