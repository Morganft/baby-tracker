/**
 * Initial form model for the Today-timeline sleep popup. Pure (no DB/DOM) so it
 * can be unit-tested: it turns either a logged entry (edit) or a planned sleep
 * (create — a tapped projected nap/bedtime, or the overnight draft) into the
 * datetime-local + field values the popup binds to. Times are absolute epoch-ms
 * rendered into wall-clock inputs via `toDateTimeInput`.
 */
import { toDateTimeInput } from '$lib/format';
import type { SleepDTO } from '$lib/server/queries/sleeps';
import type { ProjectedSleep } from '$lib/projection/types';

export interface SleepFormInit {
	/** 'edit' patches an existing entry; 'create' inserts a new one. */
	mode: 'edit' | 'create';
	/** Entry id for edit; null for create (the DB assigns one). */
	id: string | null;
	/** 'YYYY-MM-DDTHH:MM' for `<input type="datetime-local">`. */
	startLocal: string;
	/** Same; '' means in-progress / not yet ended. */
	endLocal: string;
	/** Zone each end's typed wall-clock is resolved in on submit. */
	startTimezone: string;
	endTimezone: string;
	type: 'nap' | 'night';
	location: string;
	putDown: string;
	notes: string;
}

/** Prefill the popup from a logged sleep, each end in its own captured zone. */
export function editInit(e: SleepDTO): SleepFormInit {
	const endTz = e.endTimezone ?? e.startTimezone;
	return {
		mode: 'edit',
		id: e.id,
		startLocal: toDateTimeInput(e.startTime, e.startTimezone),
		endLocal: e.endTime != null ? toDateTimeInput(e.endTime, endTz) : '',
		startTimezone: e.startTimezone,
		endTimezone: endTz,
		type: e.type,
		location: e.location ?? '',
		putDown: e.putDown ?? '',
		notes: e.notes ?? ''
	};
}

/** Prefill a create popup from explicit epochs (both ends in the display `zone`). */
export function createFrom(
	s: { start: number; end: number | null; type: 'nap' | 'night' },
	zone: string
): SleepFormInit {
	return {
		mode: 'create',
		id: null,
		startLocal: toDateTimeInput(s.start, zone),
		endLocal: s.end != null ? toDateTimeInput(s.end, zone) : '',
		startTimezone: zone,
		endTimezone: zone,
		type: s.type,
		location: '',
		putDown: '',
		notes: ''
	};
}

/**
 * Prefill the popup from a projected sleep the user tapped: accept the plan's
 * start/end (and nap/night type) as a starting point, in the display `zone`.
 */
export function createInit(s: ProjectedSleep, zone: string): SleepFormInit {
	return createFrom({ start: s.start, end: s.projectedEnd ?? s.end, type: s.type }, zone);
}
