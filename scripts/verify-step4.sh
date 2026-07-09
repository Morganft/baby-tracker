#!/usr/bin/env bash
# One-off verification for Step 4 views (timeline / history / templates / settings).
# Boots the built adapter-node server against a THROWAWAY DB, drives the new pages
# + form actions with curl, asserts observable results, tears down. Mirrors the
# boot pattern of scripts/smoke.sh.
set -euo pipefail

PORT="${PORT:-3118}"
NAME="baby-tracker-verify4"
ORIGIN="http://localhost:${PORT}"
IMAGE="node:22"
DOCKER_COMMON=(--rm --user "$(id -u):$(id -g)"
	-e HOME=/tmp -e npm_config_cache=/tmp/.npm
	-v "$PWD":/app -w /app)

[[ -d build ]] || docker run "${DOCKER_COMMON[@]}" -e DATABASE_URL=/tmp/b.db "$IMAGE" \
	bash -lc 'npm run build' >/dev/null

cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

echo "▸ booting on :${PORT} (throwaway DB)…"
docker run -d --name "$NAME" "${DOCKER_COMMON[@]}" \
	-e DATABASE_URL=/tmp/v4.db -e ORIGIN="$ORIGIN" -e PORT="$PORT" \
	-p "${PORT}:${PORT}" "$IMAGE" node build >/dev/null

for _ in $(seq 1 40); do curl -sf "$ORIGIN/" >/dev/null 2>&1 && break; sleep 0.5; done

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
act() {
	curl -s -X POST -H "Origin: $ORIGIN" \
		-H 'Content-Type: application/x-www-form-urlencoded' --data "${2:-}" "$ORIGIN$1"
}

echo "▸ pages render (SSR)…"
have "$(curl -s "$ORIGIN/timeline")" 'Today' && ok 'timeline renders' || bad 'timeline renders'
have "$(curl -s "$ORIGIN/history")" 'History' && ok 'history renders' || bad 'history renders'
have "$(curl -s "$ORIGIN/templates")" 'Active plan' && ok 'templates renders' || bad 'templates renders'
have "$(curl -s "$ORIGIN/settings")" 'Short-nap' && ok 'settings renders' || bad 'settings renders'
have "$(curl -s "$ORIGIN/")" 'Settings' && ok 'nav present on home' || bad 'nav present on home'

echo "▸ settings save…"
act "/settings?/save" 'shortNapThresholdMin=20&shortNapReductionPercent=40&clock24h=on' >/dev/null
S="$(curl -s "$ORIGIN/api/settings")"
have "$S" '"shortNapReductionPercent":40' && ok 'reduction % persisted' || bad 'reduction % persisted'
have "$S" '"shortNapThresholdMin":20' && ok 'threshold persisted' || bad 'threshold persisted'
# trackTimezone checkbox omitted -> should save as false
have "$S" '"trackTimezone":false' && ok 'unchecked checkbox saves false' || bad 'unchecked checkbox saves false'

echo "▸ templates: edit active never mutates library, then save/load…"
# Snapshot current active to library first.
act "/templates?/saveNew" 'name=Baseline' >/dev/null
LIB="$(curl -s "$ORIGIN/api/templates")"
TID="$(grep -oE '"id":"[^"]+"' <<<"$LIB" | head -1 | sed -E 's/.*:"([^"]+)"/\1/')"
# Edit the active slot (2 naps) — must NOT change the saved library entry.
act "/templates?/editActive" \
	'name=Edited&referenceWakeTime=06:30&napCount=2&wakeWindows=100,120,150&expectedNapDurations=60,60&dailyTotalSleepTarget=&daytimeCap=&bedtimeStart=&bedtimeEnd=' >/dev/null
A="$(curl -s "$ORIGIN/api/active-template")"
have "$A" '"name":"Edited"' && ok 'active slot edited' || bad 'active slot edited'
have "$A" '"napCount":2' && ok 'active nap count changed' || bad 'active nap count changed'
LIB2="$(curl -s "$ORIGIN/api/templates/$TID")"
have "$LIB2" '"name":"Baseline"' && ok 'library entry unchanged by active edit' ||
	bad 'library entry unchanged by active edit'
# Load the library entry back into the active slot.
act "/templates?/load" "templateId=$TID" >/dev/null
have "$(curl -s "$ORIGIN/api/active-template")" '"name":"Baseline"' &&
	ok 'load copies library -> active' || bad 'load copies library -> active'
# Invalid array lengths are rejected with a friendly message (not a 500).
have "$(act "/templates?/editActive" 'name=X&referenceWakeTime=07:00&napCount=3&wakeWindows=1,2&expectedNapDurations=1,2,3')" \
	'wakeWindows must have length' && ok 'bad array length rejected' || bad 'bad array length rejected'

echo "▸ history: edit + delete an entry…"
NOW_MS="$(date +%s%3N)"
START=$((NOW_MS - 5400000)) # 1.5h ago
curl -s -o /dev/null -H 'Content-Type: application/json' \
	--data "{\"startTime\":${START},\"endTime\":${NOW_MS},\"type\":\"nap\",\"timezone\":\"UTC\"}" \
	"$ORIGIN/api/sleeps"
SID="$(grep -oE '"id":"[^"]+"' <<<"$(curl -s "$ORIGIN/api/sleeps")" | head -1 | sed -E 's/.*:"([^"]+)"/\1/')"
have "$(curl -s "$ORIGIN/history")" "$SID" && ok 'entry appears in history' || bad 'entry appears in history'
# Edit: change notes + set an in-progress (blank end) with a valid start.
act "/history?/edit" "id=${SID}&timezone=UTC&startLocal=2026-07-09T08:00&endLocal=2026-07-09T09:00&type=nap&location=crib&putDown=drowsy&notes=hi" >/dev/null
E="$(curl -s "$ORIGIN/api/sleeps/$SID")"
have "$E" '"notes":"hi"' && ok 'edit persisted notes' || bad 'edit persisted notes'
have "$E" '"location":"crib"' && ok 'edit persisted location' || bad 'edit persisted location'
# end < start is rejected.
have "$(act "/history?/edit" "id=${SID}&timezone=UTC&startLocal=2026-07-09T09:00&endLocal=2026-07-09T08:00&type=nap&location=&putDown=&notes=")" \
	'End time must be after' && ok 'end<start rejected' || bad 'end<start rejected'
# Delete.
act "/history?/delete" "id=${SID}" >/dev/null
[[ "$(curl -s -o /dev/null -w '%{http_code}' "$ORIGIN/api/sleeps/$SID")" == 404 ]] &&
	ok 'entry deleted' || bad 'entry deleted'

echo
printf '▸ \033[1m%d passed, %d failed\033[0m\n' "$PASS" "$FAIL"
[[ "$FAIL" -eq 0 ]]
