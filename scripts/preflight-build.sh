#!/usr/bin/env bash
# Pre-deploy build gate: reproduce the Dockerfile's build stage exactly.
#
# WHY THIS EXISTS
# The production image builds `npm run build` with NO `DATABASE_URL` — that env
# var is only set in the runtime stage (see Dockerfile). SvelteKit's postbuild
# `analyse` step imports every server module, so any server module that connects
# to the DB or reads a required env var *at import time* will crash the build —
# even though `npm run test`/`build` in the dev gate pass (the gate wrapper sets
# `DATABASE_URL=local.db`, masking the bug). This regressed once already:
# `src/lib/server/db/index.ts` used to open the DB at module top level.
#
# This script builds `--target build` (the compile stage) with a clean env, so a
# reintroduced import-time side effect fails HERE, before you ship.
#
# Usage:
#   scripts/preflight-build.sh            # build the Dockerfile build stage
#   scripts/preflight-build.sh --no-cache # ignore layer cache (full rebuild)
#
# Requires Docker only (the host has no node/npm — see AGENTS.md). Exits non-zero
# if the build fails.
set -euo pipefail

cd "$(dirname "$0")/.."

TAG="baby-tracker-preflight:build"
EXTRA=()
for a in "$@"; do
	case "$a" in
	--no-cache) EXTRA+=(--no-cache) ;;
	*)
		echo "unknown arg: $a" >&2
		exit 2
		;;
	esac
done

echo "▸ building Dockerfile 'build' stage with NO DATABASE_URL (deploy conditions)…"
if docker build "${EXTRA[@]}" --target build -t "$TAG" . ; then
	echo
	printf '▸ \033[1;32mpreflight OK\033[0m — production build compiles without DATABASE_URL\n'
else
	status=$?
	echo
	printf '▸ \033[1;31mpreflight FAILED\033[0m — the production build breaks under deploy conditions.\n' >&2
	printf '  Most likely a server module connects to the DB or reads a required env var at\n' >&2
	printf '  IMPORT time. Make it lazy (connect on first use), like src/lib/server/db/index.ts.\n' >&2
	exit "$status"
fi
