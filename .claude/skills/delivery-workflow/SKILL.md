---
name: delivery-workflow
description: End-to-end delivery loop for a coding task, plan, or handover in this repo — validate input and current state, analyse requirements against REQUIREMENTS.md, implement, validate results through the Docker gates, and review, looping implement→validate→review until no critical (security, design, or logic) issues remain, then parking non-critical issues in BACKLOG.md. Use whenever asked to implement a feature or task, execute a plan, or continue from a HANDOVER.md — i.e. any time a change should be delivered end-to-end rather than merely written.
license: Proprietary
compatibility: Requires Docker — the host has no Node; all gate commands run in a node:22 container per AGENTS.md. Built for Claude Code in this SvelteKit + SQLite PWA repo.
metadata:
  author: nikita
  version: '1.0'
---

# Delivery workflow

Deliver a unit of work — a task, a plan, or a handover doc — through validation,
implementation, and review, looping until no critical issues remain.

**The work to deliver** is this skill's input: a task description, a path to a
plan, or a handover file such as `HANDOVER.md`. If no input was given, ask the
user what to deliver and stop.

`REQUIREMENTS.md` is the source of truth for scope and behaviour. `AGENTS.md` is
the source of truth for how to build and gate. Read both if you have not already
this session. The exact gate commands (all Docker-wrapped) live in
[references/gates.md](references/gates.md) — never assume host Node exists.

Work the phases in order. Do not skip a phase because the task "looks small" — a
one-line change still gets validated and reviewed. Open each phase with a short
status line, e.g. `**Phase 3 — Implementation (iteration 2)**`.

## Phase 1 — Input & current-state validation

Establish ground truth _before_ trusting the request.

- Identify what the input is (fresh task, plan, or handover). If it names a file,
  read it fully.
- Reconcile the request against reality — **do not trust a handover/plan blindly**:
  - `git status` and recent log: is the tree clean? Does it match where the doc
    says things stand?
  - Do the files, functions, tables, and endpoints it references actually exist?
    Spot-check them.
  - Run the gates once for a **baseline** (`check`, then `lint`/`test`/`build` as
    relevant). If the baseline is already red, surface it now — you must not later
    blame your own change for a pre-existing failure.
- If the request contradicts the repo (already-done work, moved code, wrong
  assumptions), **stop and report the drift** before implementing.

## Phase 2 — Requirements analysis

Turn the request into a concrete, checkable spec.

- Cross-check scope against `REQUIREMENTS.md` and the domain rules in `AGENTS.md`:
  templates library-vs-active-slot, client-generated UUIDs, absolute epoch-ms +
  per-entry IANA timezone, last-write-wins on import, reference limits are
  informational only, projection engine stays pure, `src/lib/server/` is never
  imported client-side, no auth by design.
- Write **acceptance criteria**: the specific observable conditions that mean
  "done" (behaviour + which gates must be green + which requirement clauses are
  satisfied). Phase 4 checks against these.
- **Follow TDD.** Alongside each acceptance criterion, write the failing test(s)
  that encode it *before* implementing. Run them to confirm they fail for the
  right reason (red) so you know they actually exercise the new behaviour. These
  tests are the executable form of the acceptance criteria. Follow the repo's
  testing conventions — runner, scripts, fixtures, and what is (and isn't)
  testable — in [references/testing.md](references/testing.md).
- If a genuine product decision is required (not a default you can reasonably
  pick), ask the user now — cheaper than after coding.

## Phase 3 — Implementation

- Implement to make the Phase 2 tests pass (red → green), matching surrounding
  code and the Svelte 5 runes / Tailwind v4 conventions. Write the minimum code
  that turns the failing tests green, then refactor with the tests as a safety
  net.
- If you touch `schema.ts`, run `db:generate` and commit the new `drizzle/`
  migration — never hand-edit migrations.
- Keep the projection engine pure and unit-tested, separate from routes/DB.
- Prefer the smallest change that satisfies the criteria; leave unrelated cleanups
  for the backlog rather than folding them in.

## Phase 4 — Results validation

Prove the change does what Phase 2 said it should.

- Run the gates (see [references/gates.md](references/gates.md)): `check` is the
  **primary gate**; also `lint`, `test`, and `build` when the build surface
  changed. Run `format` before finishing.
- Add or update unit tests for new logic (the projection engine especially),
  following [references/testing.md](references/testing.md).
- **Exercise the actual behaviour**, not just green gates — drive the changed flow
  (endpoint, page, or engine function with realistic input) and compare against
  the acceptance criteria. Use the `verify` skill when a runtime surface changed.
- Record every failure or gap as a candidate finding for Phase 5.

## Phase 5 — Review

Review `git diff` for defects. For a substantial change, use the `code-review`
skill (or spawn a reviewer subagent) rather than eyeballing. Classify **every**
finding:

- **CRITICAL — fix inside the loop.** Any of:
  - a failing gate (check / lint / test / build);
  - a security issue (e.g. `src/lib/server/` leaking into a client bundle, secret
    exposure — the network is the only security boundary);
  - a correctness / logic bug or an unmet acceptance criterion / requirement;
  - a **design** problem that would harm future use or development (wrong
    layering, engine impurity, mutating a library template from the active slot, a
    data-model violation, an API shape that will need to be broken later).
- **NON-CRITICAL — defer.** Style nits, optional refactors, nice-to-haves, post-v1
  ideas — anything not threatening correctness, security, or design.

## The loop

Repeat **Phase 3 → 4 → 5** until Phase 5 yields **zero critical issues**.

- Each pass is one iteration; announce its number.
- After finishing **iteration 5** with critical issues still open, **stop and ask
  the user** whether to keep looping, summarising what remains critical and why
  it's stubborn. Never silently continue past 5.
- If you are clearly making no progress before 5 (same issue twice, or blocked on
  a decision), stop early and ask rather than spinning.

## Finishing

When the loop exits with no critical issues:

1. **Defer the non-criticals.** Append each open non-critical issue to `BACKLOG.md`
   at the repo root (create it if missing) under a dated heading, one line each:
   `- [<area>] <what> — <why it can wait>`. Keep it terse.
2. **Report**: what was delivered, the final gate results stated plainly (if
   anything is still red or was skipped, say so), acceptance criteria met, and a
   pointer to what was parked in `BACKLOG.md`.
3. Do **not** commit or push unless asked. If asked, branch first when on
   `master`/`main` and follow the repo's commit conventions.
4. Update `HANDOVER.md` only if the user asks or the work completed a numbered
   step in its plan.
