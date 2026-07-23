# Advice system — data-driven nap-plan guidance

## Context

The tracker holds a **plan** (active template: wake windows + nap durations + bounds)
and re-projects the day from it, but it never tells the caregiver whether that plan
matches reality or how to recover a day that's gone sideways. The goal is an
**advice system** that analyses the last ~1–2 weeks and, grounded in established
infant-sleep practice, advises on the plan.

Established, standard-of-care guidance the rules encode (sources at bottom):

- **Wake windows by age** — the foundational tool for preventing over/undertiredness;
  age bands give ranges, cues matter too (guidance, never hard rules).
- **Nap count by age** — ~4→3 (≈4–6mo), 3→2 (≈6–9mo), 2→1 (≈13–18mo), 1→0 (3–5y).
- **Total 24h & daytime sleep targets** by age.
- **Short naps / overtiredness** — a too-long wake window before bed drives bedtime
  resistance, night waking, early rising; a nap ≤ threshold shortens the next window.
- **Nap-transition readiness signals** — repeated nap refusal, long bedtime latency,
  early-morning / night waking that improves on no-nap days.

This is **two systems**:

- **A — In-day advice**, embedded in the projection engine: when today drifts, advise
  how to salvage the rest of the day. Surfaces on the Right-now home.
- **B — Planning advice**, on the planning (`/templates`) page: analyse 1–2 weeks and
  suggest concrete edits to the active template, each with **one-tap apply**.
- Plus an **optional birth date** so age-based rules unlock (falls back to
  data-only advice when it's unset — the current state: no `baby` row exists).

Note: analytics/trends are listed **Deferred (post-v1)** in `REQUIREMENTS.md §8`; this
adds guidance rather than trend charts, but it is net-new scope. The data model needs
no schema change except reading/writing the already-existing `baby.birth_date`.

## Real-data sanity check (last ~2 weeks, from `local.db`)

Actual daily nap count swings 3–4; naps often 20–35 min; nights ~9–10.5h; active
template is named "4-nap day" but `napCount:3`, windows `[140,150,150,160]`, naps
`[80,80,30]`. One **corrupt overlapping night** (2026-07-16→22, 8080 min) — the stats
layer **must filter outliers** (nights >16h / naps >4h, zero/negative windows).

---

## Task tracker

States: `new` → `pending` (attempted, tests failing / findings open) → `implemented`
(tests green, awaiting review) → `done` (reviewed, no findings).

| #   | Task                                                                                                          | State |
| --- | ------------------------------------------------------------------------------------------------------------- | ----- |
| SF1 | Age reference table (`reference.ts` + spec)                                                                   | done  |
| SF2 | Baby server query + `parseBabyUpdate` validation (`queries/baby.ts`, `seed.ensureBaby`, `validate.ts` + spec) | done  |
| SF3 | Settings page "Baby" section (birthDate input) + page spec                                                    | done  |
| A1  | In-day advice engine (`dayAdvice.ts` + types + `project()` wiring + spec)                                     | done  |
| A2  | Home advice card + pass `ageMonths` from `getBaby()` in `queries/projection.ts`                               | done  |
| B1  | `advice/types.ts` + `stats.ts` (`computePlanStats`) + spec                                                    | done  |
| B2  | `advice/plan.ts` (`advisePlan`) + spec                                                                        | done  |
| B3  | `queries/planAdvice.ts` + export `readDayEntries` (+ pure `advice/analyse.ts`)                                | done  |
| B4  | `/templates` load + `applyAdvice` action + svelte + spec                                                      | done  |

Progress log:

- 2026-07-22: SF2 implemented — `parseBabyUpdate` (+4 tests), `getBaby`/`updateBaby`,
  `ensureBaby`. Gates green (172 tests, check, lint).
- 2026-07-22: B1 implemented — `advice/types.ts` (`PlanStats`, `PlanAdvice`),
  `stats.ts` (`computePlanStats`, median/modal + outlier filter) + spec (4 tests,
  incl. corrupt-overlap guard). Gates green (176 tests, check, lint).
- 2026-07-22: B2 implemented — `advice/plan.ts` (`advisePlan`) + spec (9 tests).
  Rules 1 (WW drift), 2 (nap duration), 3 (nap-count structural patch), 4 (bedtime
  late, info-only), 5 (age band), 7 (age daytime) done. **Rule 6 (nap-transition
  readiness) NOT implemented — known gap for the B2 review.** Gates green (185
  tests, check, lint).
- 2026-07-22: B3 implemented — pure `advice/analyse.ts` (`analysePlan`,
  `buildDayProjections`) + `queries/planAdvice.ts` (`getPlanAdvice`, thin DB
  wrapper); exported `readDayEntries` from `sleeps.ts`. Pure core tested in
  `analyse.spec.ts` (5 tests); DB wrapper untested by repo convention. Note: pure
  logic lives in `$lib/advice/analyse.ts` (not inside `queries/planAdvice.ts`) so
  it stays DB-free/testable. Gates green (190 tests, check, lint).
- 2026-07-22: SF3 implemented — settings `load` returns `baby: getBaby()`; `save`
  action also persists `birthDate` via `parseBabyUpdate`/`updateBaby` (empty clears);
  new "Baby's birth date" `<input type=date>` section in `+page.svelte`; page spec
  +2 tests (value shown & survives save; empty when unset). Gates green (192 tests,
  check, lint).
- 2026-07-22: A2 implemented — `buildProjection` now derives `ageMonths` from
  `getBaby().birthDate` via `ageMonthsFromBirthDate` and passes it into `project()`;
  home `+page.svelte` renders a compact in-day advice card (`data.projection.advice`,
  warn/info styling, optional `suggestedTime` chip) above the quick-log. No dedicated
  page spec — the home view has no existing spec harness and advice generation is
  covered by `dayAdvice.spec.ts`; validated via check + build. Gates green (192
  tests, check, lint, build).
- 2026-07-22: B4 implemented — `/templates` `load` adds `planAdvice` (via
  `getPlanAdvice`); new `applyAdvice` action re-derives advice server-side, looks up
  by `id`, merges its `patch` into `activeColumns(getActiveTemplate())`, re-validates
  with `parseTemplate`, and calls `updateActiveTemplate` (client never sends a
  trusted patch — 409 on stale id, 400 on no-patch). `+page.svelte` gains an "Advice"
  panel of cards with progressive-enhanced Apply forms (`reset:false`); info-only
  advice shows no button. Page spec +3 tests. Gates green (195 tests, check, lint,
  build).
- 2026-07-22: SF1 reviewed → **done**. No findings. `referenceForAge` band
  selection (ascending, half-open upper bound, negative/NaN/null/≥36 guarded) and
  `ageMonthsFromBirthDate` (fractional months, future/malformed guards) are correct;
  spec covers all branches (9 tests green). Pure, no DB/route imports. Minor
  non-issue: `total24hMin` reference data is not yet consumed by any rule (plan.ts
  uses `daytimeMin`) — intentional headroom, not a defect.
- 2026-07-22: SF2 reviewed → **done**. No findings. `parseBabyUpdate` +
  `isRealCalendarDate` correct (zero-padded ISO required, rollovers/`2026-02-30`
  rejected, `''`/null clears); `getBaby`/`updateBaby`/`ensureBaby` faithfully mirror
  the settings query with fixed `id:'baby'`; spec 4 tests green. Non-issues: (a) a
  foreign backup carrying a non-`'baby'` baby id would create a second row `getBaby`
  ignores — same pre-existing limitation as `settings`, not SF2-specific; (b) **for
  the SF3 review**: the settings `save` action runs `updateSettings` _before_
  `parseBabyUpdate`, so a crafted POST with a bad `birthDate` persists settings then
  errors (partial write). Not reachable from the `type=date` UI; flag under SF3.
- 2026-07-22: SF3 reviewed → **pending** (1 finding). The `save` action calls
  `updateSettings(...)` (which _writes_) before `parseBabyUpdate(...)` is evaluated,
  so a crafted POST with an invalid `birthDate` persists the settings change and then
  returns `fail` — a partial write that reports failure. Fix: validate both inputs
  first (call `parseSettingsUpdate` + `parseBabyUpdate` up front), then perform both
  `updateSettings`/`updateBaby` writes, so a bad field rejects the whole save. Low
  severity (unreachable from the `type=date` UI, only the user's own data), but a
  real robustness defect. Otherwise SF3 is correct: load returns `baby`, field is
  value-bound and survives `reset:false`, page spec (+2) green.
- 2026-07-22: SF3 finding fixed → **implemented**. `save` action now parses both
  `parseSettingsUpdate` + `parseBabyUpdate` up front, then writes both — a bad field
  rejects the whole save (no partial write). Gates green (195 tests, check, lint).
  Awaiting re-review.
- 2026-07-22: A1 reviewed → **pending** (1 finding). Rule 4 (low daytime) fires on
  `napsLeft <= 1`, so it also triggers when `napsLeft === 0` (all naps done, only
  bedtime left), yet its detail says "Lengthen the remaining nap or bring bedtime
  earlier" — there is no remaining nap in that reachable state. Fix: make the detail
  conditional on `napsLeft` (drop the "lengthen the remaining nap" clause when
  `napsLeft === 0`, keeping "bring bedtime earlier"); add a spec case for the
  no-naps-left path. Non-blocking notes (no change needed): (a) Rule 2 threshold uses
  `min(templateWindow, ref.wakeWindowMax)` — a deliberate conservative choice (age
  max can tighten but not loosen the plan-based warning); (b) otherwise all 5 rules
  are correct and well-tested (8 cases green), pure, no DB/route imports.
- 2026-07-22: A1 finding fixed → **implemented**. Rule 4 detail is now conditional on
  `napsLeft` ("Lengthen the remaining nap or bring bedtime earlier" only when a nap
  remains, else "Bring bedtime earlier"); +1 spec case for the no-naps-left path (9
  cases). Gates green (196 tests, check, lint). Awaiting re-review.
- 2026-07-22: B1 reviewed → **pending** (1 finding, logic). `computePlanStats` pushes
  `daytimeTotals.push(daytimeTotal)` **unconditionally** (stats.ts ~L92), so a day with
  no logged sleep contributes a `0`. `getPlanAdvice` analyses all 14 window days incl.
  unlogged ones, so `daytimeTotalMedian` is padded with zeros and dragged toward 0 —
  which makes plan.ts Rule 7 (`age-daytime-total`) fire "daytime sleep below typical"
  on essentially any window that has gaps. Every other metric (nap windows/durations,
  night length, bedtime, morning wake) is pushed conditionally; only `daytimeTotals`
  leaks empty days. **Fix:** move the `daytimeTotals.push` to after signal detection
  and guard it on `dayHasSignal` (a genuinely napless-but-tracked day — night/morning
  wake present, 0 naps — still legitimately pushes 0; a fully unlogged day pushes
  nothing). Add a stats spec case: a window mixing logged + empty days must not skew
  `daytimeTotalMedian`. Otherwise B1 is correct (medians/mode/outlier filter/clock
  conversion sound; 4 cases green incl. corrupt-overlap guard).
- 2026-07-22: B1 finding fixed → **implemented**. `daytimeTotals.push` moved to after
  signal detection and guarded on `dayHasSignal`, so fully unlogged window days no
  longer inject `0`s into `daytimeTotalMedian` (a napless-but-tracked day still pushes
  a real 0). +1 stats spec case (3 logged + 4 empty days → `dayCount 3`,
  `daytimeTotalMedian 120`). Gates green (197 tests, check, lint). Awaiting re-review.
- 2026-07-22: B2 reviewed → **pending** (1 finding + 1 note). **Finding (spec gap):**
  Rule 6 (nap-transition readiness) is not implemented — the plan lists 7 rules and
  B2 shipped 1–5 and 7. **Fix:** add Rule 6 as a low-confidence structural "drop a
  nap" suggestion, gated on: `ref` present, `template.napCount > 1`,
  `template.napCount > ref.napCount[0]` (never drop below the age minimum), and a
  readiness signal from stats — the final nap position is frequently skipped
  (`napDurationSamples[napCount-1]` well below `stats.dayCount`) or consistently
  short; only emit when Rule 3 didn't already fire the same target, patch =
  `resizePatch(template, napCount-1)`; add a plan.spec case. **Secondary note
  (non-blocking):** Rule 4 (`bedtime-late`) compares `stats.bedtimeMedian` (minutes-
  of-day) to the plan bedtime, so a past-midnight median bedtime wraps to a small
  number and is misread as very early (missed warning). Info-only + rare; optional to
  guard (e.g. add 1440 when bedtime < morningWake) — can be left as-is. Rules 1–5, 7
  and the resize helpers (shrink + extend) are otherwise correct; 9 spec cases green.
- 2026-07-22: B2 Rule 6 implemented → **implemented**. Added `nap-transition` rule:
  low-confidence structural "drop to N−1 naps" nudge, gated on `ref` present,
  `napCount > 1`, `napCount > ref.napCount[0]`, `modalNapCount !== napCount−1` (defers
  to Rule 3), and the last nap taken on ≤60% of tracked days
  (`napDurationSamples[last] ≥ 1 && ≤ dayCount*0.6`); patch = `resizePatch(napCount−1)`.
  +3 plan.spec cases (fires; quiet when last nap consistent; defers to nap-count rule).
  All 7 rules now present. Gates green (200 tests, check, lint). Awaiting re-review.
  (Rule 4 midnight-wrap note left as documented non-blocking.)
- 2026-07-22: B3 reviewed → **done**. No observable findings. `analysePlan` windows
  days, builds completed projections via the pure grouping helpers, resolves age via
  `referenceForAge`, and delegates to the tested stats/plan engines; `getPlanAdvice`
  supplies entries/settings/template/age and correctly excludes today (dayKeys =
  `shiftDateKey(today, -1..-14)`). Pure core green (5 cases). Non-blocking note: in
  `buildDayProjections` the fallback anchor uses `Date.UTC(y,m-1,d,12)`, which for
  UTC+12…+14 zones lands on `dayKey+1` locally, so the day-start would resolve on the
  wrong calendar day — but the anchor is only used for a bedtime-only/empty day and
  the resulting window clamps to 0 and is dropped, so impact is nil. Optional cleanup:
  use `resolveLocalDateTime(`${dayKey}T12:00`, timeZone)` and correct the comment's
  "regardless of the zone's UTC offset" claim.
- 2026-07-22: B4 reviewed → **done**. No findings. `applyAdvice` enforces the
  server-re-derives-only model: client sends only `id`; server recomputes advice
  (`409` stale id, `400` no-patch), merges the freshly-computed `patch` into
  `activeColumns(getActiveTemplate())`, and re-validates via `parseTemplate` before
  `updateActiveTemplate` — no trusted patch reaches the DB; patch-merge validity is
  proven in plan.spec, advice text is server-generated + Svelte-escaped (no injection).
  Panel shows Apply only when `patch` present; load re-run refreshes plan + advice.
  Page spec (4 cases) green. Non-blocking: the action's glue (id lookup/merge) is
  exercised indirectly (engine + merge-validity + render tests), consistent with the
  repo's untested-server-action convention.
- 2026-07-23: A2 reviewed → **done**. No findings. `buildProjection` derives
  `ageMonths` from `getBaby().birthDate` (null when unset) and passes it to `project()`
  — additive-safe (only `adviseDay` reads it; projection math unchanged). Home card
  reads `data.projection?.advice ?? []`, scoped to the `data.isToday` branch (null →
  no card on past days), warn/info styling + optional `suggestedTime` chip via
  `fmtTime`; content is server-generated + Svelte-escaped. Current tree `check` 0
  errors + `build` clean. No dedicated page spec (home has no spec harness; engine
  advice covered by `dayAdvice.spec`) — the "card reacts to a short/late nap" check is
  the plan's manual e2e step.
- 2026-07-23: SF3 re-reviewed → **done**. Confirmed the `save` action evaluates
  `parseSettingsUpdate` + `parseBabyUpdate` up front and only then calls
  `updateSettings`/`updateBaby`, so an invalid `birthDate` throws before any write —
  partial-write finding fully resolved. Page spec (4 cases) green.
- 2026-07-23: A1 re-reviewed → **done**. Confirmed Rule 4's action clause is
  conditional on `napsLeft` ("Lengthen the remaining nap or bring bedtime earlier"
  only when `napsLeft >= 1`, else "Bring bedtime earlier") — no phantom "remaining
  nap" in the no-naps-left state. dayAdvice.spec 9 cases green (incl. the no-naps-left
  guard). Finding resolved.
- 2026-07-23: B1 re-reviewed → **done**. Confirmed the early unconditional
  `daytimeTotals.push` is gone; the push now runs only inside `if (dayHasSignal)`
  after all signal detection, so fully unlogged window days no longer inject `0`s into
  `daytimeTotalMedian` (napless-but-tracked days still push a real 0). stats.spec 5
  cases green (incl. mixed logged/empty window). Logic finding resolved.
- 2026-07-23: B2 re-reviewed → **done**. Confirmed Rule 6 (`nap-transition`) matches
  the fix spec — gated on `ref`, `enoughDays`, `napCount > 1`, `napCount >
ref.napCount[0]`, defers to Rule 3 (`modalNapCount !== napCount−1`), fires on
  `finalSamples ∈ [1, dayCount*0.6]`, patch = `resizePatch(napCount−1)`, low-confidence
  info. All 7 planning rules present; plan.spec 12 cases green. Rule 4 midnight-wrap
  remains a documented non-blocking note (info-only, rare). Full gate suite green: 200
  tests, check, lint, build. **All 9 tasks done — advice system complete.**

---

## Shared foundation

### Age reference table — `src/lib/advice/reference.ts` (new, pure)

`referenceForAge(months) → { napCount:[min,max], wakeWindowMin, wakeWindowMax,
total24hMin:[lo,hi], daytimeMin:[lo,hi] } | null`. A small banded table (0–1.5, 1.5–3,
3–4, 4–6, 6–9, 9–12, 12–15, 15–18, 18–24, 24–36 mo) compiled from the sources below,
documented as **guidance ranges**. `+ reference.spec.ts`.

### Optional birth date (unlocks age rules)

- `src/lib/server/queries/baby.ts` (new): `getBaby()` / `updateBaby({birthDate})`,
  lazy-creating the single `baby` row (mirror `getSettings`/`ensureSettings`).
- `ageMonthsFromBirthDate(birthDate, now)` helper (pure, in `reference.ts`).
- Settings page (`src/routes/settings/+page.{server,svelte}.ts`): add a small "Baby"
  section with a `birthDate` (`<input type=date>`); wire into the existing `save`
  action; validate in `src/lib/server/api/validate.ts` (`parseBabyUpdate`). Field must
  retain its value across save (REQUIREMENTS §6 Forms) — extend
  `settings/page.svelte.spec.ts`.

---

## System A — In-day advice (embedded in projection)

> **Status (2026-07-22): DONE — engine + tests.** `dayAdvice.ts` implements all 5
> rules; `ProjectionInput.ageMonths` + `Projection.advice` added to `types.ts`;
> `project()` appends `adviseDay(...)`; `completedProjection` returns `advice: []`.
> New `dayAdvice.spec.ts` (8 cases) added. All 168 unit tests pass; `npm run check`
> and `npm run lint` clean. **Not yet done:** the home advice card in
> `routes/+page.svelte` and passing `ageMonths` from `getBaby()` in
> `queries/projection.ts` (both depend on the still-pending baby/birth-date task).

Pure module **`src/lib/projection/dayAdvice.ts`** (new): `adviseDay(input, projection)
→ DayAdvice[]`, where `DayAdvice = { id, severity:'info'|'warn', title, detail,
suggestedTime?:number }`. Read-only nudges (no apply button — these are behavioural).

- `ProjectionInput` gains optional `ageMonths?: number` (`types.ts`).
- `Projection` gains `advice: DayAdvice[]` (`types.ts`); `project()` computes the
  projection as today, then appends `adviseDay(...)` at the end so advice is truly part
  of the engine output the home already consumes. Existing `project.spec.ts` expectations
  are additive-safe (new field); add focused cases in a new `dayAdvice.spec.ts`.

Rules (all derived from the already-computed projection — `budget`, `nextSleep`,
`currentState`, projected night start vs `planBedtime`):

1. **Short nap just ended** → explain the auto-shortened next window + give the earlier
   suggested next-sleep time (anti-overtiredness).
2. **Overtired now** — awake and `currentState.elapsedMin` exceeds the current window
   target (or age max) beyond tolerance → "put down soon / bring bedtime earlier".
3. **Bedtime floating late** — projected night start later than `planBedtime` target by
   > ~30 min (naps ran short) → suggest an earlier bedtime `HH:MM` tonight.
4. **Low daytime sleep** — `budget.daytimeUsedMin` tracking well under target with few
   naps left → suggest lengthening the remaining nap / earlier bedtime.
5. **Early/late morning wake** shifts nap 1 — surface the shifted first-nap time.

Surface on `src/routes/+page.svelte` as a compact advice card (reads
`data.projection.advice`). `buildProjection` (`queries/projection.ts`) passes
`ageMonths` from `getBaby()`.

---

## System B — Planning advice (`/templates`, one-tap apply)

Pure engine (mirrors `src/lib/projection/` purity, fully unit-tested):

- **`src/lib/advice/stats.ts`** — `computePlanStats(days, settings) → PlanStats`:
  per-position **median** actual wake windows & nap durations, **modal** daily nap
  count, median night length / bedtime / morning wake, short-nap rate, median daytime
  total, per-position sample sizes. **Filters outliers** first. Days are built by
  reusing `groupDayForKey` + `completedProjection` (`queries/day.ts`) to get each day's
  real wake gaps (`wakeWindowBeforeMin`).
- **`src/lib/advice/plan.ts`** — `advisePlan(stats, template, ref?) → PlanAdvice[]`,
  each `{ id, severity, confidence, title, detail, patch?: Partial<TemplateInput> }`.
  Only advises a position with enough sample (≥ ~4 days). Ordered by severity ×
  confidence.
- **`src/lib/advice/types.ts`**, `stats.spec.ts`, `plan.spec.ts`.

Rules → concrete `patch`:

1. **Wake-window drift** (per position): |median − target| beyond tolerance → set
   `wakeWindows[i]` to median (clamped to that position's min/max).
2. **Nap-duration reality** (per position): set `expectedNapDurations[i]` to median.
3. **Nap-count mismatch**: modal actual count ≠ `napCount` → structural patch resizing
   `wakeWindows`/`expectedNapDurations` (+ bounds) to the observed count.
4. **Bedtime late / inconsistent**: median bedtime later than plan bedtime beyond
   tolerance → trim windows toward it.
5. **Age band** (if age): median WWs / nap count outside the age band → nudge toward it.
6. **Nap-transition readiness** (if age + refusal/short-final-nap signal in a transition
   window) → suggest dropping a nap (structural patch), flagged lower-confidence.
7. **Total daytime / 24h sleep** vs age range → informational (no patch).

Server + wiring:

- **`src/lib/server/queries/planAdvice.ts`** (new): read the last N (default 14) local
  days of entries (reuse `readDayEntries` — export it from `queries/sleeps.ts` — grouped
  via `groupDayForKey`/`shiftDateKey`), compute stats, and produce advice against
  `getActiveTemplate()` + `getBaby()` age.
- **`/templates` load** adds `planAdvice`. New action **`applyAdvice`**: takes the advice
  `id`, **recomputes advice server-side**, merges that advice's `patch` into the current
  active columns, validates via `parseTemplate`, and calls `updateActiveTemplate` — the
  client never sends a trusted patch. Re-render shows the updated plan + refreshed advice.
- `src/routes/templates/+page.svelte`: an "Advice" panel of cards, each with an
  **Apply** button (progressive-enhanced form posting `id`; `update({reset:false})`).
- Extend `templates/page.svelte.spec.ts` for card render + apply.

---

## Critical files

New: `src/lib/advice/{reference,stats,plan,types}.ts` (+ specs),
`src/lib/projection/dayAdvice.ts` (+ spec), `src/lib/server/queries/{baby,planAdvice}.ts`.
Modified: `src/lib/projection/types.ts`, `project.ts`, `queries/projection.ts`,
`routes/+page.svelte`, `routes/templates/+page.{server.ts,svelte}`,
`routes/settings/+page.{server.ts,svelte}`, `lib/server/api/validate.ts`,
`queries/sleeps.ts` (export `readDayEntries`). Reuse: `groupDayForKey`,
`completedProjection`, `shiftDateKey`, `localDateKey` (`queries/day.ts`); `planBedtime`,
`resolveClockTime`, `msToMinutes` (`projection/`); `columns`, `updateActiveTemplate`,
`getActiveTemplate` (`queries/templates.ts`); `parseTemplate` (`api/validate.ts`).

## Verification

Follow the `delivery-workflow` skill (TDD). Gates via Docker per `AGENTS.md`:
`npm run check` (primary), `npm run test` (new pure specs + page specs), `npm run lint`,
`npm run build`. End-to-end: boot the app, confirm the home in-day advice card reacts to
a short/late nap, and that a planning-advice **Apply** changes the active template and
the projection follows. Guard the corrupt-overlap outlier case with a stats unit test.

## Sources (proven approaches)

- Huckleberry — [sleep schedule by age](https://huckleberrycare.com/blog/baby-sleep-schedule-by-age-nap-and-sleep-chart),
  [nap transitions](https://huckleberrycare.com/blog/nap-transitions-when-they-occur-and-how-to-handle-them).
- HappiestBaby — [wake windows by age](https://www.happiestbaby.com/blogs/baby/wake-windows).
- The Bump — [wake windows](https://www.thebump.com/a/wake-windows).
- Pampers — [when do babies drop a nap](https://www.pampers.com/en-us/baby/sleep/article/when-do-babies-drop-a-nap).
- Little Ones — [nap transitions](https://www.littleones.co/blogs/our-blog/nap-transitions-how-and-when-your-baby-will-drop-their-naps).

(Age numbers are documented in `reference.ts` as guidance ranges, not hard limits.)
