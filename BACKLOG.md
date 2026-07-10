# Backlog

Non-critical items deferred from delivery. Each: `- [<area>] <what> — <why it can wait>`.

## 2026-07-10 — Step 5 (export / import)

- [import] Night wakings carry no `updatedAt`, so import dedupes them by id only — a waking whose `time` changed at the source won't overwrite the stored copy on re-import. Fine today (there's no waking-edit UI, so a waking's time never changes); revisit if per-waking editing lands.
- [import] `parseBackup` validates the settings numeric fields (`shortNapThresholdMin`, `shortNapReductionPercent`) as finite numbers rather than integers, so a hand-crafted float would import. Harmless — our own export always emits integers and these limits are informational — tighten to an integer check if hand-edited dumps become common.
- [import] The whole dump is read into memory and merged in one transaction — no size cap or streaming. Fine at personal/LAN scale; add a request-size limit if dumps ever get large.
- [import] Last-write-wins on the singletons (`active_template` id `active`, `settings`) means a freshly-seeded install — whose default rows get an `updatedAt` bumped to first-read time — can shadow an *older*, hand-edited active slot/settings coming from the dump. Correct per the last-write-wins rule, but a restore onto a brand-new install may keep the seeded defaults instead of the backup's schedule. Special-case the singletons (always take the imported copy) or document in release notes if it surprises users.
- [offline] Deferred from this loop: the offline write-queue (buffer POST/PATCH/DELETE in IndexedDB, replay on reconnect) is still unbuilt — the service worker only precaches the app shell. Export/import shipped; the queue is the remaining half of REQUIREMENTS §3 "Offline".

## 2026-07-10 — Reported bugs (time format, timezone display)

- [ux] 24-hour time doesn't work — the `clock24h` setting isn't applied (times still render 12-hour, or the toggle has no effect). Audit where `clock24h` is read vs. where times are formatted (`format.ts`) and ensure the flag threads through every time-rendering path.
- [ux] Timezone isn't shown properly — per-entry IANA `timezone` (stored on each sleep) isn't surfaced/rendered correctly in the UI. Confirm the DTO carries it and the views display the right zone, especially for travel/DST entries.

## 2026-07-10 — UI fixes (wake windows, day-start, awake budget, Add)

- [budget] The home "Awake today" tile computes awake = elapsed-since-anchor − daytime sleep, which does **not** subtract a logged night sleep. Accurate through the active day; once tonight's bedtime is logged the figure keeps climbing (counts night-sleep as awake). Subtract in-progress/completed night-sleep elapsed if it ever shows oddly after bedtime.
- [templates] The live projection now anchors on the global `dayStartTime` setting (via `buildProjection`), so the template editor's per-template `referenceWakeTime` no longer affects the active slot — it's library metadata only now. Relabel/hide it in `/templates`, or consolidate the two, to avoid confusing "why doesn't changing the template wake time move my day" reports.
- [add] Manual add (`/add`) captures the server timezone like the quick-log, with no per-entry tz picker. Consistent with the rest of the app; add a picker only if hand-entering travel days becomes a need.

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
