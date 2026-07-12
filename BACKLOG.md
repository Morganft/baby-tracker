# Backlog

Non-critical items deferred from delivery. Each: `- [<area>] <what> — <why it can wait>`.

## 2026-07-12 — Projection (soft-bedtime follow-ups)

- [projection] With the soft target bedtime, a badly-configured template (or a very late day) lets the projected bedtime float arbitrarily late without ever suggesting the caregiver drop a nap. Consider an opt-in "absurdly-late bedtime" threshold that surfaces a _suggestion_ to drop the last nap (caregiver-confirmed, not automatic) — kept out of the engine for now since auto-dropping is what produced the over-long merged pre-bed window we just removed.
- [projection] `redistributeTail` is now a thin wrapper around `solveFit` (the drop/merge loop is gone). Could be inlined at its single call site; kept as a named function for the doc comment + `windows` passthrough. Trivial cleanup only.

## 2026-07-11 — Timezone (open follow-ups)

- [perf] `listEntryZones()` full-scans `sleep_entry` on every Home/Timeline load (on top of `assembleDay`'s scan). Fine at personal scale; add a today-range filter if a load gets hot.
- [tz] The Home "Awake since" chip only appears when the last wake is a completed sleep with an `entryId`. Right after the morning wake (since = last night's end, which has no `entryId` in the projection) no zone chip shows even if that night was logged in another zone. Minor; History still shows it. Thread the anchor entry's zone if it ever matters.
- [tz] A raw `PATCH /api/sleeps/[id]` that sets `endTime` without `endTimezone` leaves the end zone unset (renders in the start zone). The app's own flows always pair them; harden the API (default `endTimezone` to the start zone when `endTime` is set) if external clients appear.
- [tz] Manual add (`/add`) still captures one zone for both ends (typed against a single clock). A back-filled travel sleep that spanned zones must be split-zone-corrected in History afterwards; add per-end zone pickers to `/add` only if back-filling travel days becomes common.
- [tz] ~~The History edit "Enter times in" chooser is per-form (Original ↔ This device)... Add per-end pickers to the edit form...~~ **Done (2026-07-12).** The edit form now shows an independent Original↔This-device picker under each of Start and End (each shown only when that end differs from the device zone), so one end can be re-entered in the current zone without recalculating the other. The `/add` per-end need (line above) is still open.
- [import] Night wakings carry no `updatedAt`, so import dedupes them by id only — a waking whose `time` changed at the source won't overwrite the stored copy on re-import. Fine today (there's no waking-edit UI, so a waking's time never changes); revisit if per-waking editing lands.
- [import] `parseBackup` validates the settings numeric fields (`shortNapThresholdMin`, `shortNapReductionPercent`) as finite numbers rather than integers, so a hand-crafted float would import. Harmless — our own export always emits integers and these limits are informational — tighten to an integer check if hand-edited dumps become common.
- [import] The whole dump is read into memory and merged in one transaction — no size cap or streaming. Fine at personal/LAN scale; add a request-size limit if dumps ever get large.
- [import] Last-write-wins on the singletons (`active_template` id `active`, `settings`) means a freshly-seeded install — whose default rows get an `updatedAt` bumped to first-read time — can shadow an _older_, hand-edited active slot/settings coming from the dump. Correct per the last-write-wins rule, but a restore onto a brand-new install may keep the seeded defaults instead of the backup's schedule. Special-case the singletons (always take the imported copy) or document in release notes if it surprises users.
- [offline] The offline write-queue (buffer POST/PATCH/DELETE in IndexedDB, replay on reconnect) is still unbuilt — the service worker only precaches the app shell. This is the remaining half of REQUIREMENTS §3 "Offline" (tracked as the next step in `HANDOVER.md`).
- [ux] Auto-select the 12/24-hour clock format from the device locale on first run instead of defaulting everyone to 24h. `Intl.DateTimeFormat().resolvedOptions().hourCycle` (or the resolved `hour12`) already reports the regional convention — thread it into the settings seed / first-visit path so a US-locale phone comes up on AM/PM without touching the toggle. A user's explicit toggle stays authoritative once set. Deferred: 24h is a sane universal default and the manual toggle already works, so this is a convenience, not a blocker.

## 2026-07-10 — Reported bugs

- [ux] ~~24-hour time doesn't work — the `clock24h` setting isn't applied.~~ **Resolved / not reproducible (verified 2026-07-11).** `clock24h` threads through every render path (`format.ts` `fmtTime`, the home page's inline copy, timeline, history); 24h is already the migration/seed default (`clock_24h DEFAULT true`). Confirmed end-to-end by rendering home/timeline/history against a live DB: default renders 24h with no AM/PM, and toggling the setting flips displayed times to AM/PM. The one 24h `HH:MM` that persists in 12h mode is the `<input type="time">` value attribute, which the HTML spec requires to be 24h regardless of display.

## 2026-07-10 — Timezone display (follow-ups)

- [ux] Residual: the very first visit renders once in the server zone, then `invalidateAll()` re-runs the loads in the phone zone (a one-time flash before the cookie exists). Inherent to a cookie-on-mount approach; imperceptible on non-traveling installs (browser zone == server zone → no re-render). Eliminable only by a blocking pre-hydration zone probe, not worth it.

## 2026-07-10 — UI fixes (wake windows, day-start, awake budget, Add)

- [budget] The home "Awake today" tile computes awake = elapsed-since-anchor − daytime sleep, which does **not** subtract a logged night sleep. Accurate through the active day; once tonight's bedtime is logged the figure keeps climbing (counts night-sleep as awake). Subtract in-progress/completed night-sleep elapsed if it ever shows oddly after bedtime.
- [templates] The live projection anchors on the global `dayStartTime` setting (via `buildProjection`), so the template editor's per-template `referenceWakeTime` no longer affects the active slot — it's library metadata only now. Relabel/hide it in `/templates`, or consolidate the two, to avoid confusing "why doesn't changing the template wake time move my day" reports.
- [add] Manual add (`/add`) captures the phone's current zone like the quick-log, with no per-entry tz **picker** — you can't hand-enter a sleep as having happened in a _different_ zone than the phone is in right now. Add a picker only if back-filling travel days from home becomes a need.

## 2026-07-10 — Fixed-bedtime redistribution (projection engine)

- [upgrade] The seed only applies to a **fresh** `active_template` row. An install that was seeded before this change keeps its old row (no `target_bedtime`) and so stays on the legacy cascade until the user sets a target bedtime in `/templates`. By design (don't silently change a running schedule); mention in release notes if this ships to existing users.
- [engine] The redistribute prefix re-implements the legacy branch's logged-nap handling (~30 lines, `project.ts`). Kept separate deliberately so the legacy path stays byte-identical; fold into a shared helper once both paths are stable.
- [engine] Each redistributed window/nap is rounded independently, so the projected night can land 1–2 min off the exact target bedtime. Spec only requires "≈"; tighten (distribute the rounding remainder into the final window) if the drift ever shows in the UI.
- [engine] When only _some_ positions provide a max bound, `distribute` dumps all surplus into the unbounded item(s) and ignores finite-headroom peers — lopsided but harmless. A non-issue once the UI always supplies full bound arrays.

## 2026-07-09 — Step 2 (data access + JSON API)

- [api] `PATCH /api/sleeps/[id]` doesn't enforce `endTime ≥ startTime` the way create does — an edit could produce a negative-duration entry (engine would misread it as a too-short nap). The History edit UI constrains times, but the raw API doesn't. Fix needs the stored row for the cross-field check.
- [api] `parseTemplate` accepts negative / non-integer `wakeWindows` and `expectedNapDurations`, and `parseSleepCreate` accepts any epoch — informational-only per REQUIREMENTS, but negative windows yield nonsensical projections. Add sanity floors.
- [perf] `assembleDay` full-scans `sleep_entry` on every call — fine at current scale; add a start-time range filter (today ± 1 day) once history grows.
- [style] `toActiveDTO` casts the active-template row through `as unknown as TemplateRow`; harmless but a shared column type would be cleaner.

## 2026-07-09 — Step 4 (remaining v1 views)

- [api] History `edit` resolves `startLocal`/`endLocal` via `resolveLocalDateTime` **before** the try/catch, so a malformed hand-crafted body (e.g. a value without the `T`) throws → HTTP 500 instead of a 400. Off the happy path (`<input type=datetime-local>` always emits well-formed values) and the app is LAN/no-auth; harden by making the resolver return `NaN` on bad input (routes to the existing 400) or guarding the field.
- [perf] `/timeline` and `/history` loads read the active template + settings both directly and again inside `buildProjection` — the same idempotent double-read as the home load. Collapse if a load gets hot.
- [ux] Template array fields (`wakeWindows`, `expectedNapDurations`) are edited as comma-separated text. Works without JS, but a per-nap number-input editor that resizes when `napCount` changes would be friendlier. Needs client enhancement.
- [edge] `format.ts` normalises an Intl hour of `24`→`00` without adjusting the date; on a platform that pairs `24:00` with the previous day's date, `toDateTimeInput` could shift a datetime-local by a day at exactly local midnight. Not observed on Node 22 (emits `00`).
- [ux] Night-waking logging still has no UI (History shows waking counts read-only). `SleepDTO` exposes waking timestamps but not their ids, so per-waking edit/delete needs the DTO/API to also surface `nightWaking.id`.

## 2026-07-09 — Step 3 (quick-log + "Right now" home)

- [ux] The home "Adjust time" control can't edit the **morning wake** time. That timestamp is the `end` of yesterday's still-relevant night sleep, which `groupDay` deliberately keeps out of today's `projection.sleeps`, so the home has no entry id to patch. Correct it in the History view.
- [perf] `+page.server.ts` `load` reads the active template and settings twice (once directly for `templateName`/`clock24h`, once inside `buildProjection`) — two extra idempotent SQLite reads per render. Collapse into one pass if load ever gets hot.
- [ux] "Fell asleep" always logs `location`/`putDown`/`notes` as null (quick-log by design). The optional-detail capture lives in the entry-edit UI.

## 2026-07-12 — Today-timeline nap popup

- [ux] The timeline nap popup shows the page-level `form.message` error, so a validation failure from one nap can persist as a stale banner when a different nap is next opened (until the next submit). Clear the error on open (needs the error moved into popup-local state, as `form` is a read-only prop).
- [a11y] The nap popup has no Escape-to-close or focus trap (matches the existing templates editor modal). Extract a shared modal with focus management.
- [edge] Editing a logged nap on a travel day prefills each end in the entry's own captured zone, so the popup's time can differ from the display-zone label shown on the block (the timeline axis is one zone). The cross-zone "Original / This device" picker only lives in History; add it to the popup if travel-day timeline edits become common.
- [perf] The timeline `load` now also calls `assembleDay` directly (for `overnightEntryId`) on top of the `assembleDay` inside `buildProjection` — a second full `sleep_entry` scan. Merges with the existing Home/Timeline double-read note; collapse by having `buildProjection` return the grouping if a load gets hot.
- [ux] When last night's sleep is still in progress (an overnight not yet ended), the overnight block still renders "planned" (dashed) even though tapping it now edits that in-progress entry (rather than logging a duplicate). Correct behaviour, but the dashed styling reads as "no data"; show the in-progress overnight as actual once surfaced.
