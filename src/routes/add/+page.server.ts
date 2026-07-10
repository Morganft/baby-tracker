/**
 * Manual entry: add a past (or in-progress) sleep by hand. Reached from the "+ Add
 * sleep" button on the Now, Today, and History views; on save it redirects back to
 * wherever it was opened from. Writes via the query layer (progressive enhancement).
 */
import { createSleep } from '$lib/server/queries/sleeps';
import { getSettings } from '$lib/server/queries/settings';
import { parseSleepCreate, serverTimeZone, resolveEntryTimezone } from '$lib/server/api/validate';
import { resolveLocalDateTime } from '$lib/projection/time';
import { fail, redirect, isHttpError } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

/** The views that link here; the form returns to whichever opened it. */
type FromPath = '/' | '/timeline' | '/history';

/** Constrain the `from` param to a known in-app view (guards open-redirect). */
function safeFrom(from: string | null): FromPath {
	return from === '/timeline' || from === '/history' ? from : '/';
}

export const load: PageServerLoad = ({ url }) => {
	const settings = getSettings();
	return {
		now: Date.now(),
		timeZone: serverTimeZone(),
		clock24h: settings.clock24h,
		trackTimezone: settings.trackTimezone,
		from: safeFrom(url.searchParams.get('from'))
	};
};

const s = (v: FormDataEntryValue | null) => (typeof v === 'string' ? v : '');

export const actions: Actions = {
	create: async ({ request }) => {
		const b = await request.formData();
		const from = safeFrom(s(b.get('from')));
		// Resolve the typed wall-clock in the same zone we store, so the epoch round-trips.
		// The enhanced form sends the phone's zone (honoured when tracking is on).
		const timezone = resolveEntryTimezone(b.get('timezone'), getSettings().trackTimezone);
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
					timezone,
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

		redirect(303, from);
	}
};
