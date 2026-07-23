/**
 * Server-only export/import for the whole dataset (REQUIREMENTS §6). Export
 * dumps every table as one JSON object; import merges by UUID with last-write-
 * wins on `updatedAt` (see `./dump.ts` for the pure format + merge decision).
 *
 * Import runs in a single transaction so a malformed dump leaves the DB
 * unchanged, and writes timestamps verbatim so re-importing the same dump is a
 * no-op (every row resolves to `skip`).
 */
import { db } from '../db/index';
import { baby, template, activeTemplate, sleepEntry, nightWaking, settings } from '../db/schema';
import { eq } from 'drizzle-orm';
import {
	parseBackup,
	lww,
	BACKUP_VERSION,
	type BackupDump,
	type TemplateDump,
	type ActiveTemplateDump,
	type SleepEntryDump
} from './dump';

// ---- Export ----------------------------------------------------------------

/** The template-shaped columns, shared by library + active dumps. */
function templateColumns(row: typeof template.$inferSelect) {
	return {
		name: row.name,
		referenceWakeTime: row.referenceWakeTime,
		napCount: row.napCount,
		wakeWindows: row.wakeWindows,
		expectedNapDurations: row.expectedNapDurations,
		dailyTotalSleepTarget: row.dailyTotalSleepTarget ?? null,
		daytimeCap: row.daytimeCap ?? null,
		bedtimeStart: row.bedtimeStart ?? null,
		bedtimeEnd: row.bedtimeEnd ?? null,
		targetBedtime: row.targetBedtime ?? null,
		wakeWindowMin: row.wakeWindowMin ?? null,
		wakeWindowMax: row.wakeWindowMax ?? null,
		napDurationMin: row.napDurationMin ?? null,
		napDurationMax: row.napDurationMax ?? null,
		createdAt: row.createdAt.getTime(),
		updatedAt: row.updatedAt.getTime()
	};
}

/** Read every table into a single JSON-serialisable dump (timestamps → epoch-ms). */
export function exportData(): BackupDump {
	const activeRow =
		db.select().from(activeTemplate).where(eq(activeTemplate.id, 'active')).get() ?? null;
	const settingsRow = db.select().from(settings).where(eq(settings.id, 'settings')).get() ?? null;

	return {
		version: BACKUP_VERSION,
		exportedAt: Date.now(),
		baby: db
			.select()
			.from(baby)
			.all()
			.map((r) => ({
				id: r.id,
				name: r.name ?? null,
				birthDate: r.birthDate ?? null,
				createdAt: r.createdAt.getTime(),
				updatedAt: r.updatedAt.getTime()
			})),
		templates: db
			.select()
			.from(template)
			.all()
			.map((r) => ({ id: r.id, ...templateColumns(r) })),
		activeTemplate: activeRow
			? {
					id: activeRow.id,
					sourceTemplateId: activeRow.sourceTemplateId ?? null,
					...templateColumns(activeRow as unknown as typeof template.$inferSelect)
				}
			: null,
		sleepEntries: db
			.select()
			.from(sleepEntry)
			.all()
			.map((r) => ({
				id: r.id,
				startTime: r.startTime.getTime(),
				endTime: r.endTime ? r.endTime.getTime() : null,
				startTimezone: r.startTimezone,
				endTimezone: r.endTimezone ?? null,
				type: r.type,
				location: r.location ?? null,
				putDown: r.putDown ?? null,
				notes: r.notes ?? null,
				createdAt: r.createdAt.getTime(),
				updatedAt: r.updatedAt.getTime()
			})),
		nightWakings: db
			.select()
			.from(nightWaking)
			.all()
			.map((r) => ({ id: r.id, sleepEntryId: r.sleepEntryId, time: r.time.getTime() })),
		settings: settingsRow
			? {
					id: settingsRow.id,
					shortNapThresholdMin: settingsRow.shortNapThresholdMin,
					shortNapReductionPercent: settingsRow.shortNapReductionPercent,
					clock24h: settingsRow.clock24h,
					dayStartTime: settingsRow.dayStartTime,
					adviceEnabled: settingsRow.adviceEnabled,
					createdAt: settingsRow.createdAt.getTime(),
					updatedAt: settingsRow.updatedAt.getTime()
				}
			: null
	};
}

// ---- Import ----------------------------------------------------------------

export interface MergeCounts {
	inserted: number;
	updated: number;
	skipped: number;
}

export interface ImportResult {
	baby: MergeCounts;
	templates: MergeCounts;
	activeTemplate: MergeCounts;
	sleepEntries: MergeCounts;
	nightWakings: MergeCounts & { orphaned: number };
	settings: MergeCounts;
}

const zero = (): MergeCounts => ({ inserted: 0, updated: 0, skipped: 0 });

/** Template-shaped write values from a dump row, timestamps preserved verbatim. */
function templateValues(row: TemplateDump) {
	return {
		name: row.name,
		referenceWakeTime: row.referenceWakeTime,
		napCount: row.napCount,
		wakeWindows: row.wakeWindows,
		expectedNapDurations: row.expectedNapDurations,
		dailyTotalSleepTarget: row.dailyTotalSleepTarget,
		daytimeCap: row.daytimeCap,
		bedtimeStart: row.bedtimeStart,
		bedtimeEnd: row.bedtimeEnd,
		targetBedtime: row.targetBedtime,
		wakeWindowMin: row.wakeWindowMin,
		wakeWindowMax: row.wakeWindowMax,
		napDurationMin: row.napDurationMin,
		napDurationMax: row.napDurationMax,
		createdAt: new Date(row.createdAt),
		updatedAt: new Date(row.updatedAt)
	};
}

function sleepValues(row: SleepEntryDump) {
	return {
		startTime: new Date(row.startTime),
		endTime: row.endTime == null ? null : new Date(row.endTime),
		startTimezone: row.startTimezone,
		endTimezone: row.endTimezone,
		type: row.type,
		location: row.location,
		putDown: row.putDown,
		notes: row.notes,
		createdAt: new Date(row.createdAt),
		updatedAt: new Date(row.updatedAt)
	};
}

/**
 * Merge a dump into the DB. Validates first (throws 400 on malformed input),
 * then applies every table inside one transaction. Idempotent under re-import.
 */
export function importData(raw: unknown): ImportResult {
	const dump = parseBackup(raw);
	const result: ImportResult = {
		baby: zero(),
		templates: zero(),
		activeTemplate: zero(),
		sleepEntries: zero(),
		nightWakings: { ...zero(), orphaned: 0 },
		settings: zero()
	};

	db.transaction((tx) => {
		// baby
		for (const row of dump.baby) {
			const existing = tx.select().from(baby).where(eq(baby.id, row.id)).get();
			const decision = lww(existing?.updatedAt.getTime(), row.updatedAt);
			const values = {
				name: row.name,
				birthDate: row.birthDate,
				createdAt: new Date(row.createdAt),
				updatedAt: new Date(row.updatedAt)
			};
			if (decision === 'insert') {
				tx.insert(baby)
					.values({ id: row.id, ...values })
					.run();
				result.baby.inserted++;
			} else if (decision === 'update') {
				tx.update(baby).set(values).where(eq(baby.id, row.id)).run();
				result.baby.updated++;
			} else result.baby.skipped++;
		}

		// library templates
		for (const row of dump.templates) {
			const existing = tx.select().from(template).where(eq(template.id, row.id)).get();
			const decision = lww(existing?.updatedAt.getTime(), row.updatedAt);
			if (decision === 'insert') {
				tx.insert(template)
					.values({ id: row.id, ...templateValues(row) })
					.run();
				result.templates.inserted++;
			} else if (decision === 'update') {
				tx.update(template).set(templateValues(row)).where(eq(template.id, row.id)).run();
				result.templates.updated++;
			} else result.templates.skipped++;
		}

		// active slot (singleton)
		const active: ActiveTemplateDump | null = dump.activeTemplate;
		if (active) {
			const existing = tx
				.select()
				.from(activeTemplate)
				.where(eq(activeTemplate.id, active.id))
				.get();
			const decision = lww(existing?.updatedAt.getTime(), active.updatedAt);
			const values = { sourceTemplateId: active.sourceTemplateId, ...templateValues(active) };
			if (decision === 'insert') {
				tx.insert(activeTemplate)
					.values({ id: active.id, ...values })
					.run();
				result.activeTemplate.inserted++;
			} else if (decision === 'update') {
				tx.update(activeTemplate).set(values).where(eq(activeTemplate.id, active.id)).run();
				result.activeTemplate.updated++;
			} else result.activeTemplate.skipped++;
		}

		// sleep entries
		for (const row of dump.sleepEntries) {
			const existing = tx.select().from(sleepEntry).where(eq(sleepEntry.id, row.id)).get();
			const decision = lww(existing?.updatedAt.getTime(), row.updatedAt);
			if (decision === 'insert') {
				tx.insert(sleepEntry)
					.values({ id: row.id, ...sleepValues(row) })
					.run();
				result.sleepEntries.inserted++;
			} else if (decision === 'update') {
				tx.update(sleepEntry).set(sleepValues(row)).where(eq(sleepEntry.id, row.id)).run();
				result.sleepEntries.updated++;
			} else result.sleepEntries.skipped++;
		}

		// night wakings — no timestamps: dedupe by id; skip orphans (missing parent).
		for (const row of dump.nightWakings) {
			const existing = tx.select().from(nightWaking).where(eq(nightWaking.id, row.id)).get();
			if (existing) {
				result.nightWakings.skipped++;
				continue;
			}
			const parent = tx
				.select({ id: sleepEntry.id })
				.from(sleepEntry)
				.where(eq(sleepEntry.id, row.sleepEntryId))
				.get();
			if (!parent) {
				result.nightWakings.orphaned++;
				continue;
			}
			tx.insert(nightWaking)
				.values({ id: row.id, sleepEntryId: row.sleepEntryId, time: new Date(row.time) })
				.run();
			result.nightWakings.inserted++;
		}

		// settings (singleton)
		if (dump.settings) {
			const s = dump.settings;
			const existing = tx.select().from(settings).where(eq(settings.id, s.id)).get();
			const decision = lww(existing?.updatedAt.getTime(), s.updatedAt);
			const values = {
				shortNapThresholdMin: s.shortNapThresholdMin,
				shortNapReductionPercent: s.shortNapReductionPercent,
				clock24h: s.clock24h,
				dayStartTime: s.dayStartTime,
				adviceEnabled: s.adviceEnabled,
				createdAt: new Date(s.createdAt),
				updatedAt: new Date(s.updatedAt)
			};
			if (decision === 'insert') {
				tx.insert(settings)
					.values({ id: s.id, ...values })
					.run();
				result.settings.inserted++;
			} else if (decision === 'update') {
				tx.update(settings).set(values).where(eq(settings.id, s.id)).run();
				result.settings.updated++;
			} else result.settings.skipped++;
		}
	});

	return result;
}
