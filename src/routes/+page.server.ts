/**
 * "Right now" home. The load computes today's live projection server-side, so it
 * re-anchors on every log; the quick-log form actions write via the query layer
 * and let SvelteKit re-run the load (progressive enhancement — works without JS).
 */
import { getActiveTemplate } from '$lib/server/queries/templates';
import { getSettings } from '$lib/server/queries/settings';
import { assembleDay, getActiveSleep, createSleep, updateSleep } from '$lib/server/queries/sleeps';
import { serverTimeZone } from '$lib/server/api/validate';
import { project } from '$lib/projection/project';
import type { Projection } from '$lib/projection/types';
import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

/** Assemble the projection for `now` in `timeZone` from the active template + DB. */
function buildProjection(now: number, timeZone: string): Projection {
	const template = getActiveTemplate();
	const settings = getSettings();
	const { sleeps, morningWake } = assembleDay(now, timeZone);
	return project({
		now,
		timeZone,
		template: {
			referenceWakeTime: template.referenceWakeTime,
			napCount: template.napCount,
			wakeWindows: template.wakeWindows,
			expectedNapDurations: template.expectedNapDurations,
			daytimeCap: template.daytimeCap,
			dailyTotalSleepTarget: template.dailyTotalSleepTarget
		},
		settings: {
			shortNapThresholdMin: settings.shortNapThresholdMin,
			shortNapReductionPercent: settings.shortNapReductionPercent
		},
		sleeps,
		morningWake
	});
}

export const load: PageServerLoad = () => {
	const now = Date.now();
	const timeZone = serverTimeZone();
	const template = getActiveTemplate();
	const settings = getSettings();
	const active = getActiveSleep();

	return {
		now,
		timeZone,
		clock24h: settings.clock24h,
		templateName: template.name,
		asleep: active != null,
		activeSleep: active ? { id: active.id, start: active.startTime, type: active.type } : null,
		projection: buildProjection(now, timeZone)
	};
};

export const actions: Actions = {
	/** Quick-log "fell asleep": start the next planned sleep at the current time. */
	asleep: () => {
		const now = Date.now();
		const timeZone = serverTimeZone();
		if (getActiveSleep()) return fail(409, { message: 'Already asleep' });
		const type = buildProjection(now, timeZone).nextSleep?.type ?? 'night';
		createSleep({
			startTime: now,
			endTime: null,
			timezone: timeZone,
			type,
			location: null,
			putDown: null,
			notes: null
		});
		return { logged: 'asleep' as const };
	},

	/** Quick-log "woke up": end the in-progress sleep at the current time. */
	awake: () => {
		const active = getActiveSleep();
		if (!active) return fail(409, { message: 'Not currently asleep' });
		updateSleep(active.id, { endTime: Date.now() });
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
