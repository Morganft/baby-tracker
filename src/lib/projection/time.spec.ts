import { describe, it, expect } from 'vitest';
import { resolveClockTime } from './time';

describe('resolveClockTime', () => {
	it('resolves a clock time on the reference calendar day in UTC', () => {
		const ref = Date.UTC(2026, 6, 9, 3, 0); // 2026-07-09 03:00 UTC
		expect(resolveClockTime('07:00', ref, 'UTC')).toBe(Date.UTC(2026, 6, 9, 7, 0));
	});

	it('uses the calendar day as seen in the target zone', () => {
		// 2026-07-09 01:00 UTC is still 2026-07-08 in America/New_York (UTC-4).
		const ref = Date.UTC(2026, 6, 9, 1, 0);
		const got = resolveClockTime('07:00', ref, 'America/New_York');
		// Expect 07:00 on 2026-07-08 EDT = 11:00 UTC.
		expect(got).toBe(Date.UTC(2026, 6, 8, 11, 0));
	});

	it('resolves a summer (DST) clock time in a European zone', () => {
		const ref = Date.UTC(2026, 6, 9, 9, 0); // midday-ish in Prague (CEST, UTC+2)
		const got = resolveClockTime('07:00', ref, 'Europe/Prague');
		// 07:00 CEST = 05:00 UTC.
		expect(got).toBe(Date.UTC(2026, 6, 9, 5, 0));
	});

	it('resolves a winter (standard time) clock time in a European zone', () => {
		const ref = Date.UTC(2026, 0, 15, 9, 0); // January, Prague CET (UTC+1)
		const got = resolveClockTime('07:00', ref, 'Europe/Prague');
		// 07:00 CET = 06:00 UTC.
		expect(got).toBe(Date.UTC(2026, 0, 15, 6, 0));
	});
});
