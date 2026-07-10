# Handover — next steps

Last updated: 2026-07-09 · Starting point: commit `a3083d9` (initial scaffold)
· Steps 1 (projection engine), 2 (data access + JSON API), 3 (quick-log +
"Right now" home), and 4 (remaining v1 views) complete.

Read `REQUIREMENTS.md` for the full spec and `CLAUDE.md` for the Docker-only
workflow (no host Node). This doc is just the ordered build plan from here.

## ▶ REQUESTED CHANGE — conserve the wake+nap budget when re-projecting (next up)

### The problem

Today the cascade slides. When a nap is logged **later** than planned (a longer
actual WW1, or a later start), the remaining projected sleeps each keep their
**full template wake windows**, so the whole rest of the day shifts later by the
same amount and the **total planned awake time grows** — bedtime drifts.

Where this lives: `src/lib/projection/project.ts`, the projected branch (~L97–114).
A projected sleep is `lastWake + minutesToMs(wakeWindows[index])`, and `lastWake`
is the _actual_ end of the previous logged sleep. Nothing pulls the tail of the
day back toward a fixed bedtime — the template windows are applied verbatim.

### Desired behaviour

When re-projecting the remaining sleeps after a log, **recalculate** all
remaining wake windows and nap durations so the **total planned wake time + nap
time stays the same** (i.e. the target bedtime stays put) instead of every
sleep shifting by a fixed delta. Redistribute the surplus/deficit across what's
left of the day.

This requires bounds, so the redistribution stays sane:

- **Min/max length per wake window** and **min/max length per nap**, both
  **per-position arrays** (a min/max for each of the `napCount + 1` windows and
  each of the `napCount` naps — not a single global bound). Clamp each
  recalculated value to its own bounds.
- **Wake windows take priority over naps.** The wake-window budget matters more
  than the nap budget: hold windows at their template targets as far as their
  bounds allow, and absorb the surplus/deficit into **nap durations** first.
  Only flex windows (within their min/max) once naps are pinned at a bound.
- **Nap-drop fallback → merge into the night.** If the naps still can't fit
  within bounds, **drop a nap**; the dropped nap is **absorbed into the night
  sleep** (the night can be counted as the sleep that "replaces" it — bedtime
  effectively moves earlier for that unit). Re-distribute across the rest.

### What is conserved — DECIDED: anchor to a fixed target bedtime

Redistribution holds a **fixed target bedtime** (a wall-clock `'HH:MM'`, the day
anchor for the tail). On each re-project, distribute the interval from the last
actual wake to that target bedtime across the _remaining_ wake windows + naps
(proportional to their template shares), each clamped to min/max; if they can't
fit, drop a nap (below). The target bedtime does **not** move.

Implication: projection now needs a **real bedtime field**. Today
`bedtime_start/end` are `'HH:MM'` **reference only** (schema.ts L42–43). Decide:
promote `bedtime_start` to the projection anchor, or add a dedicated
`target_bedtime` `'HH:MM'`. Resolve it to epoch-ms on the anchor's calendar day
via `resolveClockTime(hhmm, anchor, timeZone)` (already in `projection/time.ts`),
rolling to the next day if it lands before the last wake.

### Decided

- **Bounds are per-position arrays.** New per-template config:
  `wake_window_min[]` / `wake_window_max[]` (length `napCount + 1`) and
  `nap_duration_min[]` / `nap_duration_max[]` (length `napCount`). Needs
  `schema.ts` + a Drizzle migration (`npm run db:generate`), plus `TemplateConfig`
  in `src/lib/projection/types.ts`, `parseTemplate` validation, and the
  `/templates` editor UI.
- **Priority: wake windows over naps** (see Desired behaviour) — flex naps first,
  windows only once naps are pinned at a bound.
- **Drop rule:** drop a nap and **merge it into the night sleep** (bedtime for
  that unit moves earlier); cascade the drop if still infeasible.
- **REQUIREMENTS.md now enforces budgets** — §5.5 and the closing "reference-only"
  line were rewritten so the target bedtime + min/max bounds are **enforced**
  during redistribution (done in this pass; verify wording still matches the
  final implementation).

### Status — ✅ COMPLETE (2026-07-10)

- **Engine DONE** (2026-07-10). `src/lib/projection/{types,project}.ts` implement
  the redistribution (fixed target bedtime, per-position bounds, wake-window
  priority, nap-drop→merge-into-night), gated behind `targetBedtime`; absent it,
  the legacy cascade is byte-identical. Tests in `project.spec.ts` (29 total
  green); check/lint/build clean.
- **Wiring DONE** (2026-07-10). The `TemplateConfig` fields are now carried
  end-to-end: `schema.ts` + migration `drizzle/0001_flat_hydra.sql`
  (`target_bedtime`, `wake_window_min/max`, `nap_duration_min/max` on both
  `template` and `active_template`), `parseTemplate` validation (array-length +
  `min ≤ max` + non-negative), `queries/templates.ts` DTO/`columns()`,
  `buildProjection`, the seed example (19:00 target + bounds), and the
  `/templates` editor (target-bedtime input + a "Redistribution bounds" section).
  Verified live: seeded template projects bedtime at **19:00** (redistributed);
  clearing the target reverts to the **19:45** legacy cascade. Gates green
  (check/lint/test/build); smoke suite 10/10. Remaining polish (1-min rounding
  drift, existing-install upgrade, non-integer bounds) is in `BACKLOG.md`.

### Still open (decide before/while building)

- Exactly **which** nap to drop when several remaining (last remaining is the
  simplest; revisit if it produces bad schedules).
- Whether redistribution is always-on or a per-template toggle (default: on).

### Implementation sketch

- Keep the logic **pure** in `src/lib/projection/project.ts`; the redistribution
  is a transform over the still-`projected` tail after the last logged sleep.
- Add the new bounds (+ bedtime target inputs) to `types.ts`, thread them from
  `schema.ts` → `queries/projection.ts` → `project()`.
- Cover with new cases in `project.spec.ts`: late first nap (bedtime held),
  clamp hit, and infeasible → nap dropped. `npm run test` is the gate.

## Where things stand

Scaffold is complete and verified (typecheck, lint, build, boot, migrations,
Docker image all green). What exists:

- Data model in `src/lib/server/db/schema.ts` (baby, template, active_template,
  sleep_entry, night_waking, settings) + migration in `drizzle/`.
- DB wiring with migrations-on-boot (`src/lib/server/db/index.ts`,
  `src/hooks.server.ts`).
- PWA shell (manifest, icon, service worker) + placeholder home page.
- Docker packaging (multi-stage `Dockerfile`, `docker-compose.yml`).

What does **not** exist yet: any real logic, API endpoints, or working UI. The
home screen is a static placeholder.

## Next steps (in order)

### 1. Projection engine — pure module, unit-tested first ✅ DONE

Built in `src/lib/projection/` (no DB/route imports, fully unit-tested):

- `types.ts` — `ProjectionInput` / `Projection` and supporting types, decoupled
  from Drizzle rows.
- `time.ts` — `resolveClockTime(hhmm, referenceEpoch, timeZone)` resolves a
  wall-clock 'HH:MM' to epoch-ms on the reference day (DST-safe, via `Intl`; no
  tz library on the host).
- `project.ts` — `project(input)`: the cascade. Anchors to `morningWake` else the
  resolved `referenceWakeTime`; cascades `wakeWindows` + `expectedNapDurations`
  forward; applies the short-nap reduction (a manual `windowOverrides[i]` wins and
  suppresses it); returns each sleep (completed/in-progress/projected) with
  start/projectedEnd, `nextSleep`, `currentState`, and display-only budget totals.
- `project.spec.ts` / `time.spec.ts` — 13 tests: pre-first-wake, actual re-anchor
  (early/late), short-nap reduction + override, in-progress sleep, normal day,
  logged bedtime, and tz/DST resolution. All green (`npm run test`), check + lint
  clean.

**Not yet wired:** day/night grouping (a night sleep + post-midnight wakings
belonging to the day it started) is a concern of the _caller_ that assembles
today's `sleeps` and `morningWake` from the DB — implement it in the query layer
(step 2), not the engine. Night wakings within a night aren't fed to the engine
yet either; add if projection ever needs them (currently it doesn't).

### 2. Data access + JSON API ✅ DONE

Server-only query helpers in `src/lib/server/queries/` (never imported client-side)
and JSON endpoints under `src/routes/api/`:

- `queries/sleeps.ts` — sleep CRUD + night wakings, and `assembleDay(now, tz)`
  which applies the day/night grouping (`queries/day.ts`, pure + unit-tested) to
  produce the engine's `sleeps` + `morningWake`.
- `queries/templates.ts` — library CRUD + active-slot get/edit/load. Loading
  copies a library template into the slot (`sourceTemplateId` recorded); editing
  the slot never mutates the library (verified live).
- `queries/settings.ts` + `db/seed.ts` — seed-on-first-read of the `settings`
  row and a runnable example active template.
- `api/validate.ts` — request-body validation (no zod on host); `api/http.ts` —
  JSON-body reader.
- Endpoints: `GET/POST /api/sleeps`, `GET/PATCH/DELETE /api/sleeps/[id]`,
  `POST /api/sleeps/[id]/wakings`, `DELETE /api/wakings/[id]`,
  `GET/POST /api/templates`, `GET/PATCH/DELETE /api/templates/[id]`,
  `GET/PATCH/POST /api/active-template` (POST = load by `templateId`),
  `GET/PATCH /api/settings`.

**Not wired:** no `GET /api/day` (or projection) endpoint yet — `assembleDay` is
ready for the home page load to combine with `getActiveTemplate` + `getSettings`
and call `project()` in step 3. See `BACKLOG.md` for deferred robustness items.

### 3. Quick-log + "Right now" home ✅ DONE

Home (`src/routes/+page.svelte` + `+page.server.ts`) is live, SSR + progressive
enhancement (works without JS; re-projects server-side on every log):

- `load` assembles the projection (`getActiveTemplate` + `getSettings` +
  `assembleDay` → `project()`) and reads the current in-progress sleep via the new
  `getActiveSleep()` query (latest entry with no `end_time`, ignoring day/night
  grouping — so "woke up" ends whatever's in progress, incl. an overnight night).
- Shows current asleep/awake + live-ticking elapsed (seeded from server `now` to
  avoid a hydration mismatch, then ticks client-side), suggested next sleep with
  its wake window + "due now" flag, and display-only budget (daytime used/cap,
  naps done).
- Form actions: `asleep` (starts the next planned sleep — type from
  `nextSleep`), `awake` (ends the in-progress sleep), `adjust` (corrects a logged
  timestamp; converts an `HH:MM` input back to epoch via `resolveClockTime`).
  Double-log is guarded (409). Verified live end-to-end incl. the overnight case.

**Not done / deferred to Step 4** (see `BACKLOG.md`): editing the morning-wake
time from home, and capturing optional location/put-down/notes on a log.

### 4. Remaining v1 views ✅ DONE

Bottom-tab nav in `+layout.svelte` (Now / Today / History / Plan / Settings,
`resolve()`d links, active-tab highlight). All four views are SSR + progressive
enhancement. Shared, client-safe display helpers live in `src/lib/format.ts`;
`buildProjection` was extracted to `src/lib/server/queries/projection.ts` and is
now shared by the home + timeline loads.

- **Today's timeline** (`/timeline`) — proportional day view from the anchor to
  bedtime: completed/in-progress sleeps solid, projected dashed, a live "now"
  line and hour gridlines. Read-only (re-uses the same server projection).
- **History** (`/history`) — all entries most-recent-first, grouped by each
  entry's own local day (travel-safe). Inline edit (times via `datetime-local`
  resolved through the new `resolveLocalDateTime`, type/location/put-down/notes)
  and delete, both progressive-enhancement form actions; edit enforces
  end ≥ start. Night-waking counts shown read-only (logging UI deferred).
- **Template management** (`/templates`) — active-slot editor (arrays as
  comma-separated minutes, validated via `parseTemplate`); load a library
  template into the slot; save the active slot to the library as a new entry or
  overwrite an existing one; delete. Verified live that editing the active slot
  never mutates the library.
- **Settings** (`/settings`) — short-nap threshold + reduction %, 24h clock,
  timezone tracking, via `parseSettingsUpdate`.

Gates green (check/lint/test/build); driven end-to-end by `scripts/verify-step4.sh`
(18 checks) plus the existing `scripts/smoke.sh` for home regression. Deferred
robustness/UX items are in `BACKLOG.md`.

### 5. Offline + export/import

- **Export / import ✅ DONE (2026-07-10).** Full-dataset JSON backup + merge
  restore. Pure format + last-write-wins decision live in
  `src/lib/server/backup/dump.ts` (`parseBackup`, `lww`, unit-tested in
  `dump.spec.ts`); the DB read/write side is `src/lib/server/backup/index.ts`
  (`exportData`, `importData` — one transaction, timestamps written verbatim so
  re-import is a no-op). Endpoints: `GET /api/export` (attachment download of
  every table incl. the active slot) and `POST /api/import` (dedupe by UUID,
  LWW on `updated_at`; night wakings dedupe by id and skip orphans). Settings
  page has Export-download + Import-file-upload (progressive enhancement). Gates
  green (check/lint/test/build); driven e2e by `scripts/verify-backup.sh`
  (14 checks, two throwaway DBs). Non-critical follow-ups in `BACKLOG.md`.
- **Offline write-queue — STILL TODO.** Buffer writes in IndexedDB, replay on
  reconnect (the service worker currently only precaches the app shell). This is
  the remaining half of Step 5; it was scoped out of the export/import loop.

## Deferred (post-v1)

Trends/analytics charts · push notifications · multiple babies · non-sleep
tracking (feeds, diapers, growth). Real PNG PWA icons (currently SVG only).

## Reminders

- After any `schema.ts` change: `npm run db:generate` and commit the new
  `drizzle/` migration.
- Keep anything under `src/lib/server/` out of client bundles.
- `npm run check` is the primary gate; `npm run format` before finishing.
