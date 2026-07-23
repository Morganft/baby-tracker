/**
 * Pure orchestration for planning advice (System B): turn raw day entries over a
 * set of calendar days into `PlanStats` and ranked `PlanAdvice`. Kept DB-free (it
 * only uses the pure grouping/projection helpers) so it is fully unit-testable;
 * `queries/planAdvice.ts` is the thin wrapper that supplies the DB reads.
 */
import { groupDayForKey, completedProjection, type DayEntry } from '$lib/server/queries/day';
import { resolveClockTime } from '$lib/projection/time';
import type { Projection } from '$lib/projection/types';
import type { TemplateInput } from '$lib/server/api/validate';
import { computePlanStats } from './stats';
import { advisePlan } from './plan';
import { referenceForAge } from './reference';
import type { PlanStats, PlanAdvice } from './types';

/**
 * Build a completed-day `Projection` for each `dayKey` from the shared entry list.
 * The fallback anchor (used only for a day with neither a logged morning wake nor
 * a nap) is a wall-clock 'HH:MM' — the caller passes the plan's own wake time,
 * falling back to the global day-start.
 */
export function buildDayProjections(
	entries: DayEntry[],
	dayKeys: string[],
	timeZone: string,
	shortNapThresholdMin: number,
	dayStartTime: string
): Projection[] {
	return dayKeys.map((key) => {
		const grouping = groupDayForKey(entries, key, timeZone);
		const [y, m, d] = key.split('-').map(Number);
		// Midday of the target day is a stable reference for resolving the local
		// day-start clock time regardless of the zone's UTC offset.
		const fallbackAnchor = resolveClockTime(
			dayStartTime || '07:00',
			Date.UTC(y, m - 1, d, 12),
			timeZone
		);
		return completedProjection(grouping, shortNapThresholdMin, fallbackAnchor);
	});
}

export interface PlanAdviceResult {
	advice: PlanAdvice[];
	stats: PlanStats;
	/** Number of analysed days that carried at least some signal. */
	dayCount: number;
}

export interface AnalysePlanParams {
	entries: DayEntry[];
	dayKeys: string[];
	timeZone: string;
	shortNapThresholdMin: number;
	dayStartTime: string;
	template: TemplateInput;
	/** Fractional age in months, or null when no birth date is set. */
	ageMonths?: number | null;
}

export function analysePlan(params: AnalysePlanParams): PlanAdviceResult {
	const days = buildDayProjections(
		params.entries,
		params.dayKeys,
		params.timeZone,
		params.shortNapThresholdMin,
		params.dayStartTime
	);
	const stats = computePlanStats(days, params.timeZone);
	const ref = params.ageMonths != null ? referenceForAge(params.ageMonths) : null;
	const advice = advisePlan(stats, params.template, ref);
	return { advice, stats, dayCount: stats.dayCount };
}
