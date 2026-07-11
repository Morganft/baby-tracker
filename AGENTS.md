# AGENTS.md

This file provides guidance to coding agents when working with code in this repository.

## What this is

A self-hosted, phone-first **PWA for tracking a baby's sleep against a planned
schedule**. The differentiator is not recording sleep but a live **projection
engine**: an active schedule template of relative wake windows that re-anchors on
every logged event to forecast the rest of the day. `REQUIREMENTS.md` is the
source of truth for scope and behaviour — read it before implementing features.

## Development workflow

The **`delivery-workflow` skill** (`.claude/skills/delivery-workflow/`) is the
main development workflow for this repo — use it to deliver any task, plan, or
handover end-to-end. It runs a TDD loop: validate current state → analyse
requirements and write failing tests → implement to green → validate through the
Docker gates → review, looping until no critical issues remain. Write tests
alongside the acceptance criteria, before the implementation.

## Toolchain: there is no Node on the host — use Docker

The host has **no `node`/`npm`**, only Docker. Every JS command runs inside a
`node:22` container with the repo mounted. Use this wrapper (the `--user` mapping
keeps generated files owned by you, not root):

```bash
docker run --rm --user "$(id -u):$(id -g)" \
  -e HOME=/tmp -e npm_config_cache=/tmp/.npm -e DATABASE_URL=local.db \
  -v "$PWD":/app -w /app node:22 bash -lc '<command>'
```

Examples (`<command>`):

- `npm install` / `npm ci` — after changing `package.json`
- `npm run check` — svelte-check (typecheck). **This is the primary gate.**
- `npm run lint` — prettier check + eslint · `npm run format` — auto-fix
- `npm run build` — production build (adapter-node → `build/`)
- `npm run test` — vitest once · `npm run test:unit` — watch mode
  - single test: append `-- --run src/path/to/x.spec.ts -t "name"`
- `npm run db:generate` — generate a Drizzle migration after editing `schema.ts`
- `npm run db:push` — push schema straight to a dev DB (skips migration files)
- `npm run db:studio` — Drizzle Studio

Running the dev server or a booted build from a one-shot container needs a port
map (`-p 3000:3000`) and, for the dev server, `-- --host 0.0.0.0`.

**Wrap repeated commands in a script.** If you find yourself re-typing the same
Docker invocation (or any multi-step command) across a task, promote it to a
`package.json` script or a checked-in helper in `scripts/` instead of pasting it
again. When you add or change such a script, **update the references that name
it** — this file's command list above, and the skill docs that cite it
(`.claude/skills/delivery-workflow/references/gates.md` and `testing.md`) — so
the docs and the actual commands never drift.

The deploy artifact is the image itself: `docker build -t baby-tracker .` then
`docker compose up`. `better-sqlite3` is a native module — it is compiled in the
`node:22` build stage and the built `node_modules` is copied into the slim
runtime stage, so build and runtime must stay on the same Debian base.

## Architecture

- **One SvelteKit app, one language (TS).** UI, routing, and the JSON API all
  live in `src/routes`. `@sveltejs/adapter-node` produces a Node server; the
  whole thing ships as **one container + one volume** (the SQLite file).
- **Database — `src/lib/server/db/`.** `schema.ts` (Drizzle table defs) is the
  authority for the data model; `index.ts` opens `better-sqlite3`, sets
  `journal_mode=WAL` + `foreign_keys=ON`, and **runs migrations on boot**.
  Migrations in `drizzle/` are applied at server startup — `src/hooks.server.ts`
  imports the db module purely to trigger this before the first request. After
  any `schema.ts` change: run `db:generate` and commit the new file in `drizzle/`.
- **DB access is server-only.** Anything under `src/lib/server/` must never be
  imported into client code. Use it from `+page.server.ts` / `+server.ts`.
- **Data model conventions** (see `schema.ts`): row IDs are **client-generated
  UUIDs** so offline devices and the merge-import never collide; every table
  carries `created_at`/`updated_at` (epoch-ms) used for **last-write-wins** on
  import; sleep times are stored **absolute (epoch-ms) with a per-entry IANA
  zone captured at each end** (`timezone` for the start, `end_timezone` for the
  end) for travel/DST. Reference limits (`daily_total_sleep_target`,
  `daytime_cap`) are informational only — never enforce them in logic; the
  `target_bedtime` + per-position `wake_window_*`/`nap_duration_*` bounds **are**
  enforced by the projection.
- **Templates: library vs. active slot** (a non-obvious domain rule). The
  `template` table is the user's library. `active_template` is a **single
  persistent row** — a freely-editable _copy_ that drives the daily projection.
  Editing the active slot must **never** mutate a library `template`; saving to
  the library is an explicit, separate action. There is no age-based selection.
  The daily anchor is the global `day_start_time` setting (not a per-template
  field); a template's `reference_wake_time` is library metadata only.
- **Projection engine (core).** Relative wake windows cascade forward from the
  last actual wake; every new log re-anchors and re-projects all remaining
  sleeps. When a template sets `target_bedtime`, the projected tail is
  **redistributed** to land on that fixed bedtime (wake windows held to their
  targets first, surplus/deficit absorbed into naps, each clamped to its
  per-position bound; nap-drop → merge-into-night when infeasible) instead of
  sliding. Without `target_bedtime` it falls back to the legacy cascade. Short
  naps (≤ `short_nap_threshold`) shrink the next window by
  `short_nap_reduction_percent`. The logic is **pure and unit-tested**, separate
  from routes/DB (`src/lib/projection/`).
- **PWA/offline.** `static/manifest.webmanifest` + `src/service-worker.ts`
  (app-shell precache). The planned offline write-queue (IndexedDB, replay on
  reconnect) is not built yet.
- **No auth by design.** The app is LAN/VPN-only; the network is the security
  boundary. Do not add login flows unless the requirements change.

## Conventions

- Svelte 5 runes mode is forced (`$props`, `$state`, …) — see `vite.config.ts`.
- Tailwind v4 (config-less, `@import 'tailwindcss'` in `src/routes/layout.css`)
  with the forms plugin. UI is mobile-first, capped at `max-w-md`.
- Prettier + ESLint are wired; run `npm run format` before finishing a change.
