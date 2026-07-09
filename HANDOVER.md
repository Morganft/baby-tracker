# Handover — next steps

Last updated: 2026-07-09 · Starting point: commit `a3083d9` (initial scaffold)
· Steps 1 (projection engine), 2 (data access + JSON API), 3 (quick-log +
"Right now" home), and 4 (remaining v1 views) complete.

Read `REQUIREMENTS.md` for the full spec and `CLAUDE.md` for the Docker-only
workflow (no host Node). This doc is just the ordered build plan from here.

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

- Offline write-queue: buffer writes in IndexedDB, replay on reconnect (the
  service worker currently only precaches the app shell).
- Export: one JSON dump (entries + templates + baby + settings).
- Import: **merge** — dedupe by UUID, last-write-wins via `updated_at`.

## Deferred (post-v1)

Trends/analytics charts · push notifications · multiple babies · non-sleep
tracking (feeds, diapers, growth). Real PNG PWA icons (currently SVG only).

## Reminders

- After any `schema.ts` change: `npm run db:generate` and commit the new
  `drizzle/` migration.
- Keep anything under `src/lib/server/` out of client bundles.
- `npm run check` is the primary gate; `npm run format` before finishing.
