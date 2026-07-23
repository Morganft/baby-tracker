/**
 * Settings: the single global preferences row (short-nap rule, clock format,
 * day start). All limits are reference/guidance only.
 */
import { getSettings, updateSettings } from '$lib/server/queries/settings';
import { getBaby, updateBaby } from '$lib/server/queries/baby';
import { parseSettingsUpdate, parseBabyUpdate } from '$lib/server/api/validate';
import { importData, type ImportResult } from '$lib/server/backup';
import { fail, isHttpError } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = () => ({ settings: getSettings(), baby: getBaby() });

const num = (v: FormDataEntryValue | null) => Number(typeof v === 'string' ? v : NaN);

export const actions: Actions = {
	save: async ({ request }) => {
		const b = await request.formData();
		try {
			// Validate *both* inputs before writing either, so a bad field rejects the
			// whole save rather than leaving a partial write behind.
			const settingsPatch = parseSettingsUpdate({
				shortNapThresholdMin: num(b.get('shortNapThresholdMin')),
				shortNapReductionPercent: num(b.get('shortNapReductionPercent')),
				dayStartTime: String(b.get('dayStartTime') ?? ''),
				// Unchecked checkboxes are absent from the form data.
				clock24h: b.get('clock24h') === 'on',
				adviceEnabled: b.get('adviceEnabled') === 'on'
			});
			// Optional birth date: an empty field clears it (data-only advice).
			const babyPatch = parseBabyUpdate({ birthDate: String(b.get('birthDate') ?? '') });
			updateSettings(settingsPatch);
			updateBaby(babyPatch);
		} catch (e) {
			if (isHttpError(e)) return fail(e.status, { message: String(e.body.message) });
			throw e;
		}
		return { ok: true };
	},

	import: async ({ request }) => {
		const b = await request.formData();
		const file = b.get('file');
		if (!(file instanceof File) || file.size === 0) {
			return fail(400, { importMessage: 'Choose a backup .json file to import.' });
		}
		let raw: unknown;
		try {
			raw = JSON.parse(await file.text());
		} catch {
			return fail(400, { importMessage: 'That file is not valid JSON.' });
		}
		try {
			const result = importData(raw);
			return { imported: summarizeImport(result) };
		} catch (e) {
			if (isHttpError(e)) return fail(e.status, { importMessage: String(e.body.message) });
			throw e;
		}
	}
};

/** A one-line human summary of what an import merged. */
function summarizeImport(r: ImportResult): string {
	let inserted = 0;
	let updated = 0;
	for (const c of [r.baby, r.templates, r.activeTemplate, r.sleepEntries, r.settings]) {
		inserted += c.inserted;
		updated += c.updated;
	}
	inserted += r.nightWakings.inserted;
	updated += r.nightWakings.updated;
	const parts = [`${inserted} added`, `${updated} updated`];
	if (r.nightWakings.orphaned > 0)
		parts.push(`${r.nightWakings.orphaned} wakings skipped (no parent)`);
	return `Imported: ${parts.join(', ')}.`;
}
