/**
 * The plan's own bedtime, derived from its shape (pure, framework-free).
 *
 * A plan cascades from the reference wake time through its wake windows and nap
 * durations to a bedtime. That cascaded bedtime *is* the soft target the live
 * projection redistributes toward (REQUIREMENTS §5.2) — there is no separate
 * stored "target bedtime" to drift from the plan. Shaping the plan (editing a
 * window or nap) moves the bedtime, and the projection follows it.
 */

/** 'HH:MM' → minutes past midnight, or null when malformed. */
function parseHM(hhmm: string | null | undefined): number | null {
	if (!hhmm) return null;
	const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
	if (!m) return null;
	const h = Number(m[1]);
	const min = Number(m[2]);
	if (h > 23 || min > 59) return null;
	return h * 60 + min;
}

/** Minutes past midnight (any sign) → 'HH:MM' clock, wrapped into [00:00, 24:00). */
function fmtHM(minOfDay: number): string {
	const v = ((Math.round(minOfDay) % 1440) + 1440) % 1440;
	const hh = String(Math.floor(v / 60)).padStart(2, '0');
	const mm = String(v % 60).padStart(2, '0');
	return `${hh}:${mm}`;
}

/**
 * The plan's cascaded bedtime as a wall-clock 'HH:MM': the reference wake time
 * plus every wake window and nap duration. Returns null when the wake time is
 * malformed (the caller then falls back to the legacy sliding cascade).
 */
export function planBedtime(
	referenceWakeTime: string | null | undefined,
	wakeWindows: readonly number[],
	expectedNapDurations: readonly number[]
): string | null {
	const wake = parseHM(referenceWakeTime);
	if (wake === null) return null;
	const sum = (a: readonly number[]) => a.reduce((t, n) => t + (Number.isFinite(n) ? n : 0), 0);
	return fmtHM(wake + sum(wakeWindows) + sum(expectedNapDurations));
}
