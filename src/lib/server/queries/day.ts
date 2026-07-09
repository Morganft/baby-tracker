/**
 * Day/night grouping (REQUIREMENTS §5.7): a night sleep and any wakings after
 * midnight belong to **the day the night sleep started**. The projection engine
 * is a pure cascade over "today's" sleeps + this morning's actual wake; deciding
 * which stored rows constitute "today" is this layer's job, not the engine's.
 *
 * `groupDay` and `localDateKey` are pure (no DB) so they can be unit-tested;
 * `assembleDay` (in `./sleeps`) wraps them around a DB read.
 */
import type { LoggedSleep } from '$lib/projection/types';

/** The minimal shape `groupDay` needs from a stored sleep. Times are epoch-ms. */
export interface DayEntry {
	id: string;
	type: 'nap' | 'night';
	start: number;
	end: number | null;
}

/** Local calendar day, 'YYYY-MM-DD', of `epoch` as seen in `timeZone`. */
export function localDateKey(epoch: number, timeZone: string): string {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).formatToParts(epoch);
	const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
	return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Shift a 'YYYY-MM-DD' key by whole calendar days (pure date math, no tz). */
function shiftDateKey(key: string, days: number): string {
	const [y, m, d] = key.split('-').map(Number);
	const dt = new Date(Date.UTC(y, m - 1, d + days));
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

export interface DayGrouping {
	/** Today's sleeps for the engine: naps started today + tonight's bedtime. */
	sleeps: LoggedSleep[];
	/** Actual morning wake = end of the night sleep that started yesterday. */
	morningWake: number | null;
}

/**
 * Partition all stored entries into today's projection inputs. `now`/`timeZone`
 * define which calendar day is "today". A night sleep started today is tonight's
 * bedtime and stays in `sleeps`; a night sleep started *yesterday* supplies this
 * morning's wake via its `end` (its post-midnight wakings stay with yesterday).
 */
export function groupDay(entries: DayEntry[], now: number, timeZone: string): DayGrouping {
	const todayKey = localDateKey(now, timeZone);
	const yesterdayKey = shiftDateKey(todayKey, -1);

	const sleeps: LoggedSleep[] = entries
		.filter((e) => localDateKey(e.start, timeZone) === todayKey)
		.sort((a, b) => a.start - b.start)
		.map((e) => ({ id: e.id, type: e.type, start: e.start, end: e.end }));

	// Last night's sleep: the most recent night that started yesterday and ended.
	const lastNight = entries
		.filter(
			(e) => e.type === 'night' && e.end != null && localDateKey(e.start, timeZone) === yesterdayKey
		)
		.sort((a, b) => b.start - a.start)[0];

	return { sleeps, morningWake: lastNight ? lastNight.end : null };
}
