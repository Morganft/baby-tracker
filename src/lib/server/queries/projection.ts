/**
 * Assemble today's live projection from the active template, settings, and the
 * DB-grouped day. Server-only (reads via the query layer); shared by the "Right
 * now" home and the Today timeline so both re-anchor identically on every log.
 */
import { getActiveTemplate } from './templates';
import { getDayOverride } from './dayOverride';
import { localDateKey } from './day';
import { getSettings } from './settings';
import { getBaby } from './baby';
import { assembleDay } from './sleeps';
import { project } from '$lib/projection/project';
import { planBedtime } from '$lib/projection/planBedtime';
import { ageMonthsFromBirthDate } from '$lib/advice/reference';
import type { Projection } from '$lib/projection/types';

/**
 * Build the projection for `now` in `timeZone`. Uses today's per-day plan overlay
 * when one exists (REQUIREMENTS §5.3.6), else the persistent active template —
 * either way the active slot is never mutated and the overlay expires with its day.
 */
export function buildProjection(now: number, timeZone: string): Projection {
	// A per-day overlay reshapes just today; absent one, the active slot drives the day.
	const override = getDayOverride(localDateKey(now, timeZone));
	const template = override ?? getActiveTemplate();
	const settings = getSettings();
	const baby = getBaby();
	const ageMonths = baby.birthDate ? ageMonthsFromBirthDate(baby.birthDate, now) : null;
	const { sleeps, morningWake } = assembleDay(now, timeZone);
	// The soft target bedtime is the plan's *own* cascaded bedtime (reference wake +
	// wake windows + nap durations), so the projection always steers toward the
	// bedtime the plan draws — never a separately-stored value that could diverge.
	// A per-day overlay ("Adjusted for today") deliberately keeps the legacy sliding
	// cascade (null target) so hand-shaping the tail sticks instead of redistributing.
	const targetBedtime = override
		? null
		: planBedtime(template.referenceWakeTime, template.wakeWindows, template.expectedNapDurations);
	const projection = project({
		now,
		timeZone,
		template: {
			// The active plan's own wake time anchors the day before an actual morning
			// wake is logged.
			referenceWakeTime: template.referenceWakeTime,
			napCount: template.napCount,
			wakeWindows: template.wakeWindows,
			expectedNapDurations: template.expectedNapDurations,
			targetBedtime,
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
		morningWake,
		ageMonths
	});
	// The advice system is opt-out via settings; when disabled, drop the in-day
	// nudges so the Home card never renders (projection math is unaffected).
	if (!settings.adviceEnabled) projection.advice = [];
	return projection;
}
