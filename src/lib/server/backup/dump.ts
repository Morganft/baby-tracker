/**
 * Pure types + validation for the backup dump (export/import). No DB imports so
 * the merge/parse logic stays unit-testable in isolation; the DB read/write side
 * lives in `./index.ts`.
 *
 * The dump is one JSON object covering every table. All timestamps cross the
 * boundary as epoch-ms numbers (they are stored as absolute `timestamp_ms`).
 * Import merges by UUID with last-write-wins on `updatedAt`; night wakings carry
 * no timestamps, so they dedupe by id only.
 */
import { error } from '@sveltejs/kit';
import { parseTemplate, type TemplateInput } from '../api/validate';

export const BACKUP_VERSION = 1 as const;

const SLEEP_TYPES = ['nap', 'night'] as const;
const LOCATIONS = ['crib', 'stroller', 'car', 'contact', 'other'] as const;
const PUT_DOWNS = ['drowsy', 'already-asleep', 'self-settled'] as const;

export interface BabyDump {
	id: string;
	name: string | null;
	birthDate: string | null;
	createdAt: number;
	updatedAt: number;
}

export interface TemplateDump extends TemplateInput {
	id: string;
	createdAt: number;
	updatedAt: number;
}

export interface ActiveTemplateDump extends TemplateDump {
	sourceTemplateId: string | null;
}

export interface SleepEntryDump {
	id: string;
	startTime: number;
	endTime: number | null;
	startTimezone: string;
	endTimezone: string | null;
	type: (typeof SLEEP_TYPES)[number];
	location: (typeof LOCATIONS)[number] | null;
	putDown: (typeof PUT_DOWNS)[number] | null;
	notes: string | null;
	createdAt: number;
	updatedAt: number;
}

export interface NightWakingDump {
	id: string;
	sleepEntryId: string;
	time: number;
}

export interface SettingsDump {
	id: string;
	shortNapThresholdMin: number;
	shortNapReductionPercent: number;
	clock24h: boolean;
	dayStartTime: string;
	adviceEnabled: boolean;
	createdAt: number;
	updatedAt: number;
}

// Note: the per-day plan overlay (`day_override`) is intentionally excluded from
// backups. It's ephemeral, scoped to a single local date and auto-expires, so
// carrying it across an export/import (potentially to another day or device) would
// wrongly resurrect a stale one-day adjustment.
export interface BackupDump {
	version: typeof BACKUP_VERSION;
	exportedAt: number;
	baby: BabyDump[];
	templates: TemplateDump[];
	activeTemplate: ActiveTemplateDump | null;
	sleepEntries: SleepEntryDump[];
	nightWakings: NightWakingDump[];
	settings: SettingsDump | null;
}

// ---- low-level field validators (throw 400) --------------------------------

function obj(v: unknown, name: string): Record<string, unknown> {
	if (v === null || typeof v !== 'object' || Array.isArray(v)) {
		throw error(400, `${name} must be a JSON object`);
	}
	return v as Record<string, unknown>;
}

/** An array field that may be omitted (→ []); rejects a present non-array. */
function arr(v: unknown, name: string): unknown[] {
	if (v === undefined) return [];
	if (!Array.isArray(v)) throw error(400, `${name} must be an array`);
	return v;
}

function str(v: unknown, name: string): string {
	if (typeof v !== 'string' || v.length === 0)
		throw error(400, `${name} must be a non-empty string`);
	return v;
}

function strOrNull(v: unknown, name: string): string | null {
	return v == null ? null : str(v, name);
}

function epoch(v: unknown, name: string): number {
	if (typeof v !== 'number' || !Number.isFinite(v))
		throw error(400, `${name} must be an epoch-ms number`);
	return v;
}

function bool(v: unknown, name: string): boolean {
	if (typeof v !== 'boolean') throw error(400, `${name} must be a boolean`);
	return v;
}

function oneOf<T extends readonly string[]>(v: unknown, name: string, allowed: T): T[number] {
	if (typeof v !== 'string' || !allowed.includes(v))
		throw error(400, `${name} must be one of: ${allowed.join(', ')}`);
	return v;
}

// ---- per-row parsers -------------------------------------------------------

function parseBaby(v: unknown): BabyDump {
	const b = obj(v, 'baby entry');
	return {
		id: str(b.id, 'baby.id'),
		name: strOrNull(b.name, 'baby.name'),
		birthDate: strOrNull(b.birthDate, 'baby.birthDate'),
		createdAt: epoch(b.createdAt, 'baby.createdAt'),
		updatedAt: epoch(b.updatedAt, 'baby.updatedAt')
	};
}

function parseTemplateDump(v: unknown): TemplateDump {
	const b = obj(v, 'template');
	// Reuse the full template validation, then attach identity + timestamps.
	return {
		...parseTemplate(b),
		id: str(b.id, 'template.id'),
		createdAt: epoch(b.createdAt, 'template.createdAt'),
		updatedAt: epoch(b.updatedAt, 'template.updatedAt')
	};
}

function parseActiveTemplateDump(v: unknown): ActiveTemplateDump {
	const b = obj(v, 'activeTemplate');
	return {
		...parseTemplateDump(b),
		sourceTemplateId: strOrNull(b.sourceTemplateId, 'activeTemplate.sourceTemplateId')
	};
}

function parseSleepEntry(v: unknown): SleepEntryDump {
	const b = obj(v, 'sleep entry');
	const startTime = epoch(b.startTime, 'sleepEntry.startTime');
	const endTime = b.endTime == null ? null : epoch(b.endTime, 'sleepEntry.endTime');
	if (endTime != null && endTime < startTime)
		throw error(400, 'sleepEntry.endTime must be ≥ startTime');
	// `startTimezone` (current) with a legacy `timezone` fallback (older dumps).
	const startTimezone = str(b.startTimezone ?? b.timezone, 'sleepEntry.startTimezone');
	return {
		id: str(b.id, 'sleepEntry.id'),
		startTime,
		endTime,
		startTimezone,
		endTimezone: b.endTimezone == null ? null : str(b.endTimezone, 'sleepEntry.endTimezone'),
		type: oneOf(b.type, 'sleepEntry.type', SLEEP_TYPES),
		location: b.location == null ? null : oneOf(b.location, 'sleepEntry.location', LOCATIONS),
		putDown: b.putDown == null ? null : oneOf(b.putDown, 'sleepEntry.putDown', PUT_DOWNS),
		notes: strOrNull(b.notes, 'sleepEntry.notes'),
		createdAt: epoch(b.createdAt, 'sleepEntry.createdAt'),
		updatedAt: epoch(b.updatedAt, 'sleepEntry.updatedAt')
	};
}

function parseNightWaking(v: unknown): NightWakingDump {
	const b = obj(v, 'night waking');
	return {
		id: str(b.id, 'nightWaking.id'),
		sleepEntryId: str(b.sleepEntryId, 'nightWaking.sleepEntryId'),
		time: epoch(b.time, 'nightWaking.time')
	};
}

function parseSettings(v: unknown): SettingsDump {
	const b = obj(v, 'settings');
	return {
		id: str(b.id, 'settings.id'),
		shortNapThresholdMin: epoch(b.shortNapThresholdMin, 'settings.shortNapThresholdMin'),
		shortNapReductionPercent: epoch(
			b.shortNapReductionPercent,
			'settings.shortNapReductionPercent'
		),
		clock24h: bool(b.clock24h, 'settings.clock24h'),
		// A legacy `trackTimezone` field (removed) is silently ignored if present.
		dayStartTime: str(b.dayStartTime, 'settings.dayStartTime'),
		// Added after v1; backups predating it default to advice-on.
		adviceEnabled: b.adviceEnabled == null ? true : bool(b.adviceEnabled, 'settings.adviceEnabled'),
		createdAt: epoch(b.createdAt, 'settings.createdAt'),
		updatedAt: epoch(b.updatedAt, 'settings.updatedAt')
	};
}

/**
 * Validate an untrusted parsed-JSON value into a `BackupDump`. Missing arrays
 * default to empty and missing singletons to null, so a partial dump still
 * merges. Throws `error(400, ...)` on any malformed field.
 */
export function parseBackup(raw: unknown): BackupDump {
	const b = obj(raw, 'backup');
	if (b.version !== BACKUP_VERSION) {
		throw error(400, `Unsupported backup version (expected ${BACKUP_VERSION})`);
	}
	return {
		version: BACKUP_VERSION,
		exportedAt: b.exportedAt == null ? Date.now() : epoch(b.exportedAt, 'exportedAt'),
		baby: arr(b.baby, 'baby').map(parseBaby),
		templates: arr(b.templates, 'templates').map(parseTemplateDump),
		activeTemplate: b.activeTemplate == null ? null : parseActiveTemplateDump(b.activeTemplate),
		sleepEntries: arr(b.sleepEntries, 'sleepEntries').map(parseSleepEntry),
		nightWakings: arr(b.nightWakings, 'nightWakings').map(parseNightWaking),
		settings: b.settings == null ? null : parseSettings(b.settings)
	};
}

/**
 * Last-write-wins decision for one row. `existingUpdatedAt` is the stored row's
 * `updatedAt` (epoch-ms) or `undefined` when no such row exists yet.
 */
export function lww(
	existingUpdatedAt: number | undefined,
	incomingUpdatedAt: number
): 'insert' | 'update' | 'skip' {
	if (existingUpdatedAt === undefined) return 'insert';
	return incomingUpdatedAt > existingUpdatedAt ? 'update' : 'skip';
}
