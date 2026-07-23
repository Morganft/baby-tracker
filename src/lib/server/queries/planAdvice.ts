/**
 * Server-only entry point for planning advice: read the last N complete local
 * days of sleep, the active template and the (optional) baby age, then hand off
 * to the pure `analysePlan` engine. All the analysis lives in `$lib/advice` so
 * this layer is just DB plumbing.
 */
import { readDayEntries } from './sleeps';
import { getSettings } from './settings';
import { getActiveTemplate } from './templates';
import { getBaby } from './baby';
import { localDateKey, shiftDateKey } from './day';
import { ageMonthsFromBirthDate } from '$lib/advice/reference';
import { analysePlan, type PlanAdviceResult } from '$lib/advice/analyse';

const DEFAULT_WINDOW_DAYS = 14;

/**
 * Compute planning advice as of `now` in `timeZone`. Analyses the `windowDays`
 * calendar days *before* today (today is still in progress, so it's excluded).
 */
export function getPlanAdvice(
	now: number,
	timeZone: string,
	windowDays = DEFAULT_WINDOW_DAYS
): PlanAdviceResult {
	const todayKey = localDateKey(now, timeZone);
	const dayKeys = Array.from({ length: windowDays }, (_, i) => shiftDateKey(todayKey, -(i + 1)));
	const settings = getSettings();
	const template = getActiveTemplate();
	const baby = getBaby();
	const ageMonths = baby.birthDate ? ageMonthsFromBirthDate(baby.birthDate, now) : null;

	return analysePlan({
		entries: readDayEntries(),
		dayKeys,
		timeZone,
		shortNapThresholdMin: settings.shortNapThresholdMin,
		// The plan's own wake time anchors an empty/bedtime-only historical day;
		// the global day-start is only the fallback (mirrors the live projection).
		dayStartTime: template.referenceWakeTime || settings.dayStartTime,
		template,
		ageMonths
	});
}
