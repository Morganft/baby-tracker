#!/usr/bin/env bash
# One-off verification for Step 5 export/import (JSON backup + merge restore).
# Boots the built adapter-node server against THROWAWAY DBs, drives the export
# download + import merge with curl, asserts observable results, tears down.
# Mirrors the boot pattern of scripts/verify-step4.sh. Host has no node/jq, so
# assertions are plain grep over the (single-line) JSON responses.
set -euo pipefail

PORT1="${PORT1:-3120}"
PORT2="${PORT2:-3121}"
N1="baby-tracker-verify5a"
N2="baby-tracker-verify5b"
O1="http://localhost:${PORT1}"
O2="http://localhost:${PORT2}"
DUMP="$(mktemp)"
IMAGE="node:22"
DOCKER_COMMON=(--rm --user "$(id -u):$(id -g)"
	-e HOME=/tmp -e npm_config_cache=/tmp/.npm
	-v "$PWD":/app -w /app)

[[ -d build ]] || docker run "${DOCKER_COMMON[@]}" -e DATABASE_URL=/tmp/b.db "$IMAGE" \
	bash -lc 'npm run build' >/dev/null

cleanup() { docker rm -f "$N1" "$N2" >/dev/null 2>&1 || true; rm -f "$DUMP"; }
trap cleanup EXIT
cleanup

boot() { # name port db
	docker run -d --name "$1" "${DOCKER_COMMON[@]}" \
		-e DATABASE_URL="$3" -e ORIGIN="http://localhost:$2" -e PORT="$2" \
		-p "$2:$2" "$IMAGE" node build >/dev/null
	for _ in $(seq 1 40); do curl -sf "http://localhost:$2/" >/dev/null 2>&1 && return; sleep 0.5; done
}

PASS=0
FAIL=0
ok() {
	PASS=$((PASS + 1))
	printf '  \033[32m✓\033[0m %s\n' "$1"
}
bad() {
	FAIL=$((FAIL + 1))
	printf '  \033[31m✗\033[0m %s\n' "$1"
}
have() { grep -q -- "$2" <<<"$1"; }
jpost() { curl -s -X POST -H 'Content-Type: application/json' --data "${2:-}" "$1"; }

echo "▸ booting source DB on :${PORT1}…"
boot "$N1" "$PORT1" /tmp/v5a.db

echo "▸ create a night sleep + a waking…"
SID="$(grep -oE '"id":"[^"]+"' <<<"$(jpost "$O1/api/sleeps" \
	'{"startTime":1700000000000,"endTime":1700020000000,"type":"night","timezone":"Europe/Prague"}')" |
	head -1 | sed -E 's/.*:"([^"]+)"/\1/')"
[[ -n "$SID" ]] && ok "sleep created ($SID)" || bad 'sleep created'
jpost "$O1/api/sleeps/$SID/wakings" '{"time":1700010000000}' >/dev/null

echo "▸ export…"
HDR="$(curl -sD - -o "$DUMP" "$O1/api/export")"
have "$HDR" '200' && ok 'export returns 200' || bad 'export returns 200'
have "$HDR" 'content-type: application/json' && ok 'export content-type json' || bad 'export content-type json'
have "$HDR" 'content-disposition: attachment; filename="baby-tracker-backup-' &&
	ok 'export is an attachment download' || bad 'export is an attachment download'
BODY="$(cat "$DUMP")"
have "$BODY" '"version": 1' && ok 'dump has version 1' || bad 'dump has version 1'
have "$BODY" "\"$SID\"" && ok 'dump contains the sleep' || bad 'dump contains the sleep'
have "$BODY" '"activeTemplate"' && ok 'dump has active template' || bad 'dump has active template'

echo "▸ idempotent re-import into the same DB (all skip)…"
R="$(jpost "$O1/api/import" "@$DUMP")"
have "$R" '"sleepEntries":{"inserted":0,"updated":0,"skipped":1}' &&
	ok 're-import skips the sleep' || bad 're-import skips the sleep'
have "$R" '"nightWakings":{"inserted":0,"updated":0,"skipped":1,"orphaned":0}' &&
	ok 're-import skips the waking' || bad 're-import skips the waking'

echo "▸ malformed import → 400 (DB untouched)…"
CODE="$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' \
	--data '{"version":1,"sleepEntries":[{"id":"x"}]}' "$O1/api/import")"
[[ "$CODE" == 400 ]] && ok 'malformed dump rejected with 400' || bad "malformed dump rejected with 400 (got $CODE)"

echo "▸ booting fresh DB on :${PORT2} and restoring the dump…"
boot "$N2" "$PORT2" /tmp/v5b.db
R2="$(jpost "$O2/api/import" "@$DUMP")"
have "$R2" '"sleepEntries":{"inserted":1,"updated":0,"skipped":0}' &&
	ok 'fresh import inserts the sleep' || bad 'fresh import inserts the sleep'
have "$R2" '"nightWakings":{"inserted":1,"updated":0,"skipped":0,"orphaned":0}' &&
	ok 'fresh import inserts the waking' || bad 'fresh import inserts the waking'
have "$(curl -s "$O2/api/export")" "\"$SID\"" &&
	ok 'restored sleep survives round-trip (id preserved)' || bad 'restored sleep survives round-trip'

echo "▸ orphan waking (missing parent) is skipped, not errored…"
RO="$(jpost "$O2/api/import" \
	'{"version":1,"nightWakings":[{"id":"orphan-1","sleepEntryId":"nope","time":1700005000000}]}')"
have "$RO" '"orphaned":1' && ok 'orphan waking counted, not inserted' || bad 'orphan waking counted'

echo
printf '▸ \033[1m%d passed, %d failed\033[0m\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
