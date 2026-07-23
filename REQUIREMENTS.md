# Baby Sleep Tracker — Requirements

Status: **v1 scope agreed** · Last updated: 2026-07-11

A self-hosted, phone-first web app for tracking a baby's sleep **against a
planned schedule**. Unlike typical trackers that only _record_ sleep, this app
holds a **schedule template + sleep budget** (relative wake windows and
reference constraints) and continuously **re-projects the rest of the day** from
what has actually happened so far.

---

## 1. Goals

- Fast, one-handed, dark-room logging of sleeps.
- Hold a **plan** for the day and show a **live projection** of the remaining
  sleeps, re-anchored on every log.
- All data in a single small file that is trivial to back up, export, and import.
- Genuinely low-maintenance to self-host.

## 2. Non-goals (v1)

- Feeds, diapers, growth, or other non-sleep tracking. **Sleep only.**
- Accounts / auth / public multi-tenant SaaS.
- Native iOS/Android apps.
- Multiple babies (single baby in v1; data structured so it's addable later).
- Trends/analytics charts, push notifications (deferred — see §8).

---

## 3. Architecture (decided)

| Concern               | Decision                                                                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Platform**          | Progressive Web App (PWA) — installable, offline-capable. No app store.                                                                                            |
| **Framework**         | SvelteKit (UI + routing + JSON API in one TypeScript codebase).                                                                                                    |
| **Database**          | SQLite via `better-sqlite3`. Single `.db` file = the whole dataset.                                                                                                |
| **Schema/migrations** | Drizzle (type-safe) — or raw SQL given the small schema.                                                                                                           |
| **Packaging**         | One Docker container + one volume (the `.db` file). `docker compose up`.                                                                                           |
| **Sync**              | Server is the single source of truth; phones read/write a small JSON API.                                                                                          |
| **Offline**           | Writes queued locally (IndexedDB) and replayed on reconnect (service worker).                                                                                      |
| **IDs**               | Entries use **client-generated UUIDs** so offline devices and merges never collide.                                                                                |
| **Conflicts**         | Last-write-wins per entry.                                                                                                                                         |
| **Timestamps**        | Stored **absolute (UTC)** with the **IANA timezone captured at each end** of an entry (a sleep can start in one zone and end in another — travel/red-eye support). |
| **Access & auth**     | LAN / VPN (e.g. Tailscale) only. Network is the security boundary — no login.                                                                                      |

Both caregivers log from their own phones against the same shared data.

---

## 4. Data model

### Baby (single, v1)

- `birth_date` — **optional**; used only to display the baby's current age. Does
  not drive template selection.

### Sleep entry

- `id` — client-generated UUID
- `start_time` — absolute (UTC)
- `end_time` — absolute (UTC), nullable while sleep is in progress
- `start_timezone` — IANA tz captured when the sleep started (for travel)
- `end_timezone` — IANA tz captured when the sleep ended; null while in progress
  (a sleep can start in one zone and end in another)
- `type` — `nap` | `night`
- `location` — `crib` | `stroller` | `car` | `contact` | `other`
- `put_down` — `drowsy` | `already-asleep` | `self-settled`
- `night_wakings` — list of **wake times** (each waking timestamped); relevant for `night`
- `notes` — free text
- **Derived (not stored):** `duration`, `wake_window_before` (gap from previous
  sleep's end), `too_short` flag (duration ≤ short-nap threshold)

Entries are **shared/anonymous** — no per-caregiver attribution.

### Schedule template

A template defines a day's plan (no age association — chosen manually):

- `name`
- `reference_wake_time` — target morning wake time. The live projection **anchors
  on this field** before an actual morning wake is logged.
- `nap_count`
- `wake_windows[]` — ordered **relative** awake durations before each sleep
  (`WW1`, `WW2`, …, and the pre-bed window). Each can differ; they typically
  lengthen through the day. These are the **targets** redistribution steers back
  toward (§5).
- `wake_window_min[]`, `wake_window_max[]` — per-position bounds for each wake
  window (same length as `wake_windows`). **Enforced** during redistribution.
- `expected_nap_durations[]` — reference durations, used to project sleeps that
  haven't happened yet
- `nap_duration_min[]`, `nap_duration_max[]` — per-position bounds for each nap
  (same length as `expected_nap_durations`). **Enforced** during redistribution.
- **Target bedtime** — the wall-clock bedtime the day is steered back toward; a
  **soft** anchor for the redistributed cascade (§5). It is **not stored
  separately**: it is the plan's own cascaded bedtime — `reference_wake_time` plus
  every `wake_window` and `expected_nap_duration` — so shaping the plan moves the
  bedtime and the projection always follows it (never a stale independent value).
  Redistribution aims for it but never violates a wake-window/nap bound to hit it:
  when the remaining sleeps can't fit within bounds, bedtime floats past the target
  rather than a nap being dropped. (A per-day "adjust for today" overlay is the one
  exception — it keeps the legacy sliding cascade so hand-shaping the tail sticks.)
- `daily_total_sleep_target`, `daytime_cap` — **reference only**

#### Library + active slot

- **Library** — user-authored templates. The user creates, edits, and deletes
  them freely.
- **Active slot** — the single "current" template that drives the daily
  projection. Loading a library template **copies** it into the active slot.
- The active slot is a **persistent config**: it stays in effect every day until
  a different template is loaded, and it is **freely editable in place**.
- Editing the active slot **never** affects the library. To put the current
  active template into the library, the user **explicitly saves it** as a named
  library entry (a new entry, or overwriting an existing one).
- The app may ship a couple of example templates as optional starting points.

### Settings

- `short_nap_threshold` — default **15 min**
- `short_nap_reduction_percent` — **configurable**; how much to shorten the next
  wake window after a too-short nap
- Clock format (12/24h, default 24h) and similar display prefs.

---

## 5. The projection engine (core behaviour)

The day is **relative**: a cascade of wake windows measured forward from the
most recent wake-up.

1. **Anchor.** Before the first actual wake-up, the day is anchored to the active
   plan's `reference_wake_time`. Once the real morning wake is logged, the day
   re-anchors to the **actual** time.
2. **Re-project on every log, steering toward a soft target bedtime.** After each
   logged event (a wake-up, or a nap's actual end), the app re-projects **all
   remaining sleeps** so they steer toward the **plan's own bedtime** (the target
   bedtime — the plan cascade's end, `reference_wake_time` + the wake windows +
   nap durations). Rather than sliding every remaining sleep by a fixed delta
   (which would let total awake time drift), it **redistributes** the interval from
   the last actual wake to that bedtime across the remaining wake windows and naps,
   steering each back toward its template value. The target bedtime is a **soft**
   target, not a fixed wall (see §5.4).
3. **Redistribution is bounded and prioritised.** Each recalculated value is
   clamped to its per-position bound (`wake_window_min/max`,
   `nap_duration_min/max`). **Wake windows take priority over naps:** hold windows
   at their targets as far as their bounds allow and absorb surplus/deficit into
   **nap durations** first; flex windows only once naps are pinned at a bound.
4. **Bounds win over the target; bedtime floats.** Bounds are never violated to
   hit `target_bedtime`. When the remaining sleeps can't compress within their
   bounds to reach the target, they pin at their minima and the projected bedtime
   **floats later** than the target — no nap is dropped and no over-long merged
   pre-bed window is produced. (Symmetrically, when they can't expand to fill the
   interval even at their maxima, bedtime lands earlier than the target.) The
   day's nap count stays intact; dropping a nap is a caregiver decision, not the
   engine's.
5. **Next sleep suggestion** = last wake + current (redistributed) wake window.
6. **Short-nap rule.** If a nap's duration ≤ `short_nap_threshold` (15 min), the
   **next** wake window is reduced by `short_nap_reduction_percent` (configurable).
   The caregiver can also **manually override** any projected window's length
   (override applies to the current day). Overrides and the short-nap reduction
   feed into the redistribution above, still clamped to bounds.
7. **Enforced vs. display-only budgets.** The per-position `wake_window_*` /
   `nap_duration_*` bounds are **enforced** — projected values never leave them
   (§5.3). `target_bedtime` is an enforced _input_ to the redistribution but a
   **soft** target the projection may float past (§5.4). `daily_total_sleep_target`
   and `daytime_cap` remain **display-only** reference: shown as used-vs-target,
   never altering projection.
8. **Template selection.** The active-slot template is chosen manually from the
   library and persists across days. No age-based selection or switching.
9. **Day/night grouping.** A night sleep and any wakings after midnight belong to
   **the day the night sleep started** (a night stays one unit).

The **per-position min/max bounds are enforced** (projected values never leave
them), and **`target_bedtime` drives the projection as a soft target** (steered
toward, but floated past rather than breaking a bound). All other numeric limits —
`daily_total_sleep_target` and `daytime_cap` — remain **reference/guidance only**,
never blocking.

---

## 6. Functional requirements

### Logging

- **Quick-log "now"**: one tap for "fell asleep" / "woke up" using the current
  time; editable afterward.
- Log night wakings (timestamp each) during a night sleep.
- Edit/delete any entry; backfill entries for earlier today or past days.

### Views (v1)

- **"Right now" home** — current state (asleep/awake + how long), suggested next
  sleep, remaining budget, quick-log buttons.
- **Today's timeline** — today's sleeps on a 24h view, **planned vs. actual**.
- **History list** — scrollable chronological entries, editable.

### Forms

- **A save must never blank the form.** After a form is successfully submitted,
  every editable field must still show its current value (the just-saved value or
  the reloaded server value) — a save is not a "clear". Progressively-enhanced
  forms therefore must opt out of `use:enhance`'s default form reset
  (`update({ reset: false })`) whenever their fields are Svelte-bound `value={…}`
  inputs, since the browser's `form.reset()` blanks those.
- **Each such form carries a test** asserting its fields retain their values across
  a submit (see the `*.svelte.spec.ts` colocated with the settings and templates
  pages), so this regression is caught in CI rather than by hand.

### Alerts

- **On-screen only** — suggestions/warnings shown in the app; no push notifications.

### Export / import

- **Export**: download everything as one **JSON dump** (entries + templates +
  baby + settings).
- **Import**: **merge** into existing data — dedupe by UUID, last-write-wins on
  conflicting entries.

---

## 7. Open items to fill in during build

- _(none currently open)_

## 8. Deferred (post-v1)

- Trends / analytics charts (totals per day, average wake windows over time).
- Push notifications.
- Multiple babies.
- Non-sleep tracking (feeds, diapers, growth).
