/**
 * "Today" timeline: today's sleeps laid out on a day view, planned (projected)
 * vs. actual (completed / in-progress). Read-only — logging happens on the home
 * screen; this re-uses the same server-side projection so the two never diverge.
 */
import { getActiveTemplate } from '$lib/server/queries/templates';
import { getSettings } from '$lib/server/queries/settings';
import { listEntryZones } from '$lib/server/queries/sleeps';
import { buildProjection } from '$lib/server/queries/projection';
import { resolveDisplayZone } from '$lib/server/api/validate';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ cookies }) => {
	const now = Date.now();
	const settings = getSettings();
	const timeZone = resolveDisplayZone(cookies.get('tz'));
	const template = getActiveTemplate();
	return {
		now,
		timeZone,
		clock24h: settings.clock24h,
		templateName: template.name,
		// id → captured zones, to flag a logged block whose zone differs from today's.
		entryZones: listEntryZones(),
		projection: buildProjection(now, timeZone)
	};
};
