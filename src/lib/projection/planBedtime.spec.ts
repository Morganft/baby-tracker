import { describe, it, expect } from 'vitest';
import { planBedtime } from './planBedtime';

describe('planBedtime', () => {
	it('sums the wake windows and nap durations onto the reference wake', () => {
		// 07:00 + (90 + 120 + 150) windows + (60 + 90) naps = 07:00 + 510m = 15:30.
		expect(planBedtime('07:00', [90, 120, 150], [60, 90])).toBe('15:30');
	});

	it('reproduces the reference wake when there are no sleeps', () => {
		expect(planBedtime('07:00', [], [])).toBe('07:00');
	});

	it('wraps past midnight', () => {
		// 22:00 + 3h of windows = 01:00 next day.
		expect(planBedtime('22:00', [90, 90], [0])).toBe('01:00');
	});

	it('ignores non-finite entries rather than producing NaN', () => {
		expect(planBedtime('07:00', [60, Number.NaN], [30])).toBe('08:30');
	});

	it('returns null for a malformed wake time', () => {
		expect(planBedtime('nope', [60], [])).toBeNull();
		expect(planBedtime('', [60], [])).toBeNull();
		expect(planBedtime(null, [60], [])).toBeNull();
		expect(planBedtime('25:00', [60], [])).toBeNull();
	});
});
