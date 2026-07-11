#!/usr/bin/env bash
# Run a command inside the node:22 container with the repo mounted (the host has
# no Node — see AGENTS.md). The --user mapping keeps generated files owned by you.
#
# Usage:
#   scripts/dev.sh 'npm run check'
#   scripts/dev.sh 'npm run lint'
#   scripts/dev.sh 'npm install'
set -euo pipefail

if [ "$#" -eq 0 ]; then
	echo "usage: scripts/dev.sh '<command>'" >&2
	exit 2
fi

exec docker run --rm --user "$(id -u):$(id -g)" \
	-e HOME=/tmp -e npm_config_cache=/tmp/.npm -e DATABASE_URL=local.db \
	-v "$PWD":/app -w /app node:22 bash -lc "$*"
