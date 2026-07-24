import { describe, it, expect } from 'vitest';
import { fmtDuration } from './format';

describe('fmtDuration', () => {
	it('rounds fractional minutes to the nearest whole minute', () => {
		// 44.6 min is what a real 09:00:00–09:44:36 nap produces via msToMinutes.
		expect(fmtDuration(44.6)).toBe('45m');
		expect(fmtDuration(44.4)).toBe('44m');
	});

	it('zero-pads the minutes once the hour rolls over', () => {
		expect(fmtDuration(65)).toBe('1h 05m');
		expect(fmtDuration(125)).toBe('2h 05m');
	});

	it('omits the hour segment under 60 minutes', () => {
		expect(fmtDuration(0)).toBe('0m');
		expect(fmtDuration(45)).toBe('45m');
	});

	it('clamps negative input to zero instead of emitting a malformed string', () => {
		expect(fmtDuration(-65)).toBe('0m');
		expect(fmtDuration(-1)).toBe('0m');
	});
});
