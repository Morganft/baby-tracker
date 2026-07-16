import { describe, it, expect } from 'vitest';
import {
	groupDay,
	groupDayForKey,
	shiftDateKey,
	summariseGrouping,
	localDateKey,
	type DayEntry,
	type DayGrouping
} from './day';

const U = (y: number, mo: number, d: number, h: number, mi = 0) => Date.UTC(y, mo - 1, d, h, mi);

describe('localDateKey', () => {
	it('reads the calendar day in the given zone', () => {
		expect(localDateKey(U(2026, 7, 9, 12), 'UTC')).toBe('2026-07-09');
	});

	it('rolls back across midnight for a west-of-UTC zone', () => {
		// 02:00 UTC on the 9th is still 22:00 on the 8th in New York (UTC-4).
		expect(localDateKey(U(2026, 7, 9, 2), 'America/New_York')).toBe('2026-07-08');
	});
});

describe('groupDay', () => {
	const now = U(2026, 7, 9, 20);
	const lastNight: DayEntry = {
		id: 'A',
		type: 'night',
		start: U(2026, 7, 8, 19),
		end: U(2026, 7, 9, 7)
	};
	const nap1: DayEntry = {
		id: 'B',
		type: 'nap',
		start: U(2026, 7, 9, 9),
		end: U(2026, 7, 9, 9, 45)
	};
	const nap2: DayEntry = {
		id: 'C',
		type: 'nap',
		start: U(2026, 7, 9, 12, 30),
		end: U(2026, 7, 9, 13, 15)
	};
	const yesterdayNap: DayEntry = {
		id: 'D',
		type: 'nap',
		start: U(2026, 7, 8, 10),
		end: U(2026, 7, 8, 11)
	};
	const tonight: DayEntry = { id: 'E', type: 'night', start: U(2026, 7, 9, 19, 30), end: null };

	it("keeps today's naps + tonight's bedtime, ordered, and excludes yesterday", () => {
		const { sleeps } = groupDay([lastNight, nap2, nap1, yesterdayNap, tonight], now, 'UTC');
		expect(sleeps.map((s) => s.id)).toEqual(['B', 'C', 'E']);
	});

	it("uses last night's end as the morning wake", () => {
		const { morningWake } = groupDay([lastNight, nap1, tonight], now, 'UTC');
		expect(morningWake).toBe(U(2026, 7, 9, 7));
	});

	it('has no morning wake when last night is still in progress', () => {
		const ongoing: DayEntry = { ...lastNight, end: null };
		const { morningWake } = groupDay([ongoing, nap1], now, 'UTC');
		expect(morningWake).toBeNull();
	});

	it('has no morning wake on a day with only naps', () => {
		const { sleeps, morningWake } = groupDay([nap1, nap2], now, 'UTC');
		expect(morningWake).toBeNull();
		expect(sleeps.map((s) => s.id)).toEqual(['B', 'C']);
	});

	it("exposes last night's entry id as the overnight entry", () => {
		const { overnightEntryId } = groupDay([lastNight, nap1, tonight], now, 'UTC');
		expect(overnightEntryId).toBe('A');
	});

	it('exposes an in-progress overnight entry id though there is no morning wake', () => {
		const ongoing: DayEntry = { ...lastNight, end: null };
		const { morningWake, overnightEntryId } = groupDay([ongoing, nap1], now, 'UTC');
		expect(morningWake).toBeNull();
		expect(overnightEntryId).toBe('A');
	});

	it('has no overnight entry on a day with only naps', () => {
		const { overnightEntryId } = groupDay([nap1, nap2], now, 'UTC');
		expect(overnightEntryId).toBeNull();
	});
});

describe('shiftDateKey', () => {
	it('shifts forward and back by whole days', () => {
		expect(shiftDateKey('2026-07-09', 1)).toBe('2026-07-10');
		expect(shiftDateKey('2026-07-09', -1)).toBe('2026-07-08');
		expect(shiftDateKey('2026-07-09', 0)).toBe('2026-07-09');
	});

	it('rolls over month and year boundaries', () => {
		expect(shiftDateKey('2026-07-31', 1)).toBe('2026-08-01');
		expect(shiftDateKey('2026-01-01', -1)).toBe('2025-12-31');
		expect(shiftDateKey('2024-02-28', 1)).toBe('2024-02-29'); // leap year
	});
});

describe('groupDayForKey', () => {
	const lastNight: DayEntry = {
		id: 'A',
		type: 'night',
		start: U(2026, 7, 8, 19),
		end: U(2026, 7, 9, 7)
	};
	const nap1: DayEntry = {
		id: 'B',
		type: 'nap',
		start: U(2026, 7, 9, 9),
		end: U(2026, 7, 9, 9, 45)
	};
	const nap2: DayEntry = {
		id: 'C',
		type: 'nap',
		start: U(2026, 7, 9, 12, 30),
		end: U(2026, 7, 9, 13, 15)
	};
	const yesterdayNap: DayEntry = {
		id: 'D',
		type: 'nap',
		start: U(2026, 7, 8, 10),
		end: U(2026, 7, 8, 11)
	};
	const tonight: DayEntry = { id: 'E', type: 'night', start: U(2026, 7, 9, 19, 30), end: null };

	it('groups a past day by its dayKey exactly as groupDay does for "today"', () => {
		const g = groupDayForKey([lastNight, nap2, nap1, yesterdayNap, tonight], '2026-07-09', 'UTC');
		expect(g.sleeps.map((s) => s.id)).toEqual(['B', 'C', 'E']);
		expect(g.morningWake).toBe(U(2026, 7, 9, 7));
		expect(g.overnightEntryId).toBe('A');
	});

	it('matches groupDay when the key is the local day of `now`', () => {
		const now = U(2026, 7, 9, 20);
		const entries = [lastNight, nap1, nap2, tonight];
		expect(groupDayForKey(entries, '2026-07-09', 'UTC')).toEqual(groupDay(entries, now, 'UTC'));
	});
});

describe('summariseGrouping', () => {
	const base = (sleeps: DayGrouping['sleeps'], morningWake: number | null): DayGrouping => ({
		sleeps,
		morningWake,
		overnightEntryId: null
	});

	it('sums completed naps and computes bedtime and awake time', () => {
		const g = base(
			[
				{ id: 'B', type: 'nap', start: U(2026, 7, 9, 9), end: U(2026, 7, 9, 9, 45) },
				{ id: 'C', type: 'nap', start: U(2026, 7, 9, 12, 30), end: U(2026, 7, 9, 13, 15) },
				{ id: 'E', type: 'night', start: U(2026, 7, 9, 19, 30), end: null }
			],
			U(2026, 7, 9, 7)
		);
		const s = summariseGrouping(g);
		expect(s.daytimeSleepMin).toBe(90); // 45 + 45
		expect(s.napCount).toBe(2);
		expect(s.morningWake).toBe(U(2026, 7, 9, 7));
		expect(s.bedtime).toBe(U(2026, 7, 9, 19, 30));
		// 07:00 → 19:30 = 750 min awake window, minus 90 min napping.
		expect(s.awakeMin).toBe(660);
	});

	it('excludes in-progress naps from the daytime total and count', () => {
		const g = base(
			[
				{ id: 'B', type: 'nap', start: U(2026, 7, 9, 9), end: U(2026, 7, 9, 9, 45) },
				{ id: 'C', type: 'nap', start: U(2026, 7, 9, 12, 30), end: null }
			],
			U(2026, 7, 9, 7)
		);
		const s = summariseGrouping(g);
		expect(s.daytimeSleepMin).toBe(45);
		expect(s.napCount).toBe(1);
	});

	it('returns null awakeMin when bedtime is missing', () => {
		const g = base(
			[{ id: 'B', type: 'nap', start: U(2026, 7, 9, 9), end: U(2026, 7, 9, 9, 45) }],
			U(2026, 7, 9, 7)
		);
		const s = summariseGrouping(g);
		expect(s.bedtime).toBeNull();
		expect(s.awakeMin).toBeNull();
	});

	it('returns null awakeMin when morning wake is missing', () => {
		const g = base([{ id: 'E', type: 'night', start: U(2026, 7, 9, 19, 30), end: null }], null);
		const s = summariseGrouping(g);
		expect(s.morningWake).toBeNull();
		expect(s.awakeMin).toBeNull();
	});

	it('reports zeros for a day with no naps', () => {
		const s = summariseGrouping(base([], U(2026, 7, 9, 7)));
		expect(s.daytimeSleepMin).toBe(0);
		expect(s.napCount).toBe(0);
	});
});
