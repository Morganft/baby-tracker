import { describe, it, expect } from 'vitest';
import {
	resolveDisplayZone,
	resolveEntryTimezone,
	serverTimeZone,
	parseSleepCreate,
	parseSleepUpdate,
	parseBabyUpdate,
	parseTemplate
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

describe('parseBabyUpdate', () => {
	it('accepts a valid ISO birth date', () => {
		expect(parseBabyUpdate({ birthDate: '2026-01-22' })).toEqual({ birthDate: '2026-01-22' });
	});

	it('clears the birth date on empty string or null', () => {
		expect(parseBabyUpdate({ birthDate: '' })).toEqual({ birthDate: null });
		expect(parseBabyUpdate({ birthDate: null })).toEqual({ birthDate: null });
	});

	it('rejects a malformed or impossible date', () => {
		expect(() => parseBabyUpdate({ birthDate: '22-01-2026' })).toThrow();
		expect(() => parseBabyUpdate({ birthDate: '2026-13-40' })).toThrow();
		expect(() => parseBabyUpdate({ birthDate: 123 })).toThrow();
	});

	it('rejects an update with no fields', () => {
		expect(() => parseBabyUpdate({})).toThrow();
	});
});

describe('parseTemplate — integer minutes invariant', () => {
	// A minimal, valid two-nap template; individual tests override single fields.
	const base = {
		name: 'Test',
		referenceWakeTime: '07:00',
		napCount: 2,
		wakeWindows: [120, 150, 180],
		expectedNapDurations: [60, 45]
	};

	it('accepts whole-minute wakeWindows / expectedNapDurations', () => {
		const out = parseTemplate(base);
		expect(out.wakeWindows).toEqual([120, 150, 180]);
		expect(out.expectedNapDurations).toEqual([60, 45]);
	});

	it('rejects a fractional wakeWindows entry', () => {
		expect(() => parseTemplate({ ...base, wakeWindows: [120, 150.5, 180] })).toThrow();
	});

	it('rejects a fractional expectedNapDurations entry', () => {
		expect(() => parseTemplate({ ...base, expectedNapDurations: [60, 45.25] })).toThrow();
	});

	it('accepts whole-minute redistribution bounds', () => {
		const out = parseTemplate({
			...base,
			wakeWindowMin: [90, 120, 150],
			wakeWindowMax: [150, 180, 210],
			napDurationMin: [30, 30],
			napDurationMax: [90, 90]
		});
		expect(out.wakeWindowMin).toEqual([90, 120, 150]);
		expect(out.napDurationMax).toEqual([90, 90]);
	});

	it('rejects a fractional redistribution bound', () => {
		expect(() =>
			parseTemplate({ ...base, wakeWindowMin: [90, 120.5, 150] })
		).toThrow();
	});
});
