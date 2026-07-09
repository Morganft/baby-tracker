/**
 * Server-only data access for the single global settings row, seeded with
 * defaults on first read.
 */
import { db } from '../db/index';
import { settings } from '../db/schema';
import { eq } from 'drizzle-orm';
import { ensureSettings } from '../db/seed';
import type { SettingsUpdate } from '../api/validate';

export interface SettingsDTO {
	shortNapThresholdMin: number;
	shortNapReductionPercent: number;
	clock24h: boolean;
	trackTimezone: boolean;
	createdAt: number;
	updatedAt: number;
}

type Row = typeof settings.$inferSelect;

function toDTO(row: Row): SettingsDTO {
	return {
		shortNapThresholdMin: row.shortNapThresholdMin,
		shortNapReductionPercent: row.shortNapReductionPercent,
		clock24h: row.clock24h,
		trackTimezone: row.trackTimezone,
		createdAt: row.createdAt.getTime(),
		updatedAt: row.updatedAt.getTime()
	};
}

export function getSettings(): SettingsDTO {
	ensureSettings();
	const row = db.select().from(settings).where(eq(settings.id, 'settings')).get();
	return toDTO(row!);
}

/** Apply a partial edit and bump `updated_at` for last-write-wins. */
export function updateSettings(patch: SettingsUpdate): SettingsDTO {
	ensureSettings();
	const row = db
		.update(settings)
		.set({ ...patch, updatedAt: new Date() })
		.where(eq(settings.id, 'settings'))
		.returning()
		.get();
	return toDTO(row!);
}
