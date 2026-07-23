/**
 * Idempotent defaults, applied lazily on first read (see the settings/active
 * template query helpers). A fresh self-hosted install therefore comes up with
 * a usable settings row and a runnable active template without any manual step.
 *
 * The example schedule is a plausible ~6-month, 3-nap day. It is *reference*
 * data the user is expected to edit; nothing here is enforced.
 */
import { db } from './index';
import { settings, activeTemplate, baby } from './schema';
import { eq } from 'drizzle-orm';

/** A neutral example day used to seed the initial active template. */
const EXAMPLE_TEMPLATE = {
	name: '3-nap day (example)',
	referenceWakeTime: '07:00',
	napCount: 3,
	// before nap 1, nap 2, nap 3, then bedtime — length napCount + 1.
	wakeWindows: [120, 135, 150, 165],
	// reference nap lengths — length napCount.
	expectedNapDurations: [60, 90, 45],
	dailyTotalSleepTarget: 840, // 14h, reference only
	daytimeCap: 195, // reference only
	bedtimeStart: '19:00',
	bedtimeEnd: '19:30',
	// Enforced redistribution: hold bedtime at 19:00, flex within these bounds.
	targetBedtime: '19:00',
	// length napCount + 1 (before each nap, then bed).
	wakeWindowMin: [90, 105, 120, 135],
	wakeWindowMax: [150, 165, 180, 210],
	// length napCount.
	napDurationMin: [30, 45, 20],
	napDurationMax: [90, 120, 75]
};

/** Ensure the single settings row exists; returns nothing. */
export function ensureSettings(): void {
	const existing = db.select().from(settings).where(eq(settings.id, 'settings')).get();
	if (!existing) {
		db.insert(settings).values({ id: 'settings' }).run();
	}
}

/** Ensure the single baby row exists (birth date left unset by default). */
export function ensureBaby(): void {
	const existing = db.select().from(baby).where(eq(baby.id, 'baby')).get();
	if (!existing) {
		db.insert(baby).values({ id: 'baby' }).run();
	}
}

/** Ensure the single active-template row exists, seeded from the example. */
export function ensureActiveTemplate(): void {
	const existing = db.select().from(activeTemplate).where(eq(activeTemplate.id, 'active')).get();
	if (!existing) {
		db.insert(activeTemplate)
			.values({ id: 'active', sourceTemplateId: null, ...EXAMPLE_TEMPLATE })
			.run();
	}
}
