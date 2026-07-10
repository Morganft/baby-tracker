/**
 * Server-only data access for the template library and the single active slot.
 *
 * Domain rule (REQUIREMENTS §4): the active slot is a persistent, freely-editable
 * *copy*. Editing it never mutates a library template; loading a library template
 * copies its fields into the active row; saving to the library is a separate,
 * explicit template create/overwrite. These functions keep those paths disjoint.
 */
import { db } from '../db/index';
import { template, activeTemplate } from '../db/schema';
import { eq } from 'drizzle-orm';
import { ensureActiveTemplate } from '../db/seed';
import type { TemplateInput } from '../api/validate';

export interface TemplateDTO extends TemplateInput {
	id: string;
	createdAt: number;
	updatedAt: number;
}

export interface ActiveTemplateDTO extends TemplateDTO {
	/** Library template this slot was last loaded from, if any. */
	sourceTemplateId: string | null;
}

type TemplateRow = typeof template.$inferSelect;
type ActiveRow = typeof activeTemplate.$inferSelect;

function toTemplateDTO(row: TemplateRow): TemplateDTO {
	return {
		id: row.id,
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

function toActiveDTO(row: ActiveRow): ActiveTemplateDTO {
	return {
		...toTemplateDTO(row as unknown as TemplateRow),
		sourceTemplateId: row.sourceTemplateId ?? null
	};
}

/** The template columns, from a validated body — shared by every write path. */
function columns(input: TemplateInput) {
	return {
		name: input.name,
		referenceWakeTime: input.referenceWakeTime,
		napCount: input.napCount,
		wakeWindows: input.wakeWindows,
		expectedNapDurations: input.expectedNapDurations,
		dailyTotalSleepTarget: input.dailyTotalSleepTarget,
		daytimeCap: input.daytimeCap,
		bedtimeStart: input.bedtimeStart,
		bedtimeEnd: input.bedtimeEnd,
		targetBedtime: input.targetBedtime,
		wakeWindowMin: input.wakeWindowMin,
		wakeWindowMax: input.wakeWindowMax,
		napDurationMin: input.napDurationMin,
		napDurationMax: input.napDurationMax
	};
}

// ---- Library ----------------------------------------------------------------

export function listTemplates(): TemplateDTO[] {
	return db.select().from(template).all().map(toTemplateDTO);
}

export function getTemplate(id: string): TemplateDTO | null {
	const row = db.select().from(template).where(eq(template.id, id)).get();
	return row ? toTemplateDTO(row) : null;
}

/** Create a library template (e.g. saving the active slot as a new named entry). */
export function createTemplate(input: TemplateInput, id?: string): TemplateDTO {
	const row = db
		.insert(template)
		.values({ ...(id ? { id } : {}), ...columns(input) })
		.returning()
		.get();
	return toTemplateDTO(row);
}

/** Overwrite a library template in place. Null if it does not exist. */
export function updateTemplate(id: string, input: TemplateInput): TemplateDTO | null {
	const row = db
		.update(template)
		.set({ ...columns(input), updatedAt: new Date() })
		.where(eq(template.id, id))
		.returning()
		.get();
	return row ? toTemplateDTO(row) : null;
}

export function deleteTemplate(id: string): boolean {
	return (
		db.delete(template).where(eq(template.id, id)).returning({ id: template.id }).all().length > 0
	);
}

// ---- Active slot ------------------------------------------------------------

/** The active slot, seeded from the example template on first read. */
export function getActiveTemplate(): ActiveTemplateDTO {
	ensureActiveTemplate();
	const row = db.select().from(activeTemplate).where(eq(activeTemplate.id, 'active')).get();
	// ensureActiveTemplate guarantees the row exists.
	return toActiveDTO(row!);
}

/** Edit the active slot in place (full overwrite of its template fields). */
export function updateActiveTemplate(input: TemplateInput): ActiveTemplateDTO {
	ensureActiveTemplate();
	const row = db
		.update(activeTemplate)
		.set({ ...columns(input), updatedAt: new Date() })
		.where(eq(activeTemplate.id, 'active'))
		.returning()
		.get();
	return toActiveDTO(row!);
}

/**
 * Load a library template into the active slot: copies its fields and records
 * the source. Never mutates the library template. Null if the source is missing.
 */
export function loadActiveTemplate(templateId: string): ActiveTemplateDTO | null {
	const source = db.select().from(template).where(eq(template.id, templateId)).get();
	if (!source) return null;
	ensureActiveTemplate();
	const row = db
		.update(activeTemplate)
		.set({ ...columns(source), sourceTemplateId: templateId, updatedAt: new Date() })
		.where(eq(activeTemplate.id, 'active'))
		.returning()
		.get();
	return toActiveDTO(row!);
}
