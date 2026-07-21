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
	assembleDayForKey,
	type SleepDTO
} from '$lib/server/queries/sleeps';
import { getSettings } from '$lib/server/queries/settings';
import { getActiveTemplate } from '$lib/server/queries/templates';
import {
	getDayOverride,
	upsertDayOverride,
	clearDayOverride
} from '$lib/server/queries/dayOverride';
import { localDateKey, completedProjection } from '$lib/server/queries/day';
import { buildProjection } from '$lib/server/queries/projection';
import { resolveViewedDay } from '$lib/server/queries/viewedDay';
import {
	parseSleepCreate,
	parseSleepUpdate,
	parseTemplate,
	resolveDisplayZone,
	resolveEntryTimezone,
	type TemplateInput
} from '$lib/server/api/validate';
import { resolveClockTime, resolveLocalDateTime } from '$lib/projection/time';
import { fail, isHttpError, redirect } from '@sveltejs/kit';
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

export const load: PageServerLoad = ({ cookies, url }) => {
	const now = Date.now();
	const settings = getSettings();
	const timeZone = resolveDisplayZone(cookies.get('tz'));
	const template = getActiveTemplate();
	const view = resolveViewedDay(url.searchParams.get('date'), timeZone);

	// Fields common to both paths: the day-nav header + the display context. Kept a
	// stable shape so the view's `data.*` reads never diverge between today and a
	// past day.
	const base = {
		...view,
		now,
		timeZone,
		clock24h: settings.clock24h,
		templateName: template.name,
		// id → captured zones, to flag a logged block whose zone differs from today's.
		entryZones: listEntryZones()
	};

	if (view.isToday) {
		const override = getDayOverride(view.viewedDayKey);
		const projection = buildProjection(now, timeZone);
		// Whether today's forecast is running off a per-day overlay (vs. the saved plan),
		// so the view can flag it and offer a reset. `buildProjection` already applied it.
		const overrideActive = override != null;
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
			...base,
			entries,
			overnightEntryId,
			overnightDraft: overnightDraftFor(template.targetBedtime, projection.anchor, timeZone),
			overrideActive,
			// The effective plan the inline tail editor seeds from: today's overlay if one
			// exists, else the saved active plan. Raw arrays (napCount/wakeWindows/naps).
			plan: override ?? template,
			projection
		};
	}

	// Past day: only that day's actual logged sleeps, as completed blocks. No
	// projected tail, now-line, inline editor, or overlay — those are live-only.
	const grouping = assembleDayForKey(view.viewedDayKey, timeZone);
	// The morning reference for the viewed day (global day-start, else the template's
	// wake time) — the anchor fallback when no morning wake and no nap are logged, so
	// a bedtime-only (or empty) day lays out around its morning, not epoch 0 or the
	// bedtime itself. Falls back to local midnight if the reference is malformed.
	const refWake = settings.dayStartTime || template.referenceWakeTime;
	const fallbackAnchor = resolveLocalDateTime(
		`${view.viewedDayKey}T${refWake || '00:00'}`,
		timeZone
	);
	const projection = completedProjection(grouping, settings.shortNapThresholdMin, fallbackAnchor);

	const shownIds = new Set<string>(grouping.sleeps.map((s) => s.id));
	if (grouping.overnightEntryId) shownIds.add(grouping.overnightEntryId);
	const entries: Record<string, SleepDTO> = {};
	for (const e of listSleeps()) if (shownIds.has(e.id)) entries[e.id] = e;

	return {
		...base,
		entries,
		// Pass the prior night's entry so the overnight block, if rendered, edits it.
		overnightEntryId: grouping.overnightEntryId,
		// Past days have no inline plan/tail editor or overlay to seed or flag.
		overnightDraft: null,
		overrideActive: false,
		plan: null,
		projection
	};
};

/** Turn a thrown SvelteKit `error()` from validation into an action `fail`. */
function failFromValidation(e: unknown) {
	if (isHttpError(e)) return fail(e.status, { message: String(e.body.message) });
	throw e;
}

const s = (v: FormDataEntryValue | null) => (typeof v === 'string' ? v : '');

/** Parse comma-separated minutes into a number[] (empty entries dropped). */
function csv(v: FormDataEntryValue | null): number[] {
	return s(v)
		.split(',')
		.map((t) => t.trim())
		.filter((t) => t.length > 0)
		.map(Number);
}

/** Today's local date key, from the same tz cookie the projection uses. */
function todayKey(cookies: { get(name: string): string | undefined }): string {
	return localDateKey(Date.now(), resolveDisplayZone(cookies.get('tz')));
}

/**
 * Build + validate the per-day overlay from the inline editor form. `targetBedtime`
 * is always null: hand-shaping today drops the fixed-bedtime redistribution so the
 * projection runs the legacy cascade and every edit sticks (bedtime floats).
 */
function overlayFromForm(b: FormData): TemplateInput {
	return parseTemplate({
		name: s(b.get('name')) || 'Today',
		referenceWakeTime: s(b.get('referenceWakeTime')),
		napCount: Number(s(b.get('napCount'))),
		wakeWindows: csv(b.get('wakeWindows')),
		expectedNapDurations: csv(b.get('expectedNapDurations')),
		dailyTotalSleepTarget: null,
		daytimeCap: null,
		bedtimeStart: null,
		bedtimeEnd: null,
		targetBedtime: null,
		wakeWindowMin: null,
		wakeWindowMax: null,
		napDurationMin: null,
		napDurationMax: null
	});
}

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
	},

	/** Persist the inline-reshaped projected tail as today's per-day overlay. */
	saveOverlay: async ({ request, cookies }) => {
		try {
			upsertDayOverride(todayKey(cookies), overlayFromForm(await request.formData()));
		} catch (e) {
			return failFromValidation(e);
		}
		return { ok: true };
	},

	/**
	 * Clear today's overlay so the forecast reverts to the saved plan. Redirect
	 * (rather than re-render) so the client doesn't re-seed and auto-save it back.
	 */
	resetOverlay: async ({ cookies }) => {
		clearDayOverride(todayKey(cookies));
		throw redirect(303, '/timeline');
	}
};
