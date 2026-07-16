/**
 * "Right now" home. The load computes today's live projection server-side, so it
 * re-anchors on every log; the quick-log form actions write via the query layer
 * and let SvelteKit re-run the load (progressive enhancement — works without JS).
 */
import { getActiveTemplate } from '$lib/server/queries/templates';
import { getSettings } from '$lib/server/queries/settings';
import {
	getActiveSleep,
	createSleep,
	updateSleep,
	listEntryZones,
	getDaySummary
} from '$lib/server/queries/sleeps';
import { buildProjection } from '$lib/server/queries/projection';
import { resolveViewedDay } from '$lib/server/queries/viewedDay';
import { resolveDisplayZone, resolveEntryTimezone } from '$lib/server/api/validate';
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ cookies, url }) => {
	const now = Date.now();
	const settings = getSettings();
	const timeZone = resolveDisplayZone(cookies.get('tz'));
	const template = getActiveTemplate();
	// Which calendar day the page renders — today (live path) or a past day (actuals).
	const view = resolveViewedDay(url.searchParams.get('date'), timeZone);

	// Fields common to both paths, so the page's `data` type is a stable shape
	// rather than a fragile discriminated union.
	const base = {
		...view,
		now,
		timeZone,
		clock24h: settings.clock24h,
		templateName: template.name,
		// id → captured zones, so the "Since" line can flag a travel entry logged
		// in a zone other than the one today renders in.
		entryZones: listEntryZones()
	};

	if (!view.isToday) {
		// Past day: no live "right now" — a read-only actuals summary drives the UI.
		return {
			...base,
			asleep: false,
			activeSleep: null,
			projection: null,
			daySummary: getDaySummary(view.viewedDayKey, timeZone)
		};
	}

	const active = getActiveSleep();
	return {
		...base,
		asleep: active != null,
		activeSleep: active
			? {
					id: active.id,
					start: active.startTime,
					type: active.type,
					timezone: active.startTimezone
				}
			: null,
		projection: buildProjection(now, timeZone),
		daySummary: null
	};
};

export const actions: Actions = {
	/** Quick-log "fell asleep": start the next planned sleep at the current time. */
	asleep: async ({ request, cookies }) => {
		const now = Date.now();
		if (getActiveSleep()) return fail(409, { message: 'Already asleep' });
		// Group the day in the phone's zone so a travel day picks the right "next sleep".
		const timeZone = resolveDisplayZone(cookies.get('tz'));
		// The instant is absolute (`now`); the stored zone is a display label, so we
		// take the phone's own zone (sent by the enhanced form) when it's valid.
		const clientTz = String((await request.formData()).get('timezone') ?? '');
		const entryTz = resolveEntryTimezone(clientTz);
		const type = buildProjection(now, timeZone).nextSleep?.type ?? 'night';
		createSleep({
			startTime: now,
			endTime: null,
			startTimezone: entryTz,
			endTimezone: null, // captured when the sleep is stopped (may differ — travel)
			type,
			location: null,
			putDown: null,
			notes: null
		});
		return { logged: 'asleep' as const };
	},

	/** Quick-log "woke up": end the in-progress sleep, capturing the wake zone. */
	awake: async ({ request }) => {
		const active = getActiveSleep();
		if (!active) return fail(409, { message: 'Not currently asleep' });
		// The phone may have crossed a zone since the sleep started; record where it
		// woke so the end renders in its own zone.
		const clientTz = String((await request.formData()).get('timezone') ?? '');
		updateSleep(active.id, { endTime: Date.now(), endTimezone: resolveEntryTimezone(clientTz) });
		return { logged: 'awake' as const };
	},

	/** Correct the timestamp of an already-logged event (start or end of a sleep). */
	adjust: async ({ request }) => {
		const data = await request.formData();
		const id = String(data.get('id') ?? '');
		const field = String(data.get('field') ?? '');
		const time = Number(data.get('time'));
		if (!id || (field !== 'startTime' && field !== 'endTime') || !Number.isFinite(time)) {
			return fail(400, { message: 'Invalid adjustment' });
		}
		updateSleep(id, { [field]: time });
		return { logged: 'adjusted' as const };
	}
};
