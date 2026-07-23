/**
 * Plan (templates): the active slot that drives the projection, plus the user's
 * template library. Domain rule (REQUIREMENTS §4): editing the active slot never
 * mutates the library; loading a library template copies it into the slot; saving
 * to the library is an explicit, separate action (new entry, or overwrite).
 */
import {
	getActiveTemplate,
	updateActiveTemplate,
	loadActiveTemplate,
	listTemplates,
	createTemplate,
	updateTemplate,
	deleteTemplate,
	type ActiveTemplateDTO
} from '$lib/server/queries/templates';
import { getSettings } from '$lib/server/queries/settings';
import { getPlanAdvice } from '$lib/server/queries/planAdvice';
import { parseTemplate, resolveDisplayZone, type TemplateInput } from '$lib/server/api/validate';
import { fail, isHttpError } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ cookies }) => {
	const timeZone = resolveDisplayZone(cookies.get('tz'));
	const settings = getSettings();
	return {
		active: getActiveTemplate(),
		library: listTemplates(),
		// Reference-preview honours the 12/24h display preference like the other views.
		clock24h: settings.clock24h,
		// Data-driven suggestions for the active plan (last ~2 weeks). Read-only here;
		// applying one goes through the `applyAdvice` action, which re-derives them.
		// Suppressed entirely when the advice system is switched off in settings.
		planAdvice: settings.adviceEnabled ? getPlanAdvice(Date.now(), timeZone).advice : []
	};
};

const s = (v: FormDataEntryValue | null) => (typeof v === 'string' ? v : '');
const numOrNull = (v: FormDataEntryValue | null) => {
	const t = s(v).trim();
	return t === '' ? null : Number(t);
};

/** Parse comma-separated minutes into a number[] (empty entries dropped). */
function csv(v: FormDataEntryValue | null): number[] {
	return s(v)
		.split(',')
		.map((t) => t.trim())
		.filter((t) => t.length > 0)
		.map(Number);
}

/** Like `csv`, but an all-empty field becomes null (bounds are optional). */
function csvOrNull(v: FormDataEntryValue | null): number[] | null {
	const arr = csv(v);
	return arr.length > 0 ? arr : null;
}

/** Build + validate a TemplateInput from the active-slot editor form. */
function templateFromForm(b: FormData): TemplateInput {
	return parseTemplate({
		name: s(b.get('name')),
		referenceWakeTime: s(b.get('referenceWakeTime')),
		napCount: Number(s(b.get('napCount'))),
		wakeWindows: csv(b.get('wakeWindows')),
		expectedNapDurations: csv(b.get('expectedNapDurations')),
		dailyTotalSleepTarget: numOrNull(b.get('dailyTotalSleepTarget')),
		daytimeCap: numOrNull(b.get('daytimeCap')),
		bedtimeStart: s(b.get('bedtimeStart')) || null,
		bedtimeEnd: s(b.get('bedtimeEnd')) || null,
		// The bedtime is defined by the plan's shape (reference wake + windows + naps)
		// and derived at projection time — there's no separately-stored target to keep.
		targetBedtime: null,
		wakeWindowMin: csvOrNull(b.get('wakeWindowMin')),
		wakeWindowMax: csvOrNull(b.get('wakeWindowMax')),
		napDurationMin: csvOrNull(b.get('napDurationMin')),
		napDurationMax: csvOrNull(b.get('napDurationMax'))
	});
}

/** The template columns of the (persisted) active slot, for saving to the library. */
function activeColumns(a: ActiveTemplateDTO): TemplateInput {
	return {
		name: a.name,
		referenceWakeTime: a.referenceWakeTime,
		napCount: a.napCount,
		wakeWindows: a.wakeWindows,
		expectedNapDurations: a.expectedNapDurations,
		dailyTotalSleepTarget: a.dailyTotalSleepTarget,
		daytimeCap: a.daytimeCap,
		bedtimeStart: a.bedtimeStart,
		bedtimeEnd: a.bedtimeEnd,
		targetBedtime: a.targetBedtime,
		wakeWindowMin: a.wakeWindowMin,
		wakeWindowMax: a.wakeWindowMax,
		napDurationMin: a.napDurationMin,
		napDurationMax: a.napDurationMax
	};
}

function failFromValidation(e: unknown) {
	if (isHttpError(e)) return fail(e.status, { message: String(e.body.message) });
	throw e;
}

export const actions: Actions = {
	/** Edit the active slot in place. Never touches the library. */
	editActive: async ({ request }) => {
		try {
			updateActiveTemplate(templateFromForm(await request.formData()));
		} catch (e) {
			return failFromValidation(e);
		}
		return { ok: true, message: 'Active plan updated' };
	},

	/** Load a library template into the active slot (copies it). */
	load: async ({ request }) => {
		const id = s((await request.formData()).get('templateId'));
		if (!id || !loadActiveTemplate(id)) return fail(404, { message: 'Template not found' });
		return { ok: true, message: 'Loaded into active plan' };
	},

	/** Save the current active slot to the library as a new named entry. */
	saveNew: async ({ request }) => {
		const name = s((await request.formData()).get('name')).trim();
		if (!name) return fail(400, { message: 'Name is required' });
		createTemplate({ ...activeColumns(getActiveTemplate()), name });
		return { ok: true, message: `Saved “${name}” to library` };
	},

	/** Overwrite an existing library template with the current active slot. */
	overwrite: async ({ request }) => {
		const id = s((await request.formData()).get('templateId'));
		if (!id || !updateTemplate(id, activeColumns(getActiveTemplate()))) {
			return fail(404, { message: 'Template not found' });
		}
		return { ok: true, message: 'Library template overwritten' };
	},

	/** Delete a library template. */
	delete: async ({ request }) => {
		const id = s((await request.formData()).get('templateId'));
		if (!id || !deleteTemplate(id)) return fail(404, { message: 'Template not found' });
		return { ok: true, message: 'Template deleted' };
	},

	/**
	 * Apply one piece of planning advice to the active slot. The client sends only
	 * the advice `id`; the server re-derives the current advice, looks up that id,
	 * merges its `patch` into the active columns and re-validates — so a stale or
	 * forged patch can never reach the DB.
	 */
	applyAdvice: async ({ request, cookies }) => {
		const id = s((await request.formData()).get('adviceId'));
		if (!id) return fail(400, { message: 'Missing advice id' });
		// With advice switched off there is nothing to apply — reject rather than
		// re-derive suggestions the user has opted out of.
		if (!getSettings().adviceEnabled) return fail(409, { message: 'Advice is turned off' });
		const timeZone = resolveDisplayZone(cookies.get('tz'));
		const advice = getPlanAdvice(Date.now(), timeZone).advice.find((a) => a.id === id);
		if (!advice) return fail(409, { message: 'That advice no longer applies' });
		if (!advice.patch) return fail(400, { message: 'This advice has nothing to apply' });
		try {
			updateActiveTemplate(
				parseTemplate({ ...activeColumns(getActiveTemplate()), ...advice.patch })
			);
		} catch (e) {
			return failFromValidation(e);
		}
		return { ok: true, message: 'Applied advice to the active plan' };
	}
};
