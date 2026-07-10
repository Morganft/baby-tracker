/**
 * Assemble today's live projection from the active template, settings, and the
 * DB-grouped day. Server-only (reads via the query layer); shared by the "Right
 * now" home and the Today timeline so both re-anchor identically on every log.
 */
import { getActiveTemplate } from './templates';
import { getSettings } from './settings';
import { assembleDay } from './sleeps';
import { project } from '$lib/projection/project';
import type { Projection } from '$lib/projection/types';

/** Build the projection for `now` in `timeZone` from the active template + DB. */
export function buildProjection(now: number, timeZone: string): Projection {
	const template = getActiveTemplate();
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
