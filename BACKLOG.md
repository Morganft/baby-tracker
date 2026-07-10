# Backlog

Non-critical items deferred from delivery. Each: `- [<area>] <what> — <why it can wait>`.

## 2026-07-10 — Fixed-bedtime redistribution (projection engine)

- [wiring] ✅ DONE (2026-07-10). The redistribution is now reachable at runtime: `schema.ts` + Drizzle migration `0001_flat_hydra.sql` carry `target_bedtime` + the four bound columns, `parseTemplate` validates them (length + `min ≤ max` + non-negative), `queries/templates.ts` round-trips them, `buildProjection` threads them into `project()`, the seed example ships a 19:00 target + bounds, and the `/templates` editor sets all five. Verified live: seeded active template projects bedtime at 19:00 (redistributed); clearing `target_bedtime` reverts to the 19:45 legacy cascade.
- [upgrade] The seed only applies to a **fresh** `active_template` row. An install that was seeded before this change keeps its old row (no `target_bedtime`) and so stays on the legacy cascade until the user sets a target bedtime in `/templates`. By design (don't silently change a running schedule); mention in release notes if this ships to existing users.
- [engine] The redistribute prefix re-implements the legacy branch's logged-nap handling (~30 lines, `project.ts`). Kept separate deliberately so the legacy path stays byte-identical; fold into a shared helper once both paths are stable.
- [engine] Each redistributed window/nap is rounded independently, so the projected night can land 1–2 min off the exact target bedtime. Spec only requires "≈"; tighten (distribute the rounding remainder into the final window) if the drift ever shows in the UI.
- [engine] When only _some_ positions provide a max bound, `distribute` dumps all surplus into the unbounded item(s) and ignores finite-headroom peers — lopsided but harmless. A non-issue once the UI always supplies full bound arrays.

## 2026-07-09 — Step 2 (data access + JSON API)

- [api] `PATCH /api/sleeps/[id]` doesn't enforce `endTime ≥ startTime` the way create does — an edit could produce a negative-duration entry (engine would misread it as a too-short nap). Not on the happy path; the Step-3 edit UI will constrain times. Fix needs the stored row for the cross-field check.
- [api] `parseTemplate` accepts negative / non-integer `wakeWindows` and `expectedNapDurations`, and `parseSleepCreate` accepts any epoch — informational-only per REQUIREMENTS, but negative windows yield nonsensical projections. Add sanity floors when the template-editor UI lands (Step 4).
- [perf] `assembleDay` full-scans `sleep_entry` on every call — fine at current scale; add a start-time range filter (today ± 1 day) once history grows.
- [style] `toActiveDTO` casts the active-template row through `as unknown as TemplateRow`; harmless but a shared column type would be cleaner.

## 2026-07-09 — Step 4 (remaining v1 views)

- [api] History `edit` resolves `startLocal`/`endLocal` via `resolveLocalDateTime` **before** the try/catch, so a malformed hand-crafted body (e.g. a value without the `T`) throws → HTTP 500 instead of a 400. Off the happy path (`<input type=datetime-local>` always emits well-formed values) and the app is LAN/no-auth; harden by making the resolver return `NaN` on bad input (routes to the existing 400) or guarding the field.
- [perf] `/timeline` and `/history` loads read the active template + settings both directly and again inside `buildProjection` — the same idempotent double-read already noted for the home load. Collapse if a load gets hot.
- [ux] Template array fields (`wakeWindows`, `expectedNapDurations`) are edited as comma-separated text. Works without JS, but a per-nap number-input editor that resizes when `napCount` changes would be friendlier. Needs client enhancement.
- [edge] `format.ts` normalises an Intl hour of `24`→`00` without adjusting the date; on a platform that pairs `24:00` with the previous day's date, `toDateTimeInput` could shift a datetime-local by a day at exactly local midnight. Not observed on Node 22 (emits `00`).
- [ux] Night-waking logging still has no UI (History shows waking counts read-only). `SleepDTO` exposes waking timestamps but not their ids, so per-waking edit/delete needs the DTO/API to also surface `nightWaking.id`.

## 2026-07-09 — Step 3 (quick-log + "Right now" home)

- [ux] The home "Adjust time" control can't edit the **morning wake** time. That timestamp is the `end` of yesterday's still-relevant night sleep, which `groupDay` deliberately keeps out of today's `projection.sleeps`, so the home has no entry id to patch. Right after waking, `since` is shown but not editable. Full edit lands with the History view (Step 4); until then correct it there.
- [perf] `+page.server.ts` `load` reads the active template and settings twice (once directly for `templateName`/`clock24h`, once inside `buildProjection`) — two extra idempotent SQLite reads per render. Collapse into one pass if load ever gets hot.
- [ux] "Fell asleep" always logs `location`/`putDown`/`notes` as null (quick-log by design). The optional-detail capture is deferred to the entry-edit UI (Step 4).
