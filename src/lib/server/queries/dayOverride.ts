/**
 * Server-only data access for the per-day plan overlay (REQUIREMENTS §5.3.6).
 *
 * An overlay is a full template-shaped snapshot scoped to one local calendar
 * day. When a row exists for "today" the projection uses it in place of the
 * active slot, so a caregiver can reshape just today (drop/add a nap, stretch a
 * window or nap) without touching their saved plan. Rows are keyed by the local
 * date they apply to and pruned once that date has passed, so the overlay
 * auto-expires and the next day reverts to the active plan.
 */
import { db } from '../db/index';
import { dayOverride } from '../db/schema';
import { eq, lt } from 'drizzle-orm';
import type { TemplateInput } from '../api/validate';
import { columns, toTemplateDTO, type ActiveTemplateDTO } from './templates';

type DayOverrideRow = typeof dayOverride.$inferSelect;

/**
 * The overlay row as an active-template-shaped DTO. Its `id` is the date it
 * applies to and `sourceTemplateId` is always null — matching `ActiveTemplateDTO`
 * so the editor and projection can treat overlay and active slot uniformly.
 */
function toDTO(row: DayOverrideRow): ActiveTemplateDTO {
	return {
		...toTemplateDTO({ ...row, id: row.date } as unknown as Parameters<typeof toTemplateDTO>[0]),
		sourceTemplateId: null
	};
}

/** The overlay for `date` ('YYYY-MM-DD' local), or null. Prunes stale rows first. */
export function getDayOverride(date: string): ActiveTemplateDTO | null {
	pruneStaleOverrides(date);
	const row = db.select().from(dayOverride).where(eq(dayOverride.date, date)).get();
	return row ? toDTO(row) : null;
}

/** Create or replace the overlay for `date` (full overwrite of its fields). */
export function upsertDayOverride(date: string, input: TemplateInput): ActiveTemplateDTO {
	const row = db
		.insert(dayOverride)
		.values({ date, ...columns(input) })
		.onConflictDoUpdate({
			target: dayOverride.date,
			set: { ...columns(input), updatedAt: new Date() }
		})
		.returning()
		.get();
	return toDTO(row);
}

/** Delete the overlay for `date`. Returns true if a row was removed. */
export function clearDayOverride(date: string): boolean {
	return (
		db
			.delete(dayOverride)
			.where(eq(dayOverride.date, date))
			.returning({ date: dayOverride.date })
			.all().length > 0
	);
}

/** Drop every overlay whose date is before `todayKey` — the auto-expiry sweep. */
export function pruneStaleOverrides(todayKey: string): void {
	db.delete(dayOverride).where(lt(dayOverride.date, todayKey)).run();
}
