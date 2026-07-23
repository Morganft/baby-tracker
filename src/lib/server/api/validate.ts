/**
 * Request-body validation for the JSON API. Each helper parses an `unknown`
 * body into a typed, DB-ready shape or throws `error(400, ...)`. Kept server-only
 * (used from `+server.ts`); no external validation library on the host.
 */
import { error } from '@sveltejs/kit';

const SLEEP_TYPES = ['nap', 'night'] as const;
const LOCATIONS = ['crib', 'stroller', 'car', 'contact', 'other'] as const;
const PUT_DOWNS = ['drowsy', 'already-asleep', 'self-settled'] as const;

export type SleepType = (typeof SLEEP_TYPES)[number];
export type SleepLocation = (typeof LOCATIONS)[number];
export type PutDown = (typeof PUT_DOWNS)[number];

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** True for a real calendar date in 'YYYY-MM-DD' form (rejects 2026-13-40). */
function isRealCalendarDate(s: string): boolean {
	if (!ISO_DATE.test(s)) return false;
	const [y, m, d] = s.split('-').map(Number);
	const dt = new Date(Date.UTC(y, m - 1, d));
	return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function obj(body: unknown): Record<string, unknown> {
	if (body === null || typeof body !== 'object' || Array.isArray(body)) {
		throw error(400, 'Request body must be a JSON object');
	}
	return body as Record<string, unknown>;
}

function epoch(v: unknown, name: string): number {
	if (typeof v !== 'number' || !Number.isFinite(v))
		throw error(400, `${name} must be an epoch-ms number`);
	return v;
}

function str(v: unknown, name: string): string {
	if (typeof v !== 'string' || v.length === 0)
		throw error(400, `${name} must be a non-empty string`);
	return v;
}

function intMin(v: unknown, name: string, min: number): number {
	if (typeof v !== 'number' || !Number.isInteger(v) || v < min) {
		throw error(400, `${name} must be an integer ≥ ${min}`);
	}
	return v;
}

function numberArray(v: unknown, name: string): number[] {
	if (!Array.isArray(v) || v.some((n) => typeof n !== 'number' || !Number.isFinite(n))) {
		throw error(400, `${name} must be an array of numbers`);
	}
	return v as number[];
}

function oneOf<T extends readonly string[]>(v: unknown, name: string, allowed: T): T[number] {
	if (typeof v !== 'string' || !allowed.includes(v)) {
		throw error(400, `${name} must be one of: ${allowed.join(', ')}`);
	}
	return v;
}

/** A valid IANA zone (checked via Intl — no tz table on the host). */
export function isValidTimeZone(tz: unknown): tz is string {
	if (typeof tz !== 'string' || tz.length === 0) return false;
	try {
		new Intl.DateTimeFormat('en-US', { timeZone: tz });
		return true;
	} catch {
		return false;
	}
}

function timezone(v: unknown, name: string): string {
	if (!isValidTimeZone(v)) throw error(400, `${name} must be a valid IANA timezone`);
	return v;
}

/** The reference server timezone, used when a client omits its own. */
export function serverTimeZone(): string {
	return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

/**
 * The IANA zone to store for a new/edited entry. The client's own valid zone
 * always wins — this is how a travelling phone captures where it actually was.
 * Only when the client sent nothing usable (a no-JS submit that carried no zone)
 * do we fall back to the server's reference zone.
 */
export function resolveEntryTimezone(clientTz: unknown): string {
	return isValidTimeZone(clientTz) ? clientTz : serverTimeZone();
}

/**
 * The display/day zone for today's live views (Home, Timeline). When the phone
 * has advertised its own valid zone via the `tz` cookie, today's times render —
 * and the day is grouped — in the phone's zone, so a travel day reads
 * consistently with the per-entry zones History shows. Before the cookie lands
 * (first SSR paint, or a no-JS client) we fall back to the server's zone.
 */
export function resolveDisplayZone(tzCookie: unknown): string {
	return isValidTimeZone(tzCookie) ? tzCookie : serverTimeZone();
}

export interface SleepCreate {
	id?: string;
	startTime: number;
	endTime: number | null;
	/** IANA zone the sleep started in. */
	startTimezone: string;
	/** IANA zone the sleep ended in; null while in progress. */
	endTimezone: string | null;
	type: SleepType;
	location: SleepLocation | null;
	putDown: PutDown | null;
	notes: string | null;
}

/**
 * The start zone of a sleep body: prefers `startTimezone`, accepts a legacy
 * `timezone` (older clients / backups), and defaults to the server zone.
 */
function startZoneOf(b: Record<string, unknown>): string {
	if (b.startTimezone !== undefined) return timezone(b.startTimezone, 'startTimezone');
	if (b.timezone !== undefined) return timezone(b.timezone, 'timezone');
	return serverTimeZone();
}

/** Validate a new sleep. `startTime` and `type` are required; zones default sensibly. */
export function parseSleepCreate(body: unknown): SleepCreate {
	const b = obj(body);
	const startTime = epoch(b.startTime, 'startTime');
	const endTime = b.endTime == null ? null : epoch(b.endTime, 'endTime');
	if (endTime != null && endTime < startTime) throw error(400, 'endTime must be ≥ startTime');
	const startTimezone = startZoneOf(b);
	// A finished sleep carries an end zone (defaulting to the start zone); an
	// in-progress one has none yet — it's captured when the sleep is stopped.
	const endTimezone =
		endTime == null
			? null
			: b.endTimezone == null
				? startTimezone
				: timezone(b.endTimezone, 'endTimezone');
	return {
		id: b.id === undefined ? undefined : str(b.id, 'id'),
		startTime,
		endTime,
		startTimezone,
		endTimezone,
		type: oneOf(b.type, 'type', SLEEP_TYPES),
		location: b.location == null ? null : oneOf(b.location, 'location', LOCATIONS),
		putDown: b.putDown == null ? null : oneOf(b.putDown, 'putDown', PUT_DOWNS),
		notes: b.notes == null ? null : str(b.notes, 'notes')
	};
}

export interface SleepUpdate {
	startTime?: number;
	endTime?: number | null;
	startTimezone?: string;
	endTimezone?: string | null;
	type?: SleepType;
	location?: SleepLocation | null;
	putDown?: PutDown | null;
	notes?: string | null;
}

/** Validate a partial sleep edit (any subset of fields). */
export function parseSleepUpdate(body: unknown): SleepUpdate {
	const b = obj(body);
	const out: SleepUpdate = {};
	if ('startTime' in b) out.startTime = epoch(b.startTime, 'startTime');
	if ('endTime' in b) out.endTime = b.endTime == null ? null : epoch(b.endTime, 'endTime');
	// Accept `startTimezone` (new) or a legacy `timezone` alias for the start zone.
	if ('startTimezone' in b) out.startTimezone = timezone(b.startTimezone, 'startTimezone');
	else if ('timezone' in b) out.startTimezone = timezone(b.timezone, 'timezone');
	if ('endTimezone' in b)
		out.endTimezone = b.endTimezone == null ? null : timezone(b.endTimezone, 'endTimezone');
	if ('type' in b) out.type = oneOf(b.type, 'type', SLEEP_TYPES);
	if ('location' in b)
		out.location = b.location == null ? null : oneOf(b.location, 'location', LOCATIONS);
	if ('putDown' in b)
		out.putDown = b.putDown == null ? null : oneOf(b.putDown, 'putDown', PUT_DOWNS);
	if ('notes' in b) out.notes = b.notes == null ? null : str(b.notes, 'notes');
	if (Object.keys(out).length === 0) throw error(400, 'No updatable fields provided');
	return out;
}

/** Validate a night-waking body: `{ time: epoch-ms }`. */
export function parseWaking(body: unknown): number {
	const b = obj(body);
	return epoch(b.time, 'time');
}

export interface TemplateInput {
	name: string;
	referenceWakeTime: string;
	napCount: number;
	wakeWindows: number[];
	expectedNapDurations: number[];
	dailyTotalSleepTarget: number | null;
	daytimeCap: number | null;
	bedtimeStart: string | null;
	bedtimeEnd: string | null;
	/** Enforced day-anchor bedtime; when set, the projected tail redistributes to it. */
	targetBedtime: string | null;
	/** Per-position redistribution bounds (minutes); null → unbounded everywhere. */
	wakeWindowMin: number[] | null;
	wakeWindowMax: number[] | null;
	napDurationMin: number[] | null;
	napDurationMax: number[] | null;
}

function hhmmOrNull(v: unknown, name: string): string | null {
	if (v == null) return null;
	if (typeof v !== 'string' || !HHMM.test(v)) throw error(400, `${name} must be 'HH:MM'`);
	return v;
}

/** Validate an optional bounds array: null, or non-negative numbers of `len`. */
function boundArrayOrNull(v: unknown, name: string, len: number): number[] | null {
	if (v == null) return null;
	const arr = numberArray(v, name);
	if (arr.length !== len) throw error(400, `${name} must have length ${len}`);
	if (arr.some((n) => n < 0)) throw error(400, `${name} values must be ≥ 0`);
	return arr;
}

/** Fail if any `min[i]` exceeds `max[i]` (only where both bounds are present). */
function assertMinMax(min: number[] | null, max: number[] | null, name: string): void {
	if (!min || !max) return;
	for (let i = 0; i < min.length; i++) {
		if (min[i] > max[i]) throw error(400, `${name} min must be ≤ max at position ${i}`);
	}
}

/** Validate a full template body (create, or overwrite of a library template). */
export function parseTemplate(body: unknown): TemplateInput {
	const b = obj(body);
	const napCount = intMin(b.napCount, 'napCount', 0);
	const wakeWindows = numberArray(b.wakeWindows, 'wakeWindows');
	const expectedNapDurations = numberArray(b.expectedNapDurations, 'expectedNapDurations');
	if (wakeWindows.length !== napCount + 1) {
		throw error(400, `wakeWindows must have length napCount + 1 (${napCount + 1})`);
	}
	if (expectedNapDurations.length !== napCount) {
		throw error(400, `expectedNapDurations must have length napCount (${napCount})`);
	}
	if (typeof b.referenceWakeTime !== 'string' || !HHMM.test(b.referenceWakeTime)) {
		throw error(400, "referenceWakeTime must be 'HH:MM'");
	}
	const wakeWindowMin = boundArrayOrNull(b.wakeWindowMin, 'wakeWindowMin', napCount + 1);
	const wakeWindowMax = boundArrayOrNull(b.wakeWindowMax, 'wakeWindowMax', napCount + 1);
	const napDurationMin = boundArrayOrNull(b.napDurationMin, 'napDurationMin', napCount);
	const napDurationMax = boundArrayOrNull(b.napDurationMax, 'napDurationMax', napCount);
	assertMinMax(wakeWindowMin, wakeWindowMax, 'wakeWindow');
	assertMinMax(napDurationMin, napDurationMax, 'napDuration');
	return {
		name: str(b.name, 'name'),
		referenceWakeTime: b.referenceWakeTime,
		napCount,
		wakeWindows,
		expectedNapDurations,
		dailyTotalSleepTarget:
			b.dailyTotalSleepTarget == null
				? null
				: intMin(b.dailyTotalSleepTarget, 'dailyTotalSleepTarget', 0),
		daytimeCap: b.daytimeCap == null ? null : intMin(b.daytimeCap, 'daytimeCap', 0),
		bedtimeStart: hhmmOrNull(b.bedtimeStart, 'bedtimeStart'),
		bedtimeEnd: hhmmOrNull(b.bedtimeEnd, 'bedtimeEnd'),
		targetBedtime: hhmmOrNull(b.targetBedtime, 'targetBedtime'),
		wakeWindowMin,
		wakeWindowMax,
		napDurationMin,
		napDurationMax
	};
}

export interface SettingsUpdate {
	shortNapThresholdMin?: number;
	shortNapReductionPercent?: number;
	clock24h?: boolean;
	dayStartTime?: string;
	adviceEnabled?: boolean;
}

function bool(v: unknown, name: string): boolean {
	if (typeof v !== 'boolean') throw error(400, `${name} must be a boolean`);
	return v;
}

/** Validate a partial settings edit. */
export function parseSettingsUpdate(body: unknown): SettingsUpdate {
	const b = obj(body);
	const out: SettingsUpdate = {};
	if ('shortNapThresholdMin' in b)
		out.shortNapThresholdMin = intMin(b.shortNapThresholdMin, 'shortNapThresholdMin', 0);
	if ('shortNapReductionPercent' in b) {
		const p = intMin(b.shortNapReductionPercent, 'shortNapReductionPercent', 0);
		if (p > 100) throw error(400, 'shortNapReductionPercent must be ≤ 100');
		out.shortNapReductionPercent = p;
	}
	if ('clock24h' in b) out.clock24h = bool(b.clock24h, 'clock24h');
	if ('adviceEnabled' in b) out.adviceEnabled = bool(b.adviceEnabled, 'adviceEnabled');
	if ('dayStartTime' in b) {
		if (typeof b.dayStartTime !== 'string' || !HHMM.test(b.dayStartTime)) {
			throw error(400, "dayStartTime must be 'HH:MM'");
		}
		out.dayStartTime = b.dayStartTime;
	}
	if (Object.keys(out).length === 0) throw error(400, 'No updatable fields provided');
	return out;
}

export interface BabyUpdate {
	birthDate?: string | null;
}

/**
 * Validate an edit to the single baby row. `birthDate` is an optional ISO
 * 'YYYY-MM-DD'; an empty string or explicit null clears it (falls back to
 * data-only advice).
 */
export function parseBabyUpdate(body: unknown): BabyUpdate {
	const b = obj(body);
	const out: BabyUpdate = {};
	if ('birthDate' in b) {
		const v = b.birthDate;
		if (v === null || v === '') {
			out.birthDate = null;
		} else if (typeof v === 'string' && isRealCalendarDate(v)) {
			out.birthDate = v;
		} else {
			throw error(400, "birthDate must be 'YYYY-MM-DD' or empty");
		}
	}
	if (Object.keys(out).length === 0) throw error(400, 'No updatable fields provided');
	return out;
}
