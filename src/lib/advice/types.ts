/**
 * Shared types for the planning-advice engine (System B). Pure — no DB, no
 * SvelteKit. `TemplateInput` is imported type-only so nothing runtime leaks in.
 */
import type { TemplateInput } from '$lib/server/api/validate';

/**
 * Aggregate statistics over a window of recent, completed days. Per-position
 * arrays are indexed by nap slot (0 = first nap …); a slot with no valid
 * samples holds `null`. Clock fields are minutes-of-day in the analysed zone.
 * All durations are whole minutes. Outliers are filtered before aggregation.
 */
export interface PlanStats {
	/** Number of days that contributed at least some signal. */
	dayCount: number;
	/** Median actual wake window leading into each nap, per position. */
	napWindowMedian: (number | null)[];
	/** Sample size behind each `napWindowMedian` entry. */
	napWindowSamples: number[];
	/** Median actual duration of each nap, per position. */
	napDurationMedian: (number | null)[];
	/** Sample size behind each `napDurationMedian` entry. */
	napDurationSamples: number[];
	/** Median wake window before bedtime (the last window of the day). */
	bedtimeWindowMedian: number | null;
	/** Sample size behind `bedtimeWindowMedian`. */
	bedtimeWindowSamples: number;
	/** Most frequent daily nap count across the window. */
	modalNapCount: number | null;
	/** Median night-sleep length. */
	nightLengthMedian: number | null;
	/** Median bedtime, minutes-of-day. */
	bedtimeMedian: number | null;
	/** Median morning wake, minutes-of-day. */
	morningWakeMedian: number | null;
	/** Fraction of naps at/under the short-nap threshold, 0..1. */
	shortNapRate: number | null;
	/** Median total daytime (nap) sleep per day. */
	daytimeTotalMedian: number | null;
}

/** One piece of planning advice, optionally carrying a one-tap template patch. */
export interface PlanAdvice {
	id: string;
	severity: 'info' | 'warn';
	confidence: 'low' | 'medium' | 'high';
	title: string;
	detail: string;
	/** Concrete edit to merge into the active template; absent for info-only. */
	patch?: Partial<TemplateInput>;
}
