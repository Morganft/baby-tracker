import { describe, it, expect } from 'vitest';
import { groupDay, localDateKey, type DayEntry } from './day';

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
