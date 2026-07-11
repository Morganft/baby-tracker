# Testing strategy & scripts

How this repo tests. Read this before writing tests in Phase 2 (TDD) or running
them in Phase 4. All commands are Docker-wrapped — see [gates.md](gates.md) for
the wrapper.

## Runner & config

- **Vitest 4**, configured inside `vite.config.ts` under `test.projects` (not a
  separate `vitest.config`).
- One project, `name: 'server'`, `environment: 'node'`.
  - Includes: `src/**/*.{test,spec}.{js,ts}`
  - Excludes: `src/**/*.svelte.{test,spec}.{js,ts}`
- `expect: { requireAssertions: true }` — **every test must make an assertion**;
  a test with no `expect` fails. Don't write placeholder/smoke tests.
- **No component/browser test project exists yet** (Svelte component tests are
  excluded, there is no jsdom/browser project). Test logic, not markup — extract
  behaviour into pure functions and test those.

## Scripts

| Command                                          | What it does                             |
| ------------------------------------------------ | ---------------------------------------- |
| `npm run test`                                   | vitest once (CI mode) — the gate         |
| `npm run test:unit`                              | vitest in watch mode (local iteration)   |
| `npm run test -- --run <file>`                   | run a single spec file                   |
| `npm run test -- --run <file> -t "<name>"`       | run one test/describe by name            |

Each runs inside the `node:22` container via the [gates.md](gates.md) wrapper.

## Conventions (match these)

- **Colocate** specs next to source: `foo.ts` → `foo.spec.ts` in the same dir.
- **`import { describe, it, expect } from 'vitest'`**, group with `describe`,
  one behaviour per `it` with a plain-English name.
- **Time is absolute epoch-ms + IANA zone** (the data model). Build fixtures with
  explicit `Date.UTC(...)` helpers and run assertions in a fixed zone (`'UTC'`
  unless the test is specifically about zone handling). Never use `Date.now()` or
  the ambient local zone in a test — see `project.spec.ts`'s `at()` and
  `day.spec.ts`'s `U()` helpers.
- **No DB in tests.** Server-side specs test *pure* helpers, not `better-sqlite3`.
  Keep DB access thin in `+server.ts`/queries and push testable logic into pure
  functions (as `queries/day.ts`, `api/validate.ts`, `backup/dump.ts` do).
- Use small typed fixture builders with an `overrides` param instead of repeating
  full objects (see `build()` / `templateRow` in the existing specs).

## Where the existing tests live (patterns to copy)

- `src/lib/projection/project.spec.ts` — **projection engine**; the richest
  suite. Fixed-clock epoch fixtures, cascade/redistribution/nap-drop cases.
- `src/lib/projection/time.spec.ts` — time/zone helpers.
- `src/lib/server/api/validate.spec.ts` — request parsing & zone resolution.
- `src/lib/server/backup/dump.spec.ts` — backup parse + last-write-wins merge.
- `src/lib/server/queries/day.spec.ts` — day grouping / local-date-key logic.

New projection or domain logic belongs in a pure module under `src/lib/` with a
colocated `.spec.ts` alongside it.
