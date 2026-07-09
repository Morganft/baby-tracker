/**
 * "Today" timeline: today's sleeps laid out on a day view, planned (projected)
 * vs. actual (completed / in-progress). Read-only — logging happens on the home
 * screen; this re-uses the same server-side projection so the two never diverge.
 */
import { getActiveTemplate } from '$lib/server/queries/templates';
import { getSettings } from '$lib/server/queries/settings';
import { buildProjection } from '$lib/server/queries/projection';
import { serverTimeZone } from '$lib/server/api/validate';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	const now = Date.now();
	const timeZone = serverTimeZone();
	const settings = getSettings();
	const template = getActiveTemplate();
	return {
		now,
		timeZone,
		clock24h: settings.clock24h,
		templateName: template.name,
		projection: buildProjection(now, timeZone)
	};
};
