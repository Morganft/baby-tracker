import { describe, it, expect } from 'vitest';
import {
	resolveDisplayZone,
	resolveEntryTimezone,
	serverTimeZone,
	parseSleepCreate,
	parseSleepUpdate
} from './validate';

describe('resolveEntryTimezone', () => {
	const server = serverTimeZone();

	it("keeps the phone's own valid zone", () => {
		expect(resolveEntryTimezone('Asia/Tokyo')).toBe('Asia/Tokyo');
	});

	it('falls back to the server zone for a missing or invalid client zone', () => {
		expect(resolveEntryTimezone(undefined)).toBe(server);
		expect(resolveEntryTimezone('')).toBe(server);
		expect(resolveEntryTimezone('Not/AZone')).toBe(server);
	});
});

describe('resolveDisplayZone', () => {
	const server = serverTimeZone();

	it("renders today's views in the phone's cookie zone", () => {
		expect(resolveDisplayZone('Asia/Tokyo')).toBe('Asia/Tokyo');
	});

	it('falls back to the server zone for a missing or invalid cookie', () => {
		expect(resolveDisplayZone(undefined)).toBe(server);
		expect(resolveDisplayZone('')).toBe(server);
		expect(resolveDisplayZone('Not/AZone')).toBe(server);
	});
});

describe('parseSleepCreate — timezones', () => {
	const base = { startTime: 100, type: 'nap' as const };

	it('defaults the end zone to the start zone for a finished sleep', () => {
		const out = parseSleepCreate({ ...base, endTime: 200, startTimezone: 'Europe/Prague' });
		expect(out.startTimezone).toBe('Europe/Prague');
		expect(out.endTimezone).toBe('Europe/Prague');
	});

	it('keeps a distinct end zone (a sleep that ended after travel)', () => {
		const out = parseSleepCreate({
			...base,
			endTime: 200,
			startTimezone: 'Europe/Prague',
			endTimezone: 'Asia/Dubai'
		});
		expect(out.endTimezone).toBe('Asia/Dubai');
	});

	it('has no end zone while in progress', () => {
		const out = parseSleepCreate({ ...base, endTime: null, startTimezone: 'Europe/Prague' });
		expect(out.endTimezone).toBeNull();
	});

	it('accepts a legacy `timezone` as the start zone', () => {
		const out = parseSleepCreate({ ...base, endTime: null, timezone: 'Europe/Prague' });
		expect(out.startTimezone).toBe('Europe/Prague');
	});

	it('defaults the start zone to the server zone when none is given', () => {
		const out = parseSleepCreate({ ...base, endTime: null });
		expect(out.startTimezone).toBe(serverTimeZone());
	});
});

describe('parseSleepUpdate — timezones', () => {
	it('updates both zones', () => {
		const out = parseSleepUpdate({ startTimezone: 'Europe/Prague', endTimezone: 'Asia/Dubai' });
		expect(out.startTimezone).toBe('Europe/Prague');
		expect(out.endTimezone).toBe('Asia/Dubai');
	});

	it('clears the end zone when set to null (re-opened to in-progress)', () => {
		const out = parseSleepUpdate({ endTimezone: null });
		expect(out.endTimezone).toBeNull();
	});

	it('maps a legacy `timezone` field to the start zone', () => {
		const out = parseSleepUpdate({ timezone: 'Europe/Prague' });
		expect(out.startTimezone).toBe('Europe/Prague');
	});
});
