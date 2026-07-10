/**
 * History: every logged sleep, most-recent-first, grouped by local calendar day
 * (each entry in its own captured timezone, for travel). Entries are editable and
 * deletable here; night-waking counts are shown read-only (logging them has its
 * own deferred UI — see BACKLOG.md).
 */
import { listSleeps, updateSleep, deleteSleep, type SleepDTO } from '$lib/server/queries/sleeps';
import { getSettings } from '$lib/server/queries/settings';
import { parseSleepUpdate, serverTimeZone } from '$lib/server/api/validate';
import { resolveLocalDateTime } from '$lib/projection/time';
import { localDateKey } from '$lib/server/queries/day';
import { fmtDayHeading } from '$lib/format';
import { fail, isHttpError } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

interface DayGroup {
	key: string;
	heading: string;
	entries: SleepDTO[];
}

export const load: PageServerLoad = () => {
	const settings = getSettings();
	const entries = listSleeps(); // already most-recent-first

	// Group by the entry's own local calendar day so travel days read correctly.
	const groups: DayGroup[] = [];
	const byKey = new Map<string, DayGroup>();
	for (const e of entries) {
		const key = localDateKey(e.startTime, e.timezone);
		let group = byKey.get(key);
		if (!group) {
			group = { key, heading: fmtDayHeading(e.startTime, e.timezone), entries: [] };
			byKey.set(key, group);
			groups.push(group);
		}
		group.entries.push(e);
	}

	// The reference zone; entries whose own zone differs (travel) get a zone label.
	return { clock24h: settings.clock24h, displayZone: serverTimeZone(), groups };
};

/** Turn a thrown SvelteKit `error()` from validation into an action `fail`. */
function failFromValidation(e: unknown) {
	if (isHttpError(e)) return fail(e.status, { message: String(e.body.message) });
	throw e;
}

const s = (v: FormDataEntryValue | null) => (typeof v === 'string' ? v : '');

export const actions: Actions = {
	/** Edit a sleep entry's times, type, and optional details. */
	edit: async ({ request }) => {
		const b = await request.formData();
		const id = s(b.get('id'));
		const timezone = s(b.get('timezone'));
		const startLocal = s(b.get('startLocal'));
		const endLocal = s(b.get('endLocal'));
		if (!id || !timezone || !startLocal) return fail(400, { message: 'Missing required fields' });

		const startTime = resolveLocalDateTime(startLocal, timezone);
		const endTime = endLocal ? resolveLocalDateTime(endLocal, timezone) : null;
		if (endTime != null && endTime < startTime) {
			return fail(400, { message: 'End time must be after start time' });
		}

		try {
			const patch = parseSleepUpdate({
				startTime,
				endTime,
				timezone,
				type: s(b.get('type')),
				location: s(b.get('location')) || null,
				putDown: s(b.get('putDown')) || null,
				notes: s(b.get('notes')) || null
			});
			if (!updateSleep(id, patch)) return fail(404, { message: 'Entry not found' });
		} catch (e) {
			return failFromValidation(e);
		}
		return { ok: true };
	},

	/** Delete a sleep entry (cascades its wakings). */
	delete: async ({ request }) => {
		const id = s((await request.formData()).get('id'));
		if (!id || !deleteSleep(id)) return fail(404, { message: 'Entry not found' });
		return { ok: true };
	}
};
