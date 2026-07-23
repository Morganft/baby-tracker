import { describe, it, expect } from 'vitest';
import { advisePlan } from './plan';
import { referenceForAge } from './reference';
import { parseTemplate, type TemplateInput } from '$lib/server/api/validate';
import type { PlanStats } from './types';

const template: TemplateInput = {
	name: 't',
	referenceWakeTime: '07:00',
	napCount: 3,
	wakeWindows: [120, 135, 150, 165],
	expectedNapDurations: [60, 90, 45],
	dailyTotalSleepTarget: 840,
	daytimeCap: 195,
	bedtimeStart: '19:00',
	bedtimeEnd: '19:30',
	targetBedtime: '19:00',
	wakeWindowMin: [90, 105, 120, 135],
	wakeWindowMax: [150, 165, 180, 210],
	napDurationMin: [30, 45, 20],
	napDurationMax: [90, 120, 75]
};

/** Stats whose medians all match the template, so nothing fires by default. */
function neutralStats(over: Partial<PlanStats> = {}): PlanStats {
	return {
		dayCount: 10,
		napWindowMedian: [120, 135, 150],
		napWindowSamples: [10, 10, 10],
		napDurationMedian: [60, 90, 45],
		napDurationSamples: [10, 10, 10],
		bedtimeWindowMedian: 300,
		bedtimeWindowSamples: 10,
		modalNapCount: 3,
		nightLengthMedian: 720,
		bedtimeMedian: 19 * 60,
		morningWakeMedian: 7 * 60,
		shortNapRate: 0,
		daytimeTotalMedian: 195,
		...over
	};
}

describe('advisePlan', () => {
	it('returns nothing when reality matches the plan', () => {
		expect(advisePlan(neutralStats(), template)).toEqual([]);
	});

	it('advises a wake-window change clamped to the position bounds', () => {
		const stats = neutralStats({ napWindowMedian: [150, 135, 150] }); // nap 1 drifted +30
		const advice = advisePlan(stats, template).find((a) => a.id === 'ww-0');
		expect(advice).toBeDefined();
		expect(advice?.severity).toBe('info'); // < 45 min drift
		expect(advice?.patch?.wakeWindows).toEqual([150, 135, 150, 165]);
	});

	it('flags a large wake-window drift as a warning, clamped to max', () => {
		const stats = neutralStats({ napWindowMedian: [120, 185, 150] }); // +50, clamps to 165
		const advice = advisePlan(stats, template).find((a) => a.id === 'ww-1');
		expect(advice?.severity).toBe('warn');
		expect(advice?.patch?.wakeWindows).toEqual([120, 165, 150, 165]);
	});

	it('updates an expected nap length toward the median, clamped to bounds', () => {
		const stats = neutralStats({ napDurationMedian: [60, 90, 10] }); // clamps to napDurationMin 20
		const advice = advisePlan(stats, template).find((a) => a.id === 'nap-2');
		expect(advice?.patch?.expectedNapDurations).toEqual([60, 90, 20]);
	});

	it('ignores a position without enough samples', () => {
		const stats = neutralStats({ napWindowMedian: [150, 135, 150], napWindowSamples: [2, 10, 10] });
		expect(advisePlan(stats, template).some((a) => a.id === 'ww-0')).toBe(false);
	});

	it('produces a valid structural patch for a nap-count change', () => {
		const stats = neutralStats({ modalNapCount: 2 });
		const advice = advisePlan(stats, template).find((a) => a.id === 'nap-count');
		expect(advice?.severity).toBe('warn');
		// The patch must merge into a template that passes full validation.
		const merged = parseTemplate({ ...template, ...advice?.patch });
		expect(merged.napCount).toBe(2);
		expect(merged.wakeWindows).toHaveLength(3);
		expect(merged.expectedNapDurations).toHaveLength(2);
		expect(merged.wakeWindowMin).toHaveLength(3);
	});

	it('adds low-confidence age-band notes when a birth date is set', () => {
		const ref = referenceForAge(2); // 1.5–3mo: 4–5 naps, WW 60–90
		const advice = advisePlan(neutralStats(), template, ref);
		const ids = advice.map((a) => a.id);
		expect(ids).toContain('age-nap-count'); // plan has 3, band wants 4–5
		expect(ids).toContain('age-wake-window'); // 120+ min windows exceed 90
	});

	it('does not raise age notes when the plan sits inside the band', () => {
		const ref = referenceForAge(5); // 4–6mo: 3–4 naps, WW 90–150
		const advice = advisePlan(neutralStats(), template, ref);
		expect(advice.some((a) => a.id.startsWith('age-'))).toBe(false);
	});

	it('ranks warnings ahead of informational notes', () => {
		const stats = neutralStats({ modalNapCount: 2 });
		const advice = advisePlan(stats, template, referenceForAge(2));
		expect(advice[0].severity).toBe('warn');
	});

	it('suggests dropping a nap when the last nap is frequently skipped (rule 6)', () => {
		// 9mo band floor is 2 naps; the 3rd nap was taken only 3 of 8 days. Modal still
		// reads 3 (Rule 3 stays silent), so this is the early-transition signal.
		const stats = neutralStats({
			dayCount: 8,
			modalNapCount: 3,
			napWindowSamples: [8, 8, 3],
			napDurationSamples: [8, 8, 3]
		});
		const drop = advisePlan(stats, template, referenceForAge(9)).find(
			(a) => a.id === 'nap-transition'
		);
		expect(drop).toBeDefined();
		expect(drop?.confidence).toBe('low');
		expect(drop?.patch?.napCount).toBe(2);
	});

	it('stays quiet on nap transition when the last nap is taken consistently', () => {
		const stats = neutralStats({
			dayCount: 8,
			modalNapCount: 3,
			napDurationSamples: [8, 8, 8]
		});
		const advice = advisePlan(stats, template, referenceForAge(9));
		expect(advice.some((a) => a.id === 'nap-transition')).toBe(false);
	});

	it('defers to the nap-count rule instead of duplicating the drop', () => {
		// Modal has already moved to 2 → Rule 3 fires; Rule 6 must not also fire.
		const stats = neutralStats({
			dayCount: 8,
			modalNapCount: 2,
			napDurationSamples: [8, 8, 2]
		});
		const advice = advisePlan(stats, template, referenceForAge(9));
		expect(advice.some((a) => a.id === 'nap-count')).toBe(true);
		expect(advice.some((a) => a.id === 'nap-transition')).toBe(false);
	});
});
