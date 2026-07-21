import { cpSync, mkdirSync, existsSync, rmSync } from 'node:fs';

// Seed an isolated, writable copy of the dev database before the E2E run. The
// app writes during ordinary GET loads (e.g. pruning stale day-overrides), so
// the suite needs a DB it owns — pointing it at the shared `local.db` would both
// fail on read-only/permission setups and mutate real data. `DATABASE_URL` in
// playwright.config.ts points the preview server at this copy.
const SRC = 'local.db';
const DST = 'e2e/.tmp/e2e.db';

export default function globalSetup() {
	mkdirSync('e2e/.tmp', { recursive: true });
	// Copy the main file plus its WAL sidecars so committed and not-yet-checkpointed
	// data both carry over.
	for (const suffix of ['', '-wal', '-shm']) {
		const src = `${SRC}${suffix}`;
		const dst = `${DST}${suffix}`;
		if (existsSync(dst)) rmSync(dst);
		if (existsSync(src)) cpSync(src, dst);
	}
}
