/**
 * Client-safe display formatting shared by the views. Times are absolute
 * epoch-ms; a per-call `timeZone` (the entry's own IANA zone, for travel) and
 * `clock24h` preference control rendering. No server-only imports — usable in
 * `+page.svelte` on both server and client.
 */

/** 'HH:MM' clock label of an epoch in `timeZone`, honoring the 12/24h pref. */
export function fmtTime(epoch: number, timeZone: string, clock24h: boolean): string {
	return new Intl.DateTimeFormat('en-GB', {
		timeZone,
		hour: '2-digit',
		minute: '2-digit',
		hour12: !clock24h
	}).format(epoch);
}

/** This device's IANA zone, sent with a log so a travelling phone captures its own. */
export function browserTimeZone(): string {
	return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

/** Short zone label of an epoch in `timeZone`, e.g. 'GMT+2' or 'CEST'. */
export function fmtZoneAbbrev(epoch: number, timeZone: string): string {
	const p = new Intl.DateTimeFormat('en-GB', { timeZone, timeZoneName: 'short' }).formatToParts(
		epoch
	);
	return p.find((x) => x.type === 'timeZoneName')?.value ?? '';
}

/** Compact duration, e.g. '1h 05m' or '45m'. Fractional minutes are rounded. */
export function fmtDuration(min: number): string {
	const total = Math.round(min);
	const h = Math.floor(total / 60);
	const m = total % 60;
	return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

/** Day heading, e.g. 'Wed 9 Jul 2026', of an epoch in `timeZone`. */
export function fmtDayHeading(epoch: number, timeZone: string): string {
	return new Intl.DateTimeFormat('en-GB', {
		timeZone,
		weekday: 'short',
		day: 'numeric',
		month: 'short',
		year: 'numeric'
	}).format(epoch);
}

/** Extract the given date/time parts of an epoch as seen in `timeZone`. */
function parts(epoch: number, timeZone: string) {
	const p = new Intl.DateTimeFormat('en-GB', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		hour12: false
	}).formatToParts(epoch);
	const get = (type: string) => p.find((x) => x.type === type)?.value ?? '';
	// Intl can emit hour '24' at midnight; normalise to '00'.
	const hour = get('hour') === '24' ? '00' : get('hour');
	return { year: get('year'), month: get('month'), day: get('day'), hour, minute: get('minute') };
}

/** 'HH:MM' (24h) of an epoch in `timeZone`, for an `<input type="time">`. */
export function toTimeInput(epoch: number, timeZone: string): string {
	const { hour, minute } = parts(epoch, timeZone);
	return `${hour}:${minute}`;
}

/** 'YYYY-MM-DDTHH:MM' of an epoch in `timeZone`, for `<input type="datetime-local">`. */
export function toDateTimeInput(epoch: number, timeZone: string): string {
	const { year, month, day, hour, minute } = parts(epoch, timeZone);
	return `${year}-${month}-${day}T${hour}:${minute}`;
}
