/**
 * "Today" timeline: today's sleeps laid out on a day view, planned (projected)
 * vs. actual (completed / in-progress). Sleeps are directly editable here —
 * tapping a logged nap/bedtime/overnight edits it, tapping a planned one logs a
 * new sleep — via the same validation + query layer the Home and History screens
 * use, so the projection (re-run in `load` on every mutation) never diverges.
 */
import {
	createSleep,
	updateSleep,
	deleteSleep,
	listSleeps,
	listEntryZones,
	assembleDay,
	type SleepDTO
} from '$lib/server/queries/sleeps';
import { getSettings } from '$lib/server/queries/settings';
import { getActiveTemplate } from '$lib/server/queries/templates';
import { buildProjection } from '$lib/server/queries/projection';
import {
	parseSleepCreate,
	parseSleepUpdate,
	resolveDisplayZone,
	resolveEntryTimezone
} from '$lib/server/api/validate';
import { resolveClockTime, resolveLocalDateTime } from '$lib/projection/time';
import { fail, isHttpError } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

const DAY_MS = 86_400_000;

/**
 * A prefill for logging last night's sleep when the overnight block is only
 * planned: it ends at the projected morning wake (the block's anchor) and starts
 * at last night's target bedtime — this evening's target rolled back a day, or a
 * plain 12h before the wake when no target bedtime is set.
 */
function overnightDraftFor(
	targetBedtime: string | null | undefined,
	anchor: number,
	timeZone: string
): { start: number; end: number } {
	const start = targetBedtime
		? resolveClockTime(targetBedtime, anchor, timeZone) - DAY_MS
		: anchor - 12 * 3_600_000;
	return { start, end: anchor };
}

export const load: PageServerLoad = ({ cookies }) => {
	const now = Date.now();
	const settings = getSettings();
	const timeZone = resolveDisplayZone(cookies.get('tz'));
	const template = getActiveTemplate();
	const projection = buildProjection(now, timeZone);
	// The entry the overnight block stands for (last night's sleep), so tapping it
	// edits that sleep instead of logging a duplicate. From the same grouping the
	// projection uses, so the two never disagree about which entry that is.
	const { overnightEntryId } = assembleDay(now, timeZone);

	// The logged entries the timeline shows, keyed by id, so tapping a block can
	// prefill the edit popup with its full details (location/put-down/notes) — which
	// the pure projection's `ProjectedSleep` deliberately doesn't carry.
	const shownIds = new Set(projection.sleeps.map((s) => s.entryId).filter(Boolean));
	if (overnightEntryId) shownIds.add(overnightEntryId);
	const entries: Record<string, SleepDTO> = {};
	for (const e of listSleeps()) if (shownIds.has(e.id)) entries[e.id] = e;

	return {
		now,
		timeZone,
		clock24h: settings.clock24h,
		templateName: template.name,
		// id → captured zones, to flag a logged block whose zone differs from today's.
		entryZones: listEntryZones(),
		entries,
		overnightEntryId,
		overnightDraft: overnightDraftFor(template.targetBedtime, projection.anchor, timeZone),
		projection
	};
};

/** Turn a thrown SvelteKit `error()` from validation into an action `fail`. */
function failFromValidation(e: unknown) {
	if (isHttpError(e)) return fail(e.status, { message: String(e.body.message) });
	throw e;
}

const s = (v: FormDataEntryValue | null) => (typeof v === 'string' ? v : '');

/**
 * Resolve the start/end wall-clock inputs against their submitted zones. A blank
 * start yields `startTime: null` (rather than throwing on an empty string) so the
 * caller can return a clean 400; a blank end means in-progress.
 */
function resolveTimes(b: FormData) {
	const startTimezone = resolveEntryTimezone(b.get('startTimezone'));
	const endTimezone = resolveEntryTimezone(b.get('endTimezone'));
	const startLocal = s(b.get('startLocal'));
	const endLocal = s(b.get('endLocal'));
	const startTime = startLocal ? resolveLocalDateTime(startLocal, startTimezone) : null;
	const endTime = endLocal ? resolveLocalDateTime(endLocal, endTimezone) : null;
	return { startTimezone, endTimezone, startTime, endTime };
}

export const actions: Actions = {
	/** Log a new sleep (from tapping a planned nap). */
	create: async ({ request }) => {
		const b = await request.formData();
		const { startTimezone, endTimezone, startTime, endTime } = resolveTimes(b);
		if (startTime == null) return fail(400, { message: 'Start time is required' });
		if (endTime != null && endTime < startTime) {
			return fail(400, { message: 'End time must be after start time' });
		}
		try {
			createSleep(
				parseSleepCreate({
					startTime,
					endTime,
					startTimezone,
					endTimezone: endTime == null ? null : endTimezone,
					type: s(b.get('type')),
					location: s(b.get('location')) || null,
					putDown: s(b.get('putDown')) || null,
					notes: s(b.get('notes')) || null
				})
			);
		} catch (e) {
			return failFromValidation(e);
		}
		return { ok: true };
	},

	/** Edit a logged sleep (from tapping an actual nap). */
	edit: async ({ request }) => {
		const b = await request.formData();
		const id = s(b.get('id'));
		const { startTimezone, endTimezone, startTime, endTime } = resolveTimes(b);
		if (!id || startTime == null) return fail(400, { message: 'Missing required fields' });
		if (endTime != null && endTime < startTime) {
			return fail(400, { message: 'End time must be after start time' });
		}
		try {
			const patch = parseSleepUpdate({
				startTime,
				endTime,
				startTimezone,
				endTimezone: endTime == null ? null : endTimezone,
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

	/** Delete a logged sleep. */
	delete: async ({ request }) => {
		const id = s((await request.formData()).get('id'));
		if (!id || !deleteSleep(id)) return fail(404, { message: 'Entry not found' });
		return { ok: true };
	}
};
