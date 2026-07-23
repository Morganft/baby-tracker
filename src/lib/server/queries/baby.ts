/**
 * Server-only data access for the single global baby row, lazily created on
 * first read. Birth date is optional; when unset the advice system falls back
 * to data-only guidance.
 */
import { db } from '../db/index';
import { baby } from '../db/schema';
import { eq } from 'drizzle-orm';
import { ensureBaby } from '../db/seed';
import type { BabyUpdate } from '../api/validate';

export interface BabyDTO {
	name: string | null;
	birthDate: string | null;
	createdAt: number;
	updatedAt: number;
}

type Row = typeof baby.$inferSelect;

function toDTO(row: Row): BabyDTO {
	return {
		name: row.name,
		birthDate: row.birthDate,
		createdAt: row.createdAt.getTime(),
		updatedAt: row.updatedAt.getTime()
	};
}

export function getBaby(): BabyDTO {
	ensureBaby();
	const row = db.select().from(baby).where(eq(baby.id, 'baby')).get();
	return toDTO(row!);
}

/** Apply a partial edit and bump `updated_at` for last-write-wins. */
export function updateBaby(patch: BabyUpdate): BabyDTO {
	ensureBaby();
	const row = db
		.update(baby)
		.set({ ...patch, updatedAt: new Date() })
		.where(eq(baby.id, 'baby'))
		.returning()
		.get();
	return toDTO(row!);
}
