/**
 * Manual entry: add a past (or in-progress) sleep by hand. Reached from the "+ Add
 * sleep" button on the Now, Today, and History views; on save it redirects back to
 * wherever it was opened from. Writes via the query layer (progressive enhancement).
 */
import { createSleep } from '$lib/server/queries/sleeps';
import { getSettings } from '$lib/server/queries/settings';
import {
	parseSleepCreate,
	resolveDisplayZone,
	resolveEntryTimezone
} from '$lib/server/api/validate';
import { resolveLocalDateTime } from '$lib/projection/time';
import { safeFrom, safeDate, returnPath } from './returnPath';
import { fail, redirect, isHttpError } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url, cookies }) => {
	const settings = getSettings();
	return {
		now: Date.now(),
		timeZone: resolveDisplayZone(cookies.get('tz')),
		clock24h: settings.clock24h,
		from: safeFrom(url.searchParams.get('from')),
		// The day the origin view was showing, so the form returns to it (not today).
		date: safeDate(url.searchParams.get('date'))
	};
};

const s = (v: FormDataEntryValue | null) => (typeof v === 'string' ? v : '');

export const actions: Actions = {
	create: async ({ request }) => {
		const b = await request.formData();
		const from = safeFrom(s(b.get('from')));
		const date = safeDate(s(b.get('date')));
		// Resolve the typed wall-clock in the same zone we store, so the epoch round-trips.
		// The enhanced form sends the phone's own zone; both ends share it (a manual add
		// is typed against one clock — cross-zone edits are done later in History).
		const timezone = resolveEntryTimezone(b.get('timezone'));
		const startLocal = s(b.get('startLocal'));
		const endLocal = s(b.get('endLocal'));
		if (!startLocal) return fail(400, { message: 'Start time is required' });

		const startTime = resolveLocalDateTime(startLocal, timezone);
		const endTime = endLocal ? resolveLocalDateTime(endLocal, timezone) : null;
		if (endTime != null && endTime < startTime) {
			return fail(400, { message: 'End time must be after start time' });
		}

		try {
			createSleep(
				parseSleepCreate({
					startTime,
					endTime,
					startTimezone: timezone,
					endTimezone: endTime == null ? null : timezone,
					type: s(b.get('type')),
					location: s(b.get('location')) || null,
					putDown: s(b.get('putDown')) || null,
					notes: s(b.get('notes')) || null
				})
			);
		} catch (e) {
			if (isHttpError(e)) return fail(e.status, { message: String(e.body.message) });
			throw e;
		}

		redirect(303, returnPath(from, date));
	}
};
