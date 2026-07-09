import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

/**
 * Timestamps used for last-write-wins merge on import and general auditing.
 * Stored as epoch-ms integers, surfaced as `Date`.
 */
const timestamps = {
	createdAt: integer('created_at', { mode: 'timestamp_ms' })
		.notNull()
		.$defaultFn(() => new Date()),
	updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
		.notNull()
		.$defaultFn(() => new Date())
};

/** The (single, for v1) baby. Birth date is optional and only used to show age. */
export const baby = sqliteTable('baby', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	name: text('name'),
	birthDate: text('birth_date'), // ISO yyyy-mm-dd, optional
	...timestamps
});

/**
 * Columns shared by library `template` rows and the single `active_template`
 * row. All durations are in minutes; clock fields are 'HH:MM' local time.
 * `wakeWindows` has length `napCount + 1` (windows before each nap + before bed);
 * `expectedNapDurations` has length `napCount`.
 */
const templateColumns = {
	name: text('name').notNull(),
	referenceWakeTime: text('reference_wake_time').notNull(), // 'HH:MM'
	napCount: integer('nap_count').notNull(),
	wakeWindows: text('wake_windows', { mode: 'json' }).$type<number[]>().notNull(),
	expectedNapDurations: text('expected_nap_durations', { mode: 'json' })
		.$type<number[]>()
		.notNull(),
	dailyTotalSleepTarget: integer('daily_total_sleep_target'), // minutes, reference only
	daytimeCap: integer('daytime_cap'), // minutes, reference only
	bedtimeStart: text('bedtime_start'), // 'HH:MM', reference only
	bedtimeEnd: text('bedtime_end') // 'HH:MM', reference only
};

/** User-authored library of schedule templates. */
export const template = sqliteTable('template', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	...templateColumns,
	...timestamps
});

/**
 * The single "active slot": a persistent, freely-editable copy of a library
 * template that drives the daily projection. Editing it never touches the
 * library. `sourceTemplateId` records where it was copied from (nullable).
 */
export const activeTemplate = sqliteTable('active_template', {
	id: text('id').primaryKey().default('active'),
	sourceTemplateId: text('source_template_id'),
	...templateColumns,
	...timestamps
});

/**
 * A single sleep. Times are absolute (epoch-ms); `timezone` is the IANA zone
 * captured at entry time so travel/DST render correctly.
 */
export const sleepEntry = sqliteTable('sleep_entry', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	startTime: integer('start_time', { mode: 'timestamp_ms' }).notNull(),
	endTime: integer('end_time', { mode: 'timestamp_ms' }), // null while in progress
	timezone: text('timezone').notNull(), // IANA, e.g. 'Europe/Prague'
	type: text('type', { enum: ['nap', 'night'] }).notNull(),
	location: text('location', {
		enum: ['crib', 'stroller', 'car', 'contact', 'other']
	}),
	putDown: text('put_down', { enum: ['drowsy', 'already-asleep', 'self-settled'] }),
	notes: text('notes'),
	...timestamps
});

/** Timestamped wakings within a night sleep. */
export const nightWaking = sqliteTable('night_waking', {
	id: text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	sleepEntryId: text('sleep_entry_id')
		.notNull()
		.references(() => sleepEntry.id, { onDelete: 'cascade' }),
	time: integer('time', { mode: 'timestamp_ms' }).notNull()
});

/** Single-row global settings. */
export const settings = sqliteTable('settings', {
	id: text('id').primaryKey().default('settings'),
	shortNapThresholdMin: integer('short_nap_threshold_min').notNull().default(15),
	shortNapReductionPercent: integer('short_nap_reduction_percent').notNull().default(30),
	clock24h: integer('clock_24h', { mode: 'boolean' }).notNull().default(true),
	trackTimezone: integer('track_timezone', { mode: 'boolean' }).notNull().default(true),
	...timestamps
});

export type Baby = typeof baby.$inferSelect;
export type Template = typeof template.$inferSelect;
export type ActiveTemplate = typeof activeTemplate.$inferSelect;
export type SleepEntry = typeof sleepEntry.$inferSelect;
export type NightWaking = typeof nightWaking.$inferSelect;
export type Settings = typeof settings.$inferSelect;
