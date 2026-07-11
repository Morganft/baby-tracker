/**
 * Server-only data access for sleep entries and their night wakings, plus
 * `assembleDay` which turns stored rows into the projection engine's inputs.
 * Times cross the API boundary as epoch-ms numbers; Drizzle stores them as
 * absolute timestamps (`timestamp_ms`) alongside each entry's IANA timezone.
 */
import { db } from '../db/index';
import { sleepEntry, nightWaking } from '../db/schema';
import { eq, inArray, desc, isNull } from 'drizzle-orm';
import { groupDay, type DayEntry, type DayGrouping } from './day';
import type { SleepCreate, SleepUpdate } from '../api/validate';

/** API representation of a sleep entry. All times are epoch-ms. */
export interface SleepDTO {
	id: string;
	startTime: number;
	endTime: number | null;
	/** IANA zone the sleep started in. */
	startTimezone: string;
	/** IANA zone the sleep ended in; null while in progress (or on legacy rows). */
	endTimezone: string | null;
	type: 'nap' | 'night';
	location: string | null;
	putDown: string | null;
	notes: string | null;
	/** Timestamps of wakings within this (night) sleep, ascending. */
	nightWakings: number[];
	createdAt: number;
	updatedAt: number;
}

type Row = typeof sleepEntry.$inferSelect;

function toDTO(row: Row, wakings: number[]): SleepDTO {
	return {
		id: row.id,
		startTime: row.startTime.getTime(),
		endTime: row.endTime ? row.endTime.getTime() : null,
		startTimezone: row.startTimezone,
		endTimezone: row.endTimezone ?? null,
		type: row.type,
		location: row.location ?? null,
		putDown: row.putDown ?? null,
		notes: row.notes ?? null,
		nightWakings: wakings,
		createdAt: row.createdAt.getTime(),
		updatedAt: row.updatedAt.getTime()
	};
}

/** Load wakings for a set of entries, grouped by entry id and sorted ascending. */
function wakingsFor(entryIds: string[]): Map<string, number[]> {
	const byEntry = new Map<string, number[]>();
	if (entryIds.length === 0) return byEntry;
	const rows = db
		.select()
		.from(nightWaking)
		.where(inArray(nightWaking.sleepEntryId, entryIds))
		.all();
	for (const w of rows) {
		const list = byEntry.get(w.sleepEntryId) ?? [];
		list.push(w.time.getTime());
		byEntry.set(w.sleepEntryId, list);
	}
	for (const list of byEntry.values()) list.sort((a, b) => a - b);
	return byEntry;
}

function hydrate(rows: Row[]): SleepDTO[] {
	const wakings = wakingsFor(rows.map((r) => r.id));
	return rows.map((r) => toDTO(r, wakings.get(r.id) ?? []));
}

/** All sleeps, most recent first. */
export function listSleeps(): SleepDTO[] {
	return hydrate(db.select().from(sleepEntry).orderBy(desc(sleepEntry.startTime)).all());
}

/**
 * Map of entry id → captured start/end zones. The live views (Home, Timeline)
 * render "today" in one display zone but use this to label a logged block whose
 * captured zone differs (travel) — keyed by `ProjectedSleep.entryId`, so the
 * pure projection engine never has to carry display-zone metadata.
 */
export function listEntryZones(): Record<string, { start: string; end: string | null }> {
	const rows = db
		.select({
			id: sleepEntry.id,
			start: sleepEntry.startTimezone,
			end: sleepEntry.endTimezone
		})
		.from(sleepEntry)
		.all();
	const out: Record<string, { start: string; end: string | null }> = {};
	for (const r of rows) out[r.id] = { start: r.start, end: r.end ?? null };
	return out;
}

export function getSleep(id: string): SleepDTO | null {
	const row = db.select().from(sleepEntry).where(eq(sleepEntry.id, id)).get();
	return row ? hydrate([row])[0] : null;
}

/**
 * The sleep currently in progress (no `end_time`), if any — the most recently
 * started one. Independent of day/night grouping so the "woke up" quick-log can
 * end whatever the baby is asleep in, including last night's still-ongoing sleep.
 */
export function getActiveSleep(): SleepDTO | null {
	const row = db
		.select()
		.from(sleepEntry)
		.where(isNull(sleepEntry.endTime))
		.orderBy(desc(sleepEntry.startTime))
		.get();
	return row ? hydrate([row])[0] : null;
}

/** Insert a sleep. Honors a client-generated UUID; the DB generates one if absent. */
export function createSleep(input: SleepCreate): SleepDTO {
	const row = db
		.insert(sleepEntry)
		.values({
			...(input.id ? { id: input.id } : {}),
			startTime: new Date(input.startTime),
			endTime: input.endTime == null ? null : new Date(input.endTime),
			startTimezone: input.startTimezone,
			endTimezone: input.endTimezone,
			type: input.type,
			location: input.location,
			putDown: input.putDown,
			notes: input.notes
		})
		.returning()
		.get();
	return toDTO(row, []);
}

/** Apply a partial edit and bump `updated_at` for last-write-wins. Null if absent. */
export function updateSleep(id: string, patch: SleepUpdate): SleepDTO | null {
	const set: Partial<Row> & { updatedAt: Date } = { updatedAt: new Date() };
	if ('startTime' in patch) set.startTime = new Date(patch.startTime as number);
	if ('endTime' in patch) set.endTime = patch.endTime == null ? null : new Date(patch.endTime);
	if ('startTimezone' in patch) set.startTimezone = patch.startTimezone;
	if ('endTimezone' in patch) set.endTimezone = patch.endTimezone;
	if ('type' in patch) set.type = patch.type;
	if ('location' in patch) set.location = patch.location;
	if ('putDown' in patch) set.putDown = patch.putDown;
	if ('notes' in patch) set.notes = patch.notes;

	const row = db.update(sleepEntry).set(set).where(eq(sleepEntry.id, id)).returning().get();
	return row ? hydrate([row])[0] : null;
}

/** Delete a sleep (cascades its wakings). Returns whether a row was removed. */
export function deleteSleep(id: string): boolean {
	return (
		db.delete(sleepEntry).where(eq(sleepEntry.id, id)).returning({ id: sleepEntry.id }).all()
			.length > 0
	);
}

/** Add a waking to a (night) sleep; returns the refreshed parent, or null. */
export function addWaking(sleepId: string, time: number): SleepDTO | null {
	const parent = db.select().from(sleepEntry).where(eq(sleepEntry.id, sleepId)).get();
	if (!parent) return null;
	db.insert(nightWaking)
		.values({ sleepEntryId: sleepId, time: new Date(time) })
		.run();
	return hydrate([parent])[0];
}

/** Delete a single waking. Returns whether a row was removed. */
export function deleteWaking(wakingId: string): boolean {
	return (
		db
			.delete(nightWaking)
			.where(eq(nightWaking.id, wakingId))
			.returning({ id: nightWaking.id })
			.all().length > 0
	);
}

/**
 * Assemble today's projection inputs from the DB: naps started today plus
 * tonight's bedtime, and this morning's actual wake (end of last night's sleep).
 * See `groupDay` for the day/night grouping rule.
 */
export function assembleDay(now: number, timeZone: string): DayGrouping {
	const rows = db.select().from(sleepEntry).all();
	const entries: DayEntry[] = rows.map((r) => ({
		id: r.id,
		type: r.type,
		start: r.startTime.getTime(),
		end: r.endTime ? r.endTime.getTime() : null
	}));
	return groupDay(entries, now, timeZone);
}
