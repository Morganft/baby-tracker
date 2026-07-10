# Baby Sleep Tracker — Requirements

Status: **v1 scope agreed** · Last updated: 2026-07-09

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

| Concern               | Decision                                                                                  |
| --------------------- | ----------------------------------------------------------------------------------------- |
| **Platform**          | Progressive Web App (PWA) — installable, offline-capable. No app store.                   |
| **Framework**         | SvelteKit (UI + routing + JSON API in one TypeScript codebase).                           |
| **Database**          | SQLite via `better-sqlite3`. Single `.db` file = the whole dataset.                       |
| **Schema/migrations** | Drizzle (type-safe) — or raw SQL given the small schema.                                  |
| **Packaging**         | One Docker container + one volume (the `.db` file). `docker compose up`.                  |
| **Sync**              | Server is the single source of truth; phones read/write a small JSON API.                 |
| **Offline**           | Writes queued locally (IndexedDB) and replayed on reconnect (service worker).             |
| **IDs**               | Entries use **client-generated UUIDs** so offline devices and merges never collide.       |
| **Conflicts**         | Last-write-wins per entry.                                                                |
| **Timestamps**        | Stored **absolute (UTC)** with the **IANA timezone captured per entry** (travel support). |
| **Access & auth**     | LAN / VPN (e.g. Tailscale) only. Network is the security boundary — no login.             |

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
- `timezone` — IANA tz captured at entry time (for travel)
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
- `reference_wake_time` — target morning wake time; used as the day anchor
  **until the first actual wake-up is logged**
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
- `target_bedtime` — the wall-clock bedtime the day is anchored back to;
  **enforced** as the fixed end of the redistributed cascade (§5)
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
- Clock format (12/24h) and similar display prefs.

---

## 5. The projection engine (core behaviour)

The day is **relative**: a cascade of wake windows measured forward from the
most recent wake-up.

1. **Anchor.** Before the first actual wake-up, the day is anchored to the
   template's `reference_wake_time`. Once the real morning wake is logged, the
   day re-anchors to the **actual** time.
2. **Re-project on every log, anchored to a fixed target bedtime.** After each
   logged event (a wake-up, or a nap's actual end), the app re-projects **all
   remaining sleeps** so they still land on the template's **`target_bedtime`**.
   Rather than sliding every remaining sleep by a fixed delta (which would let
   total awake time drift), it **redistributes** the interval from the last
   actual wake to `target_bedtime` across the remaining wake windows and naps,
   steering each back toward its template value. `target_bedtime` does **not**
   move; it is the fixed end of the cascade.
3. **Redistribution is bounded and prioritised.** Each recalculated value is
   clamped to its per-position bound (`wake_window_min/max`,
   `nap_duration_min/max`). **Wake windows take priority over naps:** hold windows
   at their targets as far as their bounds allow and absorb surplus/deficit into
   **nap durations** first; flex windows only once naps are pinned at a bound.
4. **Nap-drop fallback.** If the remaining naps cannot fit within their bounds
   before `target_bedtime`, **drop a nap** and **merge it into the night sleep**
   (that unit's bedtime moves earlier). Cascade the drop if still infeasible.
5. **Next sleep suggestion** = last wake + current (redistributed) wake window.
6. **Short-nap rule.** If a nap's duration ≤ `short_nap_threshold` (15 min), the
   **next** wake window is reduced by `short_nap_reduction_percent` (configurable).
   The caregiver can also **manually override** any projected window's length
   (override applies to the current day). Overrides and the short-nap reduction
   feed into the redistribution above, still clamped to bounds.
7. **Enforced vs. display-only budgets.** `target_bedtime` and the per-position
   `wake_window_*` / `nap_duration_*` bounds are **enforced** — they shape the
   projection (§5.2–5.4). `daily_total_sleep_target` and `daytime_cap` remain
   **display-only** reference: shown as used-vs-target, never altering projection.
8. **Template selection.** The active-slot template is chosen manually from the
   library and persists across days. No age-based selection or switching.
9. **Day/night grouping.** A night sleep and any wakings after midnight belong to
   **the day the night sleep started** (a night stays one unit).

The **`target_bedtime` and per-position min/max bounds are enforced** (they drive
the projection). All other numeric limits — `daily_total_sleep_target` and
`daytime_cap` — remain **reference/guidance only**, never blocking.

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

### Alerts

- **On-screen only** — suggestions/warnings shown in the app; no push notifications.

### Export / import

- **Export**: download everything as one **JSON dump** (entries + templates +
  baby + settings).
- **Import**: **merge** into existing data — dedupe by UUID, last-write-wins on
  conflicting entries.

---

## 7. Open items to fill in during build

- Optional **example templates** to ship as starting points (user authors their
  own regardless).
- Exact **timeline UI** layout for planned-vs-actual.

## 8. Deferred (post-v1)

- Trends / analytics charts (totals per day, average wake windows over time).
- Push notifications.
- Multiple babies.
- Non-sleep tracking (feeds, diapers, growth).
