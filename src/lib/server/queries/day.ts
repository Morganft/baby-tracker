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
export function shiftDateKey(key: string, days: number): string {
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
	/**
	 * The entry the "overnight" block represents: the most recent night sleep that
	 * started yesterday, whether or not it has ended. Lets the timeline edit last
	 * night's sleep (or an in-progress overnight) instead of logging a duplicate.
	 * Null when no such entry exists (then the overnight is purely planned).
	 */
	overnightEntryId: string | null;
}

/**
 * Partition all stored entries into one day's projection inputs. `dayKey` (a
 * 'YYYY-MM-DD' local calendar day) defines which day the grouping is for. A night
 * sleep started that day is that evening's bedtime and stays in `sleeps`; a night
 * sleep started the day *before* supplies that morning's wake via its `end` (its
 * post-midnight wakings stay with the prior day).
 */
export function groupDayForKey(entries: DayEntry[], dayKey: string, timeZone: string): DayGrouping {
	const yesterdayKey = shiftDateKey(dayKey, -1);

	const sleeps: LoggedSleep[] = entries
		.filter((e) => localDateKey(e.start, timeZone) === dayKey)
		.sort((a, b) => a.start - b.start)
		.map((e) => ({ id: e.id, type: e.type, start: e.start, end: e.end }));

	// Last night's sleep: the most recent night that started yesterday and ended.
	const lastNight = entries
		.filter(
			(e) => e.type === 'night' && e.end != null && localDateKey(e.start, timeZone) === yesterdayKey
		)
		.sort((a, b) => b.start - a.start)[0];

	// The overnight block's entry: most recent night started yesterday, end optional
	// (so an in-progress overnight is editable rather than duplicated).
	const overnight = entries
		.filter((e) => e.type === 'night' && localDateKey(e.start, timeZone) === yesterdayKey)
		.sort((a, b) => b.start - a.start)[0];

	return {
		sleeps,
		morningWake: lastNight ? lastNight.end : null,
		overnightEntryId: overnight ? overnight.id : null
	};
}

/**
 * Group today's projection inputs. `now`/`timeZone` resolve which calendar day is
 * "today"; the work is delegated to `groupDayForKey`. See it for the day/night rule.
 */
export function groupDay(entries: DayEntry[], now: number, timeZone: string): DayGrouping {
	return groupDayForKey(entries, localDateKey(now, timeZone), timeZone);
}

/** A read-only, at-a-glance summary of one grouped day. Times are epoch-ms. */
export interface DaySummary {
	/** Sum of completed nap durations that day, whole minutes. */
	daytimeSleepMin: number;
	/** Count of completed naps that day. */
	napCount: number;
	/** Actual morning wake (end of the prior night's sleep), or null. */
	morningWake: number | null;
	/** Start of that day's night sleep (bedtime), or null if not logged. */
	bedtime: number | null;
	/** Awake time between wake and bedtime minus daytime sleep; null if either bound is missing. */
	awakeMin: number | null;
}

/**
 * Derive a `DaySummary` from a grouping. Pure (no DB) so it can be unit-tested;
 * `getDaySummary` (in `./sleeps`) wraps it around a DB read. In-progress naps
 * (no `end`) are excluded from the daytime-sleep total and nap count.
 */
export function summariseGrouping(g: DayGrouping): DaySummary {
	const completedNaps = g.sleeps.filter((s) => s.type === 'nap' && s.end != null);
	const daytimeSleepMin = Math.round(
		completedNaps.reduce((sum, s) => sum + ((s.end as number) - s.start), 0) / 60000
	);
	const bedtime = g.sleeps.find((s) => s.type === 'night')?.start ?? null;
	const morningWake = g.morningWake;
	const awakeMin =
		morningWake != null && bedtime != null
			? Math.round((bedtime - morningWake) / 60000) - daytimeSleepMin
			: null;

	return {
		daytimeSleepMin,
		napCount: completedNaps.length,
		morningWake,
		bedtime,
		awakeMin
	};
}
