import { describe, it, expect } from 'vitest';
import { computePlanStats } from './stats';
import { groupDayForKey, completedProjection, type DayEntry } from '$lib/server/queries/day';
import type { Projection } from '$lib/projection/types';

const U = (y: number, mo: number, d: number, h: number, mi = 0) => Date.UTC(y, mo - 1, d, h, mi);
const SHORT_NAP = 30;

/** Build a completed-day projection for `dayKey` (UTC) from raw entries. */
function day(dayKey: string, entries: DayEntry[]): Projection {
	const grouping = groupDayForKey(entries, dayKey, 'UTC');
	// fallbackAnchor only matters when there's no morning wake / nap; use 07:00.
	const [y, m, d] = dayKey.split('-').map(Number);
	return completedProjection(grouping, SHORT_NAP, U(y, m, d, 7));
}

/** A tidy day: wake 07:00, two naps, bedtime 19:00, night to 07:00 next day. */
function tidyDay(dayKey: string): DayEntry[] {
	const [y, m, d] = dayKey.split('-').map(Number);
	return [
		// last night ends this morning at 07:00
		{ id: `${dayKey}-n0`, type: 'night', start: U(y, m, d - 1, 19), end: U(y, m, d, 7) },
		{ id: `${dayKey}-nap1`, type: 'nap', start: U(y, m, d, 9), end: U(y, m, d, 10) }, // 60m, ww 120
		{ id: `${dayKey}-nap2`, type: 'nap', start: U(y, m, d, 13), end: U(y, m, d, 14) }, // 60m, ww 180
		{ id: `${dayKey}-night`, type: 'night', start: U(y, m, d, 19), end: U(y, m, d + 1, 7) } // 720m
	];
}

describe('computePlanStats', () => {
	it('computes per-position medians, modal nap count and clock times', () => {
		const days = [tidyDay('2026-07-10'), tidyDay('2026-07-11'), tidyDay('2026-07-12')].map(
			(entries, i) => day(`2026-07-1${i}`, entries)
		);
		const stats = computePlanStats(days, 'UTC');

		expect(stats.dayCount).toBe(3);
		expect(stats.modalNapCount).toBe(2);
		expect(stats.napWindowMedian).toEqual([120, 180]);
		expect(stats.napWindowSamples).toEqual([3, 3]);
		expect(stats.napDurationMedian).toEqual([60, 60]);
		expect(stats.daytimeTotalMedian).toBe(120);
		expect(stats.nightLengthMedian).toBe(720);
		expect(stats.bedtimeMedian).toBe(19 * 60); // 19:00
		expect(stats.morningWakeMedian).toBe(7 * 60); // 07:00
		expect(stats.bedtimeWindowMedian).toBe(300); // 14:00 -> 19:00 = 5h
		expect(stats.shortNapRate).toBe(0);
	});

	it('filters a corrupt overlapping night (>16h) out of night stats', () => {
		const good = day('2026-07-10', tidyDay('2026-07-10'));
		// A bedtime that "ends" ~5.6 days later — the corrupt-overlap case from the plan.
		const corruptEntries: DayEntry[] = [
			{ id: 'c-n0', type: 'night', start: U(2026, 7, 15, 19), end: U(2026, 7, 16, 7) },
			{ id: 'c-nap1', type: 'nap', start: U(2026, 7, 16, 9), end: U(2026, 7, 16, 10) },
			{ id: 'c-night', type: 'night', start: U(2026, 7, 16, 19), end: U(2026, 7, 22, 8) } // 8080m
		];
		const corrupt = day('2026-07-16', corruptEntries);
		const stats = computePlanStats([good, corrupt], 'UTC');

		// Only the good night counts; the 8080-min night is dropped.
		expect(stats.nightLengthMedian).toBe(720);
		// The corrupt day still contributes its valid nap and morning wake.
		expect(stats.napWindowSamples[0]).toBe(2);
	});

	it('reports the short-nap rate from the tooShort flag', () => {
		const [y, m, d] = [2026, 7, 10];
		const entries: DayEntry[] = [
			{ id: 'n0', type: 'night', start: U(y, m, d - 1, 19), end: U(y, m, d, 7) },
			{ id: 'nap1', type: 'nap', start: U(y, m, d, 9), end: U(y, m, d, 9, 20) }, // 20m -> short
			{ id: 'nap2', type: 'nap', start: U(y, m, d, 13), end: U(y, m, d, 14) }, // 60m
			{ id: 'night', type: 'night', start: U(y, m, d, 19), end: U(y, m, d + 1, 7) }
		];
		const stats = computePlanStats([day('2026-07-10', entries)], 'UTC');
		expect(stats.shortNapRate).toBeCloseTo(0.5, 5);
	});

	it('ignores fully unlogged days when computing the daytime-total median', () => {
		// Three tidy days (120 min of day sleep each) plus four empty window days.
		const logged = [tidyDay('2026-07-10'), tidyDay('2026-07-11'), tidyDay('2026-07-12')].map(
			(entries, i) => day(`2026-07-1${i}`, entries)
		);
		const empty = ['2026-07-20', '2026-07-21', '2026-07-22', '2026-07-23'].map((k) => day(k, []));
		const stats = computePlanStats([...logged, ...empty], 'UTC');
		// Empty days contribute no spurious 0s: only the 3 logged days count.
		expect(stats.dayCount).toBe(3);
		expect(stats.daytimeTotalMedian).toBe(120);
	});

	it('returns empty-safe stats for no days', () => {
		const stats = computePlanStats([], 'UTC');
		expect(stats.dayCount).toBe(0);
		expect(stats.modalNapCount).toBeNull();
		expect(stats.nightLengthMedian).toBeNull();
		expect(stats.shortNapRate).toBeNull();
		expect(stats.napWindowMedian).toEqual([]);
	});
});
