import { describe, it, expect } from 'vitest';
import { referenceForAge, ageMonthsFromBirthDate } from './reference';

describe('referenceForAge', () => {
	it('returns the newborn band for a very young age', () => {
		const ref = referenceForAge(1);
		expect(ref).not.toBeNull();
		expect(ref?.napCount).toEqual([4, 8]);
		expect(ref?.wakeWindowMin).toBe(45);
		expect(ref?.wakeWindowMax).toBe(60);
	});

	it('returns the 4–6mo band for a mid-infancy age', () => {
		const ref = referenceForAge(5);
		expect(ref?.napCount).toEqual([3, 4]);
		expect(ref?.wakeWindowMin).toBe(90);
		expect(ref?.wakeWindowMax).toBe(150);
	});

	it('treats band bounds as half-open on the upper edge', () => {
		// 3 falls in 3–4 (WW 75–120); exactly 4 falls in the next band 4–6 (WW 90–150).
		expect(referenceForAge(3)?.wakeWindowMax).toBe(120);
		expect(referenceForAge(4)?.wakeWindowMax).toBe(150);
	});

	it('returns null for unknown, non-finite, or negative ages', () => {
		expect(referenceForAge(null)).toBeNull();
		expect(referenceForAge(undefined)).toBeNull();
		expect(referenceForAge(Number.NaN)).toBeNull();
		expect(referenceForAge(-1)).toBeNull();
	});

	it('returns null at or beyond the covered range (≥ 36 months)', () => {
		expect(referenceForAge(36)).toBeNull();
		expect(referenceForAge(48)).toBeNull();
		// 35 is still inside the last band.
		expect(referenceForAge(35)).not.toBeNull();
	});
});

describe('ageMonthsFromBirthDate', () => {
	it('computes fractional months from a birth date at a fixed now', () => {
		// Born 2026-01-22, evaluated 2026-07-22 → ~6 months.
		const now = Date.UTC(2026, 6, 22);
		expect(ageMonthsFromBirthDate('2026-01-22', now)).toBeCloseTo(6, 0);
	});

	it('returns null for a malformed or empty birth date', () => {
		const now = Date.UTC(2026, 6, 22);
		expect(ageMonthsFromBirthDate('nope', now)).toBeNull();
		expect(ageMonthsFromBirthDate('', now)).toBeNull();
		expect(ageMonthsFromBirthDate(null, now)).toBeNull();
		expect(ageMonthsFromBirthDate('2026-02-30', now)).toBeNull();
	});

	it('returns null when the birth date is in the future', () => {
		const now = Date.UTC(2026, 6, 22);
		expect(ageMonthsFromBirthDate('2027-01-01', now)).toBeNull();
	});

	it('composes with referenceForAge', () => {
		const now = Date.UTC(2026, 6, 22);
		const months = ageMonthsFromBirthDate('2026-01-22', now);
		expect(referenceForAge(months)?.napCount).toEqual([3, 4]); // ~5.95mo → 4–6 band
	});
});
