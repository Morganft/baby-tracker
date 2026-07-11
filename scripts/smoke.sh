#!/usr/bin/env bash
# End-to-end smoke test for the "Right now" home + JSON API.
#
# Boots the built adapter-node server in a node:22 container (the host has no
# Node — see AGENTS.md) against a THROWAWAY SQLite DB inside the container, drives
# the quick-log flows and API with curl, asserts the observable results, then
# tears everything down. Never touches your real dev DB.
#
# Usage:
#   scripts/smoke.sh            # build if needed, then run the smoke test
#   scripts/smoke.sh --build    # force a fresh production build first
#   scripts/smoke.sh --gates    # run check + lint + test + build first, then smoke
#   PORT=3200 scripts/smoke.sh  # use a different host/container port
set -euo pipefail

PORT="${PORT:-3117}"
NAME="baby-tracker-smoke"
ORIGIN="http://localhost:${PORT}"
IMAGE="node:22"
DOCKER_COMMON=(--rm --user "$(id -u):$(id -g)"
	-e HOME=/tmp -e npm_config_cache=/tmp/.npm
	-v "$PWD":/app -w /app)

GATES=0
BUILD=0
for a in "$@"; do
	case "$a" in
	--gates) GATES=1 ;;
	--build) BUILD=1 ;;
	*)
		echo "unknown arg: $a" >&2
		exit 2
		;;
	esac
done

# --- optional static gates (also produces build/) ---------------------------
if [[ "$GATES" -eq 1 ]]; then
	echo "▸ gates: check + lint + test + build…"
	docker run "${DOCKER_COMMON[@]}" -e DATABASE_URL=/tmp/gates.db "$IMAGE" \
		bash -lc 'npm run check && npm run lint && npm run test && npm run build'
elif [[ "$BUILD" -eq 1 || ! -d build ]]; then
	echo "▸ building production server…"
	docker run "${DOCKER_COMMON[@]}" -e DATABASE_URL=/tmp/build.db "$IMAGE" \
		bash -lc 'npm run build' >/dev/null
fi

# --- boot -------------------------------------------------------------------
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup # clear any leftover from a previous aborted run

echo "▸ booting server on :${PORT} (throwaway DB)…"
docker run -d --name "$NAME" "${DOCKER_COMMON[@]}" \
	-e DATABASE_URL=/tmp/smoke.db -e ORIGIN="$ORIGIN" -e PORT="$PORT" \
	-p "${PORT}:${PORT}" "$IMAGE" node build >/dev/null

ready=0
for _ in $(seq 1 40); do
	if curl -sf "$ORIGIN/" >/dev/null 2>&1; then
		ready=1
		break
	fi
	sleep 0.5
done
if [[ "$ready" -ne 1 ]]; then
	echo "server did not come up; last logs:" >&2
	docker logs "$NAME" 2>&1 | tail -20 >&2
	exit 1
fi

# --- assertion helpers ------------------------------------------------------
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

home() { curl -s "$ORIGIN/"; }
# act ACTION [BODY]  -> prints the HTTP status code of a form-action POST
act() {
	curl -s -o /dev/null -w '%{http_code}' -X POST -H "Origin: $ORIGIN" \
		-H 'Content-Type: application/x-www-form-urlencoded' --data "${2:-}" "$ORIGIN/?/$1"
}
# actbody ACTION [BODY]  -> prints the response body (for failure assertions)
actbody() {
	curl -s -X POST -H "Origin: $ORIGIN" \
		-H 'Content-Type: application/x-www-form-urlencoded' --data "${2:-}" "$ORIGIN/?/$1"
}
first_id() { grep -oE '"id":"[^"]+"' | head -1 | sed -E 's/.*:"([^"]+)"/\1/'; }

echo "▸ running checks…"

# 1. fresh state = awake, quick-log button present
H="$(home)"
have "$H" 'Awake' && ok 'fresh home reads Awake' || bad 'fresh home reads Awake'
have "$H" 'Fell asleep' && ok 'fell-asleep button present' || bad 'fell-asleep button present'

# 2. fell asleep -> asleep
act asleep >/dev/null
H="$(home)"
have "$H" 'Asleep' && ok 'after "fell asleep": reads Asleep' || bad 'after "fell asleep": reads Asleep'
have "$H" 'Woke up' && ok 'after "fell asleep": woke-up button shown' || bad 'after "fell asleep": woke-up button shown'

# 3. woke up -> awake, endTime persisted
act awake >/dev/null
H="$(home)"
have "$H" 'Awake' && ok 'after "woke up": reads Awake' || bad 'after "woke up": reads Awake'
S="$(curl -s "$ORIGIN/api/sleeps")"
have "$S" '"endTime":[0-9]' && ok 'logged entry has endTime set' || bad 'logged entry has endTime set'

# 4. double "woke up" is rejected (nothing in progress)
have "$(actbody awake)" 'failure' && ok 'double "woke up" is rejected' || bad 'double "woke up" is rejected'

# 5. adjust: valid patch accepted, bad field rejected
ID="$(first_id <<<"$S")"
NOW_MS="$(date +%s%3N)"
if [[ -n "$ID" ]]; then
	CODE="$(act adjust "id=${ID}&field=endTime&time=${NOW_MS}")"
	[[ "$CODE" == 200 ]] && ok "adjust accepted (HTTP $CODE)" || bad "adjust accepted (got HTTP $CODE)"
	have "$(actbody adjust "id=${ID}&field=bogus&time=${NOW_MS}")" 'failure' &&
		ok 'adjust rejects an invalid field' || bad 'adjust rejects an invalid field'
else
	bad 'adjust: no entry id to test against'
fi

# 6. overnight in-progress night sleep reads as Asleep
[[ -n "$ID" ]] && curl -s -o /dev/null -X DELETE "$ORIGIN/api/sleeps/${ID}"
PAST=$((NOW_MS - 11 * 3600 * 1000))
curl -s -o /dev/null -H 'Content-Type: application/json' \
	--data "{\"startTime\":${PAST},\"type\":\"night\"}" "$ORIGIN/api/sleeps"
have "$(home)" 'Asleep' && ok 'overnight in-progress night reads Asleep' ||
	bad 'overnight in-progress night reads Asleep'

echo
printf '▸ \033[1m%d passed, %d failed\033[0m\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
