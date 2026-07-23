import { describe, it, expect } from 'vitest';
import { analysePlan, buildDayProjections } from './analyse';
import { type DayEntry } from '$lib/server/queries/day';
import type { TemplateInput } from '$lib/server/api/validate';

const U = (y: number, mo: number, d: number, h: number, mi = 0) => Date.UTC(y, mo - 1, d, h, mi);

const template: TemplateInput = {
	name: 't',
	referenceWakeTime: '07:00',
	napCount: 3, // plan expects 3 naps, but the data below has 2
	wakeWindows: [120, 135, 150, 165],
	expectedNapDurations: [60, 90, 45],
	dailyTotalSleepTarget: 840,
	daytimeCap: 195,
	bedtimeStart: '19:00',
	bedtimeEnd: '19:30',
	targetBedtime: '19:00',
	wakeWindowMin: [60, 60, 60, 60],
	wakeWindowMax: [240, 240, 240, 240],
	napDurationMin: [10, 10, 10],
	napDurationMax: [180, 180, 180]
};

/** A tidy 2-nap day for `dayKey` (UTC): wake 07:00, naps 09–10 & 13–14, bed 19:00. */
function tidyTwoNapDay(dayKey: string): DayEntry[] {
	const [y, m, d] = dayKey.split('-').map(Number);
	return [
		{ id: `${dayKey}-n0`, type: 'night', start: U(y, m, d - 1, 19), end: U(y, m, d, 7) },
		{ id: `${dayKey}-nap1`, type: 'nap', start: U(y, m, d, 9), end: U(y, m, d, 10) },
		{ id: `${dayKey}-nap2`, type: 'nap', start: U(y, m, d, 13), end: U(y, m, d, 14) },
		{ id: `${dayKey}-night`, type: 'night', start: U(y, m, d, 19), end: U(y, m, d + 1, 7) }
	];
}

const sixDayKeys = [
	'2026-07-08',
	'2026-07-09',
	'2026-07-10',
	'2026-07-11',
	'2026-07-12',
	'2026-07-13'
];
const sixDaysEntries = sixDayKeys.flatMap(tidyTwoNapDay);

describe('analysePlan', () => {
	it('detects a nap-count mismatch across the analysed window', () => {
		const result = analysePlan({
			entries: sixDaysEntries,
			dayKeys: sixDayKeys,
			timeZone: 'UTC',
			shortNapThresholdMin: 30,
			morningAnchor: '07:00',
			template
		});
		expect(result.dayCount).toBe(6);
		expect(result.stats.modalNapCount).toBe(2);
		const napCount = result.advice.find((a) => a.id === 'nap-count');
		expect(napCount).toBeDefined();
		expect(napCount?.patch?.napCount).toBe(2);
	});

	it('ignores entries outside the analysed day keys', () => {
		// A stray day far in the past must not inflate dayCount or the stats.
		const withStray = [...sixDaysEntries, ...tidyTwoNapDay('2026-06-01')];
		const result = analysePlan({
			entries: withStray,
			dayKeys: sixDayKeys,
			timeZone: 'UTC',
			shortNapThresholdMin: 30,
			morningAnchor: '07:00',
			template
		});
		expect(result.dayCount).toBe(6);
	});

	it('adds age-band advice only when an age is supplied', () => {
		const base = {
			entries: sixDaysEntries,
			dayKeys: sixDayKeys,
			timeZone: 'UTC',
			shortNapThresholdMin: 30,
			morningAnchor: '07:00',
			template
		};
		const withoutAge = analysePlan(base);
		const withAge = analysePlan({ ...base, ageMonths: 2 }); // 1.5–3mo band
		expect(withoutAge.advice.some((a) => a.id.startsWith('age-'))).toBe(false);
		expect(withAge.advice.some((a) => a.id.startsWith('age-'))).toBe(true);
	});

	it('returns empty-safe results for a window with no entries', () => {
		const result = analysePlan({
			entries: [],
			dayKeys: sixDayKeys,
			timeZone: 'UTC',
			shortNapThresholdMin: 30,
			morningAnchor: '07:00',
			template
		});
		expect(result.dayCount).toBe(0);
		expect(result.advice).toEqual([]);
	});
});

describe('buildDayProjections', () => {
	it('builds one completed projection per day key with real wake gaps', () => {
		const days = buildDayProjections(sixDaysEntries, sixDayKeys, 'UTC', 30, '07:00');
		expect(days).toHaveLength(6);
		const naps = days[0].sleeps.filter((s) => s.type === 'nap');
		expect(naps).toHaveLength(2);
		expect(naps[0].wakeWindowBeforeMin).toBe(120); // 07:00 -> 09:00
	});
});
