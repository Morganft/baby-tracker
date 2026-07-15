/**
 * Assemble today's live projection from the active template, settings, and the
 * DB-grouped day. Server-only (reads via the query layer); shared by the "Right
 * now" home and the Today timeline so both re-anchor identically on every log.
 */
import { getActiveTemplate } from './templates';
import { getDayOverride } from './dayOverride';
import { localDateKey } from './day';
import { getSettings } from './settings';
import { assembleDay } from './sleeps';
import { project } from '$lib/projection/project';
import type { Projection } from '$lib/projection/types';

/**
 * Build the projection for `now` in `timeZone`. Uses today's per-day plan overlay
 * when one exists (REQUIREMENTS §5.3.6), else the persistent active template —
 * either way the active slot is never mutated and the overlay expires with its day.
 */
export function buildProjection(now: number, timeZone: string): Projection {
	// A per-day overlay reshapes just today; absent one, the active slot drives the day.
	const template = getDayOverride(localDateKey(now, timeZone)) ?? getActiveTemplate();
	const settings = getSettings();
	const { sleeps, morningWake } = assembleDay(now, timeZone);
	return project({
		now,
		timeZone,
		template: {
			// The global day-start time is the projection's default anchor before an
			// actual morning wake is logged; it overrides the template's own value.
			referenceWakeTime: settings.dayStartTime || template.referenceWakeTime,
			napCount: template.napCount,
			wakeWindows: template.wakeWindows,
			expectedNapDurations: template.expectedNapDurations,
			targetBedtime: template.targetBedtime,
			wakeWindowMin: template.wakeWindowMin ?? undefined,
			wakeWindowMax: template.wakeWindowMax ?? undefined,
			napDurationMin: template.napDurationMin ?? undefined,
			napDurationMax: template.napDurationMax ?? undefined,
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
