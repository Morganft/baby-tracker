# Handover — next steps

Last updated: 2026-07-11

Read `REQUIREMENTS.md` for the full spec and `AGENTS.md` for the Docker-only
workflow (no host Node). This doc is just the remaining build plan.

## Status

The v1 build is complete except the offline write-queue below. Delivered and
verified (check/lint/test/build all green): the projection engine with
fixed-bedtime redistribution, the data-access layer + JSON API, the "Right now"
home + quick-log, the remaining v1 views (Today timeline, History, Plan,
Settings), always-on multi-timezone capture, and JSON export/import backup.

Non-critical follow-ups from those are parked in `BACKLOG.md`.

## Remaining: offline write-queue

The only unbuilt piece of REQUIREMENTS §3 "Offline": buffer writes
(POST/PATCH/DELETE) in IndexedDB and replay them on reconnect. Today the service
worker (`src/service-worker.ts`) only precaches the app shell.

- Queue mutations locally while offline; replay in order on reconnect.
- Reads and IDs are already client-generated UUIDs and the import path is
  last-write-wins, so replay collisions resolve without extra bookkeeping.
- Keep the queue/replay logic testable and isolated from the UI.

## Reminders

- After any `schema.ts` change: `npm run db:generate` and commit the new
  `drizzle/` migration.
- Keep anything under `src/lib/server/` out of client bundles.
- `npm run check` is the primary gate; `npm run format` before finishing.
