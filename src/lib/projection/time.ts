/**
 * Timezone helpers for the projection engine.
 *
 * Sleep times are stored absolute (epoch-ms), but templates express the day
 * anchor as a wall-clock `reference_wake_time` ('HH:MM'). Resolving that clock
 * time to an absolute instant requires knowing the calendar day and IANA zone,
 * which we derive with `Intl` (no external tz library on the host).
 */

const MINUTE_MS = 60_000;

/** Offset (ms) to add to UTC to get local wall-clock time in `timeZone` at `t`. */
function tzOffsetMs(t: number, timeZone: string): number {
	const dtf = new Intl.DateTimeFormat('en-US', {
		timeZone,
		hour12: false,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit'
	});
	const parts = dtf.formatToParts(t);
	const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
	let hour = get('hour');
	// `Intl` can emit hour '24' at midnight for some locales/zones; normalise.
	if (hour === 24) hour = 0;
	const asUtc = Date.UTC(
		get('year'),
		get('month') - 1,
		get('day'),
		hour,
		get('minute'),
		get('second')
	);
	return asUtc - t;
}

/**
 * Resolve a wall-clock time (Y/M/D H:M in `timeZone`) to an absolute epoch-ms
 * instant. DST-safe: the offset is measured at the target instant, then refined
 * once to settle transitions.
 */
function resolveWallClock(
	year: number,
	month: number,
	day: number,
	hour: number,
	minute: number,
	timeZone: string
): number {
	const utcGuess = Date.UTC(year, month - 1, day, hour, minute);
	const offset1 = tzOffsetMs(utcGuess, timeZone);
	let t = utcGuess - offset1;
	const offset2 = tzOffsetMs(t, timeZone);
	if (offset2 !== offset1) t = utcGuess - offset2;
	return t;
}

/**
 * Resolve a wall-clock 'HH:MM' on the calendar day of `referenceEpoch` (as seen
 * in `timeZone`) to an absolute epoch-ms instant.
 */
export function resolveClockTime(hhmm: string, referenceEpoch: number, timeZone: string): number {
	const [h, m] = hhmm.split(':').map(Number);

	// Calendar Y/M/D of the reference instant, as seen in the zone.
	const dtf = new Intl.DateTimeFormat('en-US', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	});
	const parts = dtf.formatToParts(referenceEpoch);
	const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
	return resolveWallClock(get('year'), get('month'), get('day'), h, m, timeZone);
}

/**
 * Resolve an `<input type="datetime-local">` value ('YYYY-MM-DDTHH:MM', the wall
 * clock a user typed) interpreted in `timeZone` to an absolute epoch-ms instant.
 * Used when editing a past entry's timestamps from the History view.
 */
export function resolveLocalDateTime(local: string, timeZone: string): number {
	const [date, time] = local.split('T');
	const [year, month, day] = date.split('-').map(Number);
	const [h, m] = time.split(':').map(Number);
	return resolveWallClock(year, month, day, h, m, timeZone);
}

export function minutesToMs(min: number): number {
	return min * MINUTE_MS;
}

export function msToMinutes(ms: number): number {
	return ms / MINUTE_MS;
}
