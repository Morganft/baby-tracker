/**
 * Age reference table for the advice system (pure, framework-free).
 *
 * Maps a baby's age in months to established infant-sleep guidance: typical nap
 * count, wake-window bounds, and total 24h / daytime sleep targets. The numbers
 * are **guidance ranges**, not hard limits — they are compiled from the sources
 * listed in ADVICE_SYSTEM_PLAN.md (Huckleberry, HappiestBaby, The Bump, Pampers,
 * Little Ones), which each give age bands with ranges and stress that cues
 * matter too.
 *
 * This module is deterministic and has no DB or route imports so it can be unit
 * tested and reused by both the in-day and planning advice engines. The `baby`
 * table is server-only, so age is passed in as a plain value (see
 * `ageMonthsFromBirthDate`) rather than read here.
 */

/** Established guidance for a single age band. All durations are in minutes. */
export interface AgeReference {
	/** Typical number of naps per day, as [min, max]. */
	napCount: readonly [number, number];
	/** Shortest typical wake window (awake stretch) in minutes. */
	wakeWindowMin: number;
	/** Longest typical wake window in minutes. */
	wakeWindowMax: number;
	/** Total sleep across 24h, as [lo, hi] minutes. */
	total24hMin: readonly [number, number];
	/** Daytime (nap) sleep, as [lo, hi] minutes. */
	daytimeMin: readonly [number, number];
}

/** A band applies to ages in [prevBand.maxMonths, maxMonths). */
interface Band {
	/** Exclusive upper bound of the band, in months. */
	maxMonths: number;
	ref: AgeReference;
}

/**
 * Banded guidance table, ordered by ascending age. Bands are half-open on the
 * upper bound: an age of exactly 4 months falls in the 4–6 band, not 3–4. Ages
 * at or beyond the last band's bound (36 months) are out of the covered range.
 */
const BANDS: readonly Band[] = [
	// 0–1.5mo: frequent short wake windows, sleep dominates the day.
	{
		maxMonths: 1.5,
		ref: {
			napCount: [4, 8],
			wakeWindowMin: 45,
			wakeWindowMax: 60,
			total24hMin: [840, 1020], // 14–17h
			daytimeMin: [420, 540] // 7–9h
		}
	},
	// 1.5–3mo
	{
		maxMonths: 3,
		ref: {
			napCount: [4, 5],
			wakeWindowMin: 60,
			wakeWindowMax: 90,
			total24hMin: [840, 960], // 14–16h
			daytimeMin: [300, 420] // 5–7h
		}
	},
	// 3–4mo
	{
		maxMonths: 4,
		ref: {
			napCount: [3, 5],
			wakeWindowMin: 75,
			wakeWindowMax: 120,
			total24hMin: [780, 930], // 13–15.5h
			daytimeMin: [240, 360] // 4–6h
		}
	},
	// 4–6mo: ~4→3 nap transition begins.
	{
		maxMonths: 6,
		ref: {
			napCount: [3, 4],
			wakeWindowMin: 90,
			wakeWindowMax: 150,
			total24hMin: [720, 900], // 12–15h
			daytimeMin: [180, 300] // 3–5h
		}
	},
	// 6–9mo: ~3→2 nap transition.
	{
		maxMonths: 9,
		ref: {
			napCount: [2, 3],
			wakeWindowMin: 120,
			wakeWindowMax: 180,
			total24hMin: [720, 900], // 12–15h
			daytimeMin: [120, 240] // 2–4h
		}
	},
	// 9–12mo
	{
		maxMonths: 12,
		ref: {
			napCount: [2, 2],
			wakeWindowMin: 150,
			wakeWindowMax: 210,
			total24hMin: [690, 840], // 11.5–14h
			daytimeMin: [120, 210] // 2–3.5h
		}
	},
	// 12–15mo: ~2→1 nap transition begins.
	{
		maxMonths: 15,
		ref: {
			napCount: [1, 2],
			wakeWindowMin: 180,
			wakeWindowMax: 240,
			total24hMin: [660, 840], // 11–14h
			daytimeMin: [120, 180] // 2–3h
		}
	},
	// 15–18mo
	{
		maxMonths: 18,
		ref: {
			napCount: [1, 2],
			wakeWindowMin: 210,
			wakeWindowMax: 270,
			total24hMin: [660, 840], // 11–14h
			daytimeMin: [90, 180] // 1.5–3h
		}
	},
	// 18–24mo: settled on a single nap.
	{
		maxMonths: 24,
		ref: {
			napCount: [1, 1],
			wakeWindowMin: 240,
			wakeWindowMax: 360,
			total24hMin: [660, 840], // 11–14h
			daytimeMin: [90, 150] // 1.5–2.5h
		}
	},
	// 24–36mo
	{
		maxMonths: 36,
		ref: {
			napCount: [1, 1],
			wakeWindowMin: 300,
			wakeWindowMax: 360,
			total24hMin: [600, 780], // 10–13h
			daytimeMin: [60, 120] // 1–2h
		}
	}
];

/**
 * Guidance for an age in months, or null when the age is unknown (null /
 * undefined / NaN), negative, or at/beyond the covered range (≥ 36 months).
 * Callers use the null case to fall back to data-only advice.
 */
export function referenceForAge(months: number | null | undefined): AgeReference | null {
	if (months === null || months === undefined) return null;
	if (!Number.isFinite(months) || months < 0) return null;
	for (const band of BANDS) {
		if (months < band.maxMonths) return band.ref;
	}
	return null;
}

/** Average Gregorian month, so 1.5-month bands resolve cleanly. */
const MONTH_MS = 30.4375 * 86_400_000;

/** 'yyyy-mm-dd' → UTC midnight epoch ms, or null when malformed / impossible. */
function parseISODate(value: string | null | undefined): number | null {
	if (!value) return null;
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
	if (!m) return null;
	const year = Number(m[1]);
	const month = Number(m[2]);
	const day = Number(m[3]);
	if (month < 1 || month > 12 || day < 1 || day > 31) return null;
	const ms = Date.UTC(year, month - 1, day);
	const d = new Date(ms);
	// Reject rolled-over dates like 2026-02-30.
	if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
		return null;
	}
	return ms;
}

/**
 * Age in months (fractional) from an ISO 'yyyy-mm-dd' birth date, evaluated at
 * `now` (epoch ms). Returns null when the birth date is malformed / impossible
 * or lies in the future relative to `now`. Feed the result to
 * `referenceForAge`.
 */
export function ageMonthsFromBirthDate(
	birthDate: string | null | undefined,
	now: number
): number | null {
	const birthMs = parseISODate(birthDate);
	if (birthMs === null || !Number.isFinite(now)) return null;
	const months = (now - birthMs) / MONTH_MS;
	if (months < 0) return null;
	return months;
}
