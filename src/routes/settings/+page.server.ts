/**
 * Settings: the single global preferences row (short-nap rule, clock format,
 * timezone tracking). All limits are reference/guidance only.
 */
import { getSettings, updateSettings } from '$lib/server/queries/settings';
import { parseSettingsUpdate } from '$lib/server/api/validate';
import { fail, isHttpError } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = () => ({ settings: getSettings() });

const num = (v: FormDataEntryValue | null) => Number(typeof v === 'string' ? v : NaN);

export const actions: Actions = {
	save: async ({ request }) => {
		const b = await request.formData();
		try {
			updateSettings(
				parseSettingsUpdate({
					shortNapThresholdMin: num(b.get('shortNapThresholdMin')),
					shortNapReductionPercent: num(b.get('shortNapReductionPercent')),
					dayStartTime: String(b.get('dayStartTime') ?? ''),
					// Unchecked checkboxes are absent from the form data.
					clock24h: b.get('clock24h') === 'on',
					trackTimezone: b.get('trackTimezone') === 'on'
				})
			);
		} catch (e) {
			if (isHttpError(e)) return fail(e.status, { message: String(e.body.message) });
			throw e;
		}
		return { ok: true };
	}
};
