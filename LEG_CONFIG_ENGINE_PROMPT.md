# Prompt: implement a leg-configuration engine

Hand this to a coding agent in any repo that already has, or can produce, a **leg sequence**
— an ordered decomposition of recent price action into impulse legs and the pullbacks
between them. The spec is language- and framework-agnostic. It tells you what leg data you
need, what to derive from it, and how to build a rule engine that answers one question:

> **Does the price action leading into this bar match a shape I have described?**

Nothing here assumes a particular backtester, charting library, or storage layer. Adapt at
the input boundary (§1) and everything above it is portable.

---

## 0. What you are building

Three artefacts:

```
compile(config)  -> Matcher          // once, at startup; not per bar
matcher.test(legs, side)    -> bool  // does this window match?
matcher.explain(legs, side) -> Verdict[]   // which section rejected it, and why
matcher.describe()          -> string      // the spec in words
```

`explain()` is not optional polish. **A spec that matches zero windows is the normal
failure mode**, and per-section verdicts are the only way to see which section did the
killing. Build it in the first pass, not as a follow-up.

### Why a dedicated engine, rather than a generic filter

A generic clause engine over aggregate columns can say `bullLegCount >= 3`. It cannot say:

> *three bull legs, each 3–10 candles, each moving 0.2–0.8%, each with at least two
> consecutive candles of high body-to-range ratio, with at most two small bear legs
> between them*

That **ordered, positional shape** is the signal. A per-window average like `avgBRR` is
precisely the thing that averages it away. If your requirements never go beyond counts and
means, you do not need this engine — use your existing filter. The moment you need
*sequence*, you need this.

---

## 1. Input contract — the adapter boundary

### 1.1 Ordering: normalise to newest-first

**Index 0 is the segment closest to the current bar**, walking backwards in time. If your
source produces oldest-first, reverse it at the adapter. Do not make ordering a runtime
flag — every loop, every slot index, and the entire notion of "the most recent leg"
depends on it. One convention, enforced at one place.

### 1.2 Required fields per leg

| Field | Type | Meaning |
|---|---|---|
| `kind` | `'impulse' \| 'pullback'` | An impulse runs start → swing extreme; a pullback is the retrace between two impulses. |
| `barCount` | int ≥ 1 | Candles in the segment. |
| `startPrice` | number | Open of the first candle. |
| `endPrice` | number | Close of the last candle. |
| `high` / `low` | number | Extremes across the segment's candles. |

If you have only leg boundaries (`startIndex`, `endIndex`) and raw candles, derive all five
in the adapter. That is the *minimum viable* input — everything in Tier 0 below works from
it alone.

### 1.3 Strongly recommended

| Field | Meaning | Missing ⇒ |
|---|---|---|
| `direction` | `'bull' \| 'bear'` — the *structural* intent of the leg | Fall back to realized direction; `sideBasis: 'struct'` becomes unavailable. |
| `movePct` | signed % move, `(endPrice - startPrice) / startPrice * 100` | Derive it; trivial. |
| `brrAvg` | mean body-to-range ratio over the segment | `avgBrr` conditions and the score's largest term are unavailable. |
| `clvAvg` | mean close-location value, **0..1 form** | `avgDirClv` unavailable. |
| `highBreakCount` / `lowBreakCount` | candles whose high (low) exceeded the prior candle's | `breakCount`, `breakPersist` unavailable. |

### 1.4 Optional: per-candle arrays

| Field | Meaning |
|---|---|
| `brr[]` | body-to-range ratio per candle, oldest → newest **within the segment** |
| `dir[]` | `1` bull, `-1` bear, `0` doji, per candle |

These enable **run conditions** — "N consecutive candles clearing a BRR threshold" — which
are the only bar-level conditions in the engine and often the most selective ones. Without
them, run conditions cannot be evaluated (see §7.2; they must *fail*, not pass).

If your candles have direction as `1|0` (bull / not-bull), map explicitly: a zero-body
candle is a doji and must become `0`, not `-1`.

### 1.5 If you have no bar-quality metrics at all

They are cheap and universal. From OHLC, per candle, with `range = high - low`:

```
range <= 0  ->  brr = clv = uwr = lwr = 0        // zero-range candles are real; guard them
otherwise:
  brr = |close - open| / range        // body-to-range: high = conviction
  clv = (close - low)  / range        // close location, 0..1
  uwr = (high - max(open, close)) / range
  lwr = (min(open, close) - low)  / range
```

Identity: `brr + uwr + lwr === 1`. Assert it in tests — it is the cheapest correctness
check available, and a violation means your OHLC is malformed.

Segment aggregates are plain means. Break counts:

```
highBreakCount = candles i in segment where high[i] > high[i-1]
lowBreakCount  = candles i in segment where low[i]  < low[i-1]
```

### 1.6 Adoption tiers

Pick a tier, implement it fully, then climb. Each is useful alone.

| Tier | Needs | Unlocks |
|---|---|---|
| **0 — geometry** | §1.2 only | `candles`, `movePct`, `rangeRatio`, `depthRatio` conditions; all window aggregates; slot sequencing and gap rules; the full matcher. |
| **1 — quality** | + `brrAvg`, `clvAvg`, break counts | `avgBrr`, `avgDirClv`, `breakPersist`, `breakCount`; composite leg scoring. |
| **2 — bar level** | + per-candle `brr[]`, `dir[]` | Run conditions; `maxRun`. |

**Tier 0 already gives you the sequencing engine**, which is the part you cannot get
anywhere else. Do not block the port on bar-level data.

---

## 2. Derived per-leg features

Computed once per window, before matching. `clamp01(v) = min(1, max(0, v))`.

```
kind        = leg.kind === 'pullback' ? 1 : 0          // 0 = impulse
structDir   = leg.direction === 'bull' ? 1 : leg.direction === 'bear' ? -1 : 0
move        = leg.endPrice - leg.startPrice
realizedDir = move > 0 ? 1 : move < 0 ? -1 : 0
barCount    = leg.barCount || 1
absMovePct  = |leg.movePct|

// Did the leg keep making new extremes, or stall? Measured in the direction
// it actually travelled.
breaks       = realizedDir >= 0 ? leg.highBreakCount : leg.lowBreakCount
breakPersist = clamp01(breaks / barCount)

// Closed with the move. clv is the 0..1 form, so a bear leg mirrors it —
// higher is always better, in both directions.
dirClv = clamp01(realizedDir >= 0 ? leg.clvAvg : 1 - leg.clvAvg)
brr    = clamp01(leg.brrAvg)

// Magnitude against this window's own scale, not an absolute one.
moveVsMedian = medianAbsMove > 0 ? clamp01(absMovePct / (2 * medianAbsMove)) : 0

// Climax proxy: mean candle range inside the leg vs the recent baseline.
// Oversized candles are exhaustion risk, so this is a penalty, never a reward.
rangeRatio    = baselineRange > 0 ? (leg.high - leg.low) / barCount / baselineRange : 0
climaxPenalty = clamp01(rangeRatio - 1)

// Consecutive-conviction runs inside the leg (Tier 2 only).
{ maxRun, run2, run3, run4 } = goodRuns(leg)
runLength = clamp01(maxRun / 4)
```

**`medianAbsMove`** — median of `absMovePct` across **all** segments in the window,
impulses and pullbacks alike. Per window, not global.

**`baselineRange`** — mean candle range (`high - low`) over the last ~20 candles ending at
the current bar. Compute it directly unless your project already exposes exactly that
quantity. Substituting a lookalike (an ATR, a body average, a different window) silently
corrupts `rangeRatio`, `climaxPenalty`, and every climax guard built on them, with no
symptom other than wrong answers.

### 2.1 `goodRuns` — longest run of consecutive same-direction conviction candles

```
goodRuns(brr[], dir[], minBrr = 0.5) -> { maxRun, run2, run3, run4 }

  run = 0; runDir = 0; maxRun = 0; counts = { run2: 0, run3: 0, run4: 0 }

  closeRun():
      if run >= 2: counts.run2++
      if run >= 3: counts.run3++
      if run >= 4: counts.run4++
      if run > maxRun: maxRun = run
      run = 0; runDir = 0

  for each candle i:
      good = dir[i] !== 0 && brr[i] >= minBrr
      if good && dir[i] === runDir:  run++
      elif good:                     closeRun(); run = 1; runDir = dir[i]
      else:                          closeRun()
  closeRun()
```

A doji (`dir === 0`) breaks a run regardless of its BRR.

### 2.2 `depthRatio` — pullback depth against the leg it retraced

Needs the whole window, so it is a second pass. Newest-first ordering means **the retraced
leg sits at the next (older) index**:

```
for i in 0 .. n-2:
    if legs[i].kind == pullback and legs[i+1].kind == impulse and legs[i+1].absMovePct > 0:
        legs[i].depthRatio = legs[i].absMovePct / legs[i+1].absMovePct
```

Impulse legs keep `depthRatio = 0`; conditions on it are meaningful for pullbacks only.

---

## 3. Window aggregates

Whole-window scalars. Use them for coarse gating (§6.1) before the expensive matcher runs,
and as the vocabulary for structure definitions (§8).

```
impulse = segments with kind == impulse

nBull = impulse count with realizedDir > 0
nBear = impulse count with realizedDir < 0
legBalance = nBull - nBear                   // signed one-sidedness

sumBull = Σ absMovePct over impulse legs, realizedDir > 0
sumBear = Σ absMovePct over impulse legs, realizedDir < 0
dominance = (sumBull + sumBear) > 0 ? sumBull / (sumBull + sumBear) : 0.5   // 0.5 = balanced

// Efficiency: net displacement across the window over the total path walked.
// -> 1 clean trend, -> 0 chop.
oldest = legs[n-1]; newest = legs[0]          // newest-first
netMovePct = oldest.startPrice
    ? |(newest.endPrice - oldest.startPrice) / oldest.startPrice| * 100
    : 0
sumAbsMove = Σ absMovePct over ALL segments (impulses AND pullbacks)
efficiency = sumAbsMove > 0 ? clamp01(netMovePct / sumAbsMove) : 0

pullbackDepth = mean of assigned depthRatios (0 when none)

recent = first impulse leg, else legs[0]      // what the current bar is reacting to
moveEfficiency = recent.absMovePct / recent.barCount

avgBrr / avgDirClv = means over ALL segments
maxGoodRun         = max of maxRun over ALL segments
legCount / impulseCount / barsCovered (= Σ barCount)
```

`efficiency` here is a **leg-window** ratio. If your project already exports a bar-window
efficiency ratio (Kaufman ER or similar), keep both under distinct names — they answer
different questions and conflating them will cost you an afternoon.

---

## 4. Composite leg score (Tier 1, optional)

A single tunable strength per leg, so a rule can say "strong leg" without enumerating what
strong means.

```
components: brr, dirClv, breakPersist, moveVsMedian, climaxPenalty, runLength   // each in [0,1]
plus one per-WINDOW constant term (e.g. candle overlap at the current bar)

posTotal = Σ w[k] for w[k] > 0
negTotal = Σ -w[k] for w[k] < 0
span     = posTotal + negTotal, or 1 if zero

raw   = Σ w[k] * component[k]  +  w.constant * windowConstant
score = clamp01((raw + negTotal) / span)
```

**Keep the `span` normalisation.** Every component is already in `[0,1]`, so the raw
weighted sum spans `[-negTotal, +posTotal]`; shifting and dividing maps it onto `[0,1]` so
a stored threshold `T` keeps the same meaning when the weights are retuned. Collapsing this
to a plain weighted sum invalidates every threshold you have saved.

Negative weights are penalties (overlap, climax). A reasonable starting set — **a starting
point to disagree with, not a discovered constant**:

```
brr 0.30 | dirClv 0.25 | breakPersist 0.15 | moveVsMedian 0.15
runLength 0.10 | overlap -0.10 | climax -0.05
```

Derived window metric:

```
goodLegPct = impulse legs with score >= T, over impulse legs; undefined when none
```

Impulse-only is deliberate: pullbacks are retraces, and scoring one as "good" would mean
something different.

---

## 5. The configuration language

Three nested levels. This is the heart of the spec.

```
LegRule    conditions on ONE leg: bounds on its numeric fields, plus bar-level run
           conditions like "BRR >= 0.8 for >= 2 consecutive candles"

Section    an ordered SUBSEQUENCE of legs on one side. Slot 1 is the most recent match,
           slot 2 an older one, and so on. Slots NEED NOT BE ADJACENT; what may sit
           between them is the slot's `before` rule.

LegConfig  a bull section and a bear section, matched over the same window and AND-ed.
           In a bull trend you configure the good bull legs AND the acceptable bear-leg
           behaviour.
```

Because the sequence is newest-first, **slot order is storage order**.

### 5.1 Numeric fields

Define this as **one table in code** that both the compiler and any UI read. A new
condition should be one entry, not two hand-maintained lists that drift apart.

| Field | Reads | Step | Notes |
|---|---|---|---|
| `candles` | `barCount` | 1 (int) | |
| `movePct` | `absMovePct` | 0.05 | percent, not fraction |
| `avgBrr` | `brr` | 0.05 | Tier 1 |
| `avgDirClv` | `dirClv` | 0.05 | Tier 1 |
| `breakPersist` | `breakPersist` | 0.05 | Tier 1 |
| `breakCount` | `highBreakCount` if leg dir ≥ 0 else `lowBreakCount` | 1 (int) | resolved per leg |
| `rangeRatio` | `rangeRatio` | 0.1 | above 1 is oversized — the climax guard |
| `maxRun` | `maxRun` | 1 (int) | at the fixed 0.5 cutoff; use a run condition for a tunable one |
| `depthRatio` | `depthRatio` | 0.05 | pullbacks only |
| `legScore` | §4 score | 0.05 | Tier 1 |

`step` is the UI increment and the rounding grid for suggested defaults (§10).

### 5.2 Bounds

```
boundsTest({ min, max }):
    neither finite  ->  null            // constrains nothing
    both            ->  v => min <= v <= max
    min only        ->  v => v >= min
    max only        ->  v => v <= max
```

Return **`null`, not `always-true`**. It lets the compiler skip the field entirely rather
than paying a no-op call per leg — and this runs per candidate bar over the whole history.

### 5.3 LegRule

```
compileLegRule(rule, ctx) -> (legs, j) => bool

  basis = ctx.sideBasis == 'struct' ? structDir : realizedDir

  kind: 'impulse' -> legs[j].kind == impulse
        'pullback'-> legs[j].kind == pullback
        'any'     -> no test
  side: 'bull' -> legs[j][basis] > 0
        'bear' -> legs[j][basis] < 0
        'any'  -> no test

  for each numeric field with a non-null boundsTest t:
      legScore   -> ctx.scores ? t(ctx.scores[j]) : ALWAYS FALSE
      breakCount -> t(legs[j][basis] >= 0 ? highBreakCount : lowBreakCount)
      otherwise  -> t(legs[j][mappedField])

  for each run condition { minBrr = 0.5, minRun, side = 'same' }:   // skip if minRun unset
      best = maxRunIn(legs[j], minBrr, resolveRunSide(side, legDir))
      best < 0 -> ctx.stats.unknown++ ; FALSE          // unknown, see §7.2
      best >= minRun

  no tests at all -> always true
```

**`sideBasis`** picks whether `side` and direction-dependent fields read *structural* intent
or *realized* displacement. These legitimately disagree — on the dataset this engine was
built against, on roughly 20% of legs. It is a tunable knob, not an implementation detail;
expose it.

### 5.4 Run conditions (Tier 2)

```
maxRunIn(leg, minBrr, sideWanted):
    no per-candle arrays -> -1                        // UNKNOWN, not zero
    longest run of consecutive candles b in the leg with
        brr[b] >= minBrr && (sideWanted == 0 || dir[b] == sideWanted)

resolveRunSide(side, legDir):
    'same'     -> legDir           'opposite' -> -legDir
    'bull'     -> 1                'bear'     -> -1
    'any'      -> 0                                    // direction ignored
```

`legDir = legs[j][basis] >= 0 ? 1 : -1`.

### 5.5 Section — the ordered subsequence

```
compileSection(section, ctx) -> (legs, lo, hi) => bool

  slots    = section.slots[0 .. section.count.max)
  required = min(slots.length, section.count.min ?? slots.length)
  compiled[k] = { test: compileLegRule(slots[k]), gap: compileGap(slots[k].before) }

  // Optional: how many legs of this side exist in the window AT ALL — distinct
  // from how many the pattern pins down.
  sideTotal = boundsTest(section.sideCount)
  sideTest  = section.side != 'any' ? compileLegRule({ side, kind: 'impulse' }) : null

  no slots and no sideTotal -> return null       // section constrains nothing

  evaluate(legs, lo, hi):
      if sideTotal:
          total = count of j in [lo, hi) where !sideTest or sideTest(j)
          if !sideTotal(total): return false
      if no slots: return true

      steps = 0

      // Required slots: backtracking. Returns the next free position, or -1.
      rec(k, from, limit):
          if k >= limit: return from
          { test, gap } = compiled[k]
          skipped = 0
          for p = from .. hi-1:
              if ++steps > STEP_LIMIT: return -1
              if test(p):
                  next = rec(k+1, p+1, limit)
                  if next >= 0: return next
              // p was not used for this slot, so it counts as skipped
              if gap and gap.counts(p):
                  if gap.each and !gap.each(p): return -1
                  if ++skipped > gap.maxLegs:   return -1
          return -1

      after = rec(0, lo, required)
      if after < 0: return false

      // Optional slots: greedy. Take them where they fall, stop at the first
      // that cannot be placed. An optional slot that fails is not a reason to
      // re-shuffle the required ones.
      pos = after
      for k = required .. slots.length-1:
          scan forward from pos for the first p where test(p), spending the same
          gap budget; if none, break; else pos = p + 1
      return true
```

**Two properties to preserve exactly:**

1. **`STEP_LIMIT = 20000`.** A pathological spec — many optional slots, wide gaps — would
   otherwise walk a large assignment space. 20k steps per window is far more than any real
   spec needs, and it keeps a bad spec from freezing the run.
2. **Once the gap budget is violated, no later position is reachable** — hence `return -1`,
   not `continue`. This is what keeps matching near-linear rather than combinatorial. It
   looks like an over-eager exit; it is load-bearing.

### 5.6 Gap rules — `slot.before`

What is allowed to sit between this slot and the previous one.

```
compileGap({ maxLegs, countKind, each }):
    maxLegs defaults to infinity
    each    compiles as a LegRule (skip when it constrains nothing)
    both absent -> null
    counts = countKind == 'all' ? (every segment) : (impulse segments only)   // default
```

**The impulse-only default matters.** A leg sequence alternates impulse/pullback, so between
two bull legs there is normally a pullback and nothing else. Counting it would make "no legs
between" impossible to express. With the default, `maxLegs: 0` on the first slot means
*"no impulse leg sits between this one and the current bar"* — i.e. **it is the most recent
impulse leg**, which is the single most useful gap rule in the vocabulary.

### 5.7 LegConfig

```
compileLegConfig(config, ctx):
    for side in [bull, bear]:
        compileSection({ ...config[side], side: config[side].side ?? side }, ctx)
    AND the results over the same [lo, hi) window
```

**Stated because it bites:** ordering *between* sections is not expressible. "This bull leg
must follow that bear leg" has to be written as a `before` rule inside **one** section. Do
not attempt to interleave the two matchers — the resulting semantics are ambiguous and the
search space is no longer bounded.

---

## 6. The full rule tree

Sections, AND-ed, each independently compilable:

```
WINDOW      coarse conditions on the §3 aggregates          (cheap, selective — run first)
DIRECTION   'any' | 'long' | 'short' | 'with' | 'against'   (relative to a structure read)
LEGS        LegConfig: bull section + bear section
PULLBACKS   the same Section machinery, every slot forced to kind 'pullback', side 'any'
CONTEXT     project-specific clauses + the retrace gate (§9)
```

### 6.1 Ordering for speed

Apply cheapest-and-most-selective first. Window-aggregate clauses are a handful of scalar
comparisons and typically reject most windows; the matcher then runs over far fewer of them.

### 6.2 Clause operators for the window and context sections

`between` (inclusive), `in`, `eq`, `neq`, `gte`, `gt`, `lte`, `lt`, `is-null`, `not-null`.
Categorical clauses must carry **labels, never internal codes**, so a saved config survives
a different dataset assigning different codes.

---

## 7. Failure semantics — the part most ports get wrong

### 7.1 Empty spec is identity

An unconfigured tree compiles to **no predicate**, and callers read that as "everything
matches" without paying for a pass. The engine must be a no-op until configured.

### 7.2 Unknown is not false, and it is definitely not zero

Three conditions can be *unevaluable*:

- a run condition on a leg with no per-candle arrays
- a `legScore` condition with no scores computed
- a `with`/`against` direction with no structure read available

Each must **fail the condition** *and* **increment a counter that reaches the user**
through `explain()`.

The reasoning, because it is subtle and the wrong choice is invisible: if a leg with no
candle data reported a run of `0`, it would fail every run condition — the same outcome —
but *silently*, indistinguishable from a leg that was measured and found wanting. You would
conclude your spec is too tight when in fact your data is incomplete. Conversely, passing
unevaluable conditions silently widens the filter. Fail, and say so.

### 7.3 Unmeasurable quantities are `NaN`, and `NaN` fails comparisons

A window with zero height has no measurable retrace. Return `NaN` and let it fail the
`<=` test naturally. An unmeasurable window is excluded rather than waved through — the
same convention as §7.2.

### 7.4 Clamp on load, not only in the UI

Every bounded knob (window sizes, percentage ceilings) must be clamped where the config is
*parsed*. A hand-edited file or a URL parameter must not be able to loosen a cap that the
UI enforces.

### 7.5 Reject malformed configs loudly

Version mismatch or missing required blocks → refuse to compile, with a message naming what
is missing. Half-loading a config produces a filter nobody can reason about.

---

## 8. Structure classification (optional layer)

If you want a named market-structure read — trend / range / reversal — build it from
*definitions written in this same language*, not from a hardcoded classifier or a
passthrough of some upstream label string.

```
classify(window):
    for each enabled definition, in order:
        all window clauses pass AND (no leg pattern OR leg pattern matches)
            -> class = def.class ; dir = def.dir ; STOP        // first match wins
    nothing matched -> class 'none', dir 0
```

Definitions are **ordered and first-match-wins**, so they read top to bottom as "a bull
trend looks like this; failing that, a bear trend; failing that, a range."

Test reversals **before** range: a window that has turned is otherwise swallowed by range's
balanced-dominance band.

`none` is an honest answer. Keep it visible rather than folding it into `range`.

A starting set, in the §3 vocabulary:

```
Bull Trend    trend/bull      dominance >= 0.60 , legBalance >= 1
Bear Trend    trend/bear      dominance <= 0.40 , legBalance <= -1
Bull Reversal reversal/bull   dominance <= 0.45 , + bull section: 1 impulse slot,
                                                    before { maxLegs: 0 }
Bear Reversal reversal/bear   dominance >= 0.55 , + bear section: same shape
Range         range/none      dominance in [0.40, 0.60] , legBalance in [-2, 2]
```

**Calibrate these against your own data before trusting them.** On the dataset this engine
was developed against they classified the market adequately — ~94% coverage, sensibly
distributed — and predicted outcome *hardly at all*: the three classes separated by under
0.05R with overlapping intervals at N in the thousands. Structure is a useful vocabulary
for writing rules; it is not, by itself, an edge. Make every threshold editable and part of
the exported config.

Derived: `dirVsStructure` = `+1` taken with the structure, `-1` against, `0` when the
structure has no direction (a range) or nothing matched. This is what `direction:
'with' | 'against'` resolves against — and per §7.2, when no structure read exists that
condition returns **false**.

---

## 9. Retrace depth at the current bar

Per-leg `depthRatio` (§2.2) answers a *local* question: how deep is this pullback against
the one leg it retraced. A shallow pullback off a two-candle leg and a shallow pullback off
the whole morning's range score identically there.

This answers the other question — how far into the *whole recent structure* has price come
back by now:

```
window = the newest N segments (N default 10, clamp to [2, 20])
height = max(seg.high) - min(seg.low) over that window
current = window[0].endPrice           // newest-first, so this is the current bar's close

long side  -> (windowHigh - current) / height * 100
short side -> (current - windowLow ) / height * 100

height <= 0 -> NaN                     // unmeasurable; see §7.3
```

The newest segment is itself in the window, so `current` always lies inside
`[windowLow, windowHigh]` and the result is bounded to `[0, 100]` by construction.

Gate: `pct <= maxPct`. A shallow-retrace ceiling around 30–35% is a sensible starting
point; cap the knob so it cannot be loosened past ~50%, and clamp per §7.4.

Compute this **live rather than baking it in at ingest** — `N` is exactly the kind of thing
you will want to tune, and freezing it forces a re-ingest to change it.

---

## 10. Configuration schema

Versioned, JSON, one self-contained document.

```jsonc
{
  "version": 1,
  "name": "shallow pullback in bull trend",
  "sideBasis": "realized",              // 'realized' | 'struct'

  "weights":    { "brr": 0.30, "dirClv": 0.25, "breakPersist": 0.15,
                  "moveVsMedian": 0.15, "runLength": 0.10,
                  "overlap": -0.10, "climax": -0.05 },
  "thresholds": { "legStrength": 0.60, "goodLegPct": 0.50 },

  "rules": {
    "window":    [ { "field": "dominance", "op": "gte", "value": 0.60 } ],
    "direction": "with",
    "legs": {
      "bull": {
        "count": { "min": 2, "max": 3 },
        "sideCount": { "min": 2, "max": null },
        "slots": [
          {
            "kind": "impulse",
            "candles": { "min": 3, "max": 10 },
            "movePct": { "min": 0.2, "max": 0.8 },
            "before":  { "maxLegs": 0, "countKind": "impulse" },
            "runs":    [ { "minBrr": 0.8, "minRun": 2, "side": "same" } ]
          },
          {
            "kind": "impulse",
            "candles": { "min": 3, "max": 10 },
            "before":  { "maxLegs": 2, "countKind": "impulse",
                         "each": { "movePct": { "max": 0.3 } } }
          }
        ]
      },
      "bear": { "count": { "min": 0, "max": 0 }, "slots": [], "sideCount": null }
    },
    "pullbacks": { "count": { "min": 0, "max": 0 }, "slots": [], "sideCount": null },
    "context":   { "clauses": [],
                   "retrace": { "enabled": true, "windowLegs": 10, "maxPct": 32 } }
  }
}
```

Reading the bull section aloud: *two to three bull impulse legs; the newest is the most
recent impulse leg in the window (`maxLegs: 0`), runs 3–10 candles, moves 0.2–0.8%, and
contains at least two consecutive high-conviction candles in its own direction; the next
one back is also 3–10 candles, with at most two impulse legs between them, and any such
intervening leg must move no more than 0.3%.* That sentence is the thing no aggregate
filter can express.

### 10.1 Choosing thresholds — put the distribution next to the input

If you build a UI, compute per-field percentiles (p10/p25/p50/p75/p90) over the legs a
section targets, and:

- **open a new condition at p25–p75**, so it starts near-neutral and gets *tightened*
  rather than loosened;
- **show the spread next to the input**, so a threshold is chosen against the data rather
  than against a guess.

This matters more than it looks. A fresh condition opened at arbitrary numbers starts the
spec at "matches nothing", and the natural response is to loosen — which is the wrong
direction to explore from, and it hides how rare the shape you asked for actually is.

Expect the numbers to be humbling. On the reference dataset the median bull impulse leg was
**3 candles and 0.10%**, and its longest run at BRR ≥ 0.8 was **zero**. Conditions written
for the long, clean legs people picture will match almost nothing.

### 10.2 Guard against curve fitting

If the config is tuned against historical outcomes, **make it carry its own evidence**: the
dataset it was fitted on, an in-sample result, and an out-of-sample result with the N behind
each. Refuse to export a config with no out-of-sample result, and do not make that
overridable.

This is not ceremony. On the reference dataset, two separate specs looked strong on a
two-year in-sample window and **inverted** on the following year. The refusal is the only
thing standing between that and a live system.

---

## 11. Invariants

1. **Newest-first, always.** Index 0 is closest to the current bar. Slot order is storage
   order. Normalise once, at the adapter.
2. **Structural direction and realized direction are different quantities.** Keep both;
   `sideBasis` selects. They disagree often enough to change results.
3. **`kind` is binary at the feature level** (impulse = 0, pullback = 1) regardless of how
   your source labels it. If your source tags a pullback with the direction *opposite* to
   the leg it retraces, that is a convention, not a bug — carry it through unchanged.
4. **Unknown fails and is counted.** §7.2. Never let an unevaluable condition silently
   widen or narrow the filter.
5. **`movePct` is signed at the source; every rule uses the absolute value.**
6. **`clv` is the 0..1 form; bear legs mirror it.** After mirroring, higher is always better
   in both directions.
7. **Score normalisation by `span`**, not a plain weighted sum — thresholds depend on it.
8. **Units.** `movePct` and retrace are percent (0–100); `dominance`, `brr`, `clv`, `score`
   are fractions (0–1). Do not mix them.
9. **Compile once, evaluate many.** The compiled predicate closes over its thresholds. Per
   window the cost is one pass over ~10–25 segments plus, at worst, `STEP_LIMIT` steps.

---

## 12. Acceptance tests

1. **Empty-spec identity** — an unconfigured tree accepts every window.
2. **Bar-quality identity** — `brr + uwr + lwr === 1` per candle; zero-range candles give
   all zeros.
3. **Direction mapping** — every non-doji candle classifies; zero-body candles map to `0`,
   not to a side.
4. **Gap semantics** — `before: { maxLegs: 0 }` on slot 1 matches **only** when that leg is
   the most recent impulse leg in the window.
5. **Non-adjacency** — a two-slot section matches legs at positions 0 and 3 when the gap
   budget allows, and fails when it does not.
6. **Optional slots** — with `count: { min: 1, max: 3 }`, a window satisfying only slot 1
   matches; an optional slot failing never invalidates a required match.
7. **Step limit** — a deliberately pathological spec terminates and returns false rather
   than hanging.
8. **Unknown runs** — a window with no per-candle arrays plus a run condition rejects
   **and** reports `unknown > 0` in `explain()`.
9. **Unmeasurable retrace** — a zero-height window fails the retrace gate rather than
   passing it.
10. **Clamping** — a config with `windowLegs: 999`, `maxPct: 400` loads clamped, not as
    written.
11. **`sideBasis` sensitivity** — a fixture where structural and realized direction
    disagree produces different results under the two bases. If it does not, your basis
    plumbing is not connected.

---

## 13. Build order

1. Adapter + Tier 0 features + window aggregates (§1–3). Verify against known windows by hand.
2. `boundsTest`, `compileLegRule` for numeric fields only (§5.2–5.3).
3. `compileSection` with required slots, no gaps (§5.5). Test non-adjacency.
4. Gap rules (§5.6), then optional slots. Test 4–6 above.
5. `compileLegConfig` + the AND-ed rule tree (§5.7, §6).
6. `explain()` and `describe()`. **Do not defer these** — you will need them the first time
   a spec matches nothing, which will be immediately.
7. Tier 1 (quality fields, scoring) and Tier 2 (run conditions) as the data becomes available.
8. Structure (§8) and retrace (§9) last — both are optional layers over a working engine.
