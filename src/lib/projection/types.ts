/**
 * Input/output types for the projection engine. Kept independent of the Drizzle
 * row types so the engine has no server-only imports and stays unit-testable.
 */

/** The subset of an active template the engine needs. Durations are minutes. */
export interface TemplateConfig {
	/** Target morning wake, 'HH:MM' local — the day anchor before an actual wake. */
	referenceWakeTime: string;
	napCount: number;
	/** Ordered awake durations: length `napCount + 1` (before each nap, then bed). */
	wakeWindows: number[];
	/** Reference durations for not-yet-happened naps: length `napCount`. */
	expectedNapDurations: number[];
	/**
	 * Target bedtime, 'HH:MM' local. When set (and tonight's bedtime isn't logged
	 * yet), the remaining projected sleeps are **redistributed** to land on this
	 * fixed time instead of sliding — see REQUIREMENTS §5.2. Absent → legacy cascade.
	 */
	targetBedtime?: string | null;
	/**
	 * Per-position min/max bounds (minutes) enforced during redistribution.
	 * `wakeWindow*` align with `wakeWindows` (length `napCount + 1`);
	 * `napDuration*` align with `expectedNapDurations` (length `napCount`).
	 * Missing entries default to unbounded (0 … +∞).
	 */
	wakeWindowMin?: number[];
	wakeWindowMax?: number[];
	napDurationMin?: number[];
	napDurationMax?: number[];
	/** Reference-only budgets (never alter projected times). */
	daytimeCap?: number | null;
	dailyTotalSleepTarget?: number | null;
}

export interface ProjectionSettings {
	shortNapThresholdMin: number;
	shortNapReductionPercent: number;
}

/** A logged sleep for the current day (nap, or tonight's bedtime once started). */
export interface LoggedSleep {
	id: string;
	type: 'nap' | 'night';
	/** epoch-ms. */
	start: number;
	/** epoch-ms; null while the sleep is in progress. */
	end: number | null;
}

export interface ProjectionInput {
	/** Current instant, epoch-ms — drives elapsed/current-state figures. */
	now: number;
	/** IANA zone used to resolve `referenceWakeTime` on today's calendar day. */
	timeZone: string;
	template: TemplateConfig;
	settings: ProjectionSettings;
	/** Today's logged sleeps (naps + optional bedtime), any order. */
	sleeps: LoggedSleep[];
	/** Actual morning wake (end of last night's sleep), if logged. */
	morningWake?: number | null;
	/**
	 * Per-day manual overrides for a wake window, indexed like `wakeWindows`.
	 * A number replaces the template value (and suppresses short-nap reduction);
	 * null/undefined means no override.
	 */
	windowOverrides?: (number | null | undefined)[];
}

export type SleepStatus = 'completed' | 'in-progress' | 'projected';

export interface ProjectedSleep {
	/** Position in the day: 0..napCount-1 are naps, napCount is bedtime/night. */
	index: number;
	type: 'nap' | 'night';
	status: SleepStatus;
	/** epoch-ms. Actual for logged sleeps, projected otherwise. */
	start: number;
	/** epoch-ms actual end; null while in progress or for bedtime. */
	end: number | null;
	/** Best estimate of the end (actual, or projected from expected duration). */
	projectedEnd: number | null;
	/** Duration in minutes if completed, else null. */
	durationMin: number | null;
	/** Wake window leading into this sleep: actual gap if logged, else template. */
	wakeWindowBeforeMin: number;
	/** True when the short-nap rule shortened a projected window. */
	wakeWindowReduced: boolean;
	/** Completed nap whose duration is ≤ the short-nap threshold. */
	tooShort: boolean;
	/** Set when this sleep is backed by a logged entry. */
	entryId?: string;
}

export interface Projection {
	/** Day anchor (epoch-ms): actual morning wake or resolved reference time. */
	anchor: number;
	/** True when the anchor is an actual logged wake, false when it's reference. */
	anchorIsActual: boolean;
	/** Every sleep of the day in order: completed, in-progress, then projected. */
	sleeps: ProjectedSleep[];
	/** The next sleep to put the baby down for (first still-projected sleep). */
	nextSleep: ProjectedSleep | null;
	currentState: {
		asleep: boolean;
		/** Start of the current sleep (asleep) or the last wake (awake). */
		since: number;
		elapsedMin: number;
	};
	budget: {
		/** Daytime (nap) sleep used so far, incl. an in-progress nap's elapsed. */
		daytimeUsedMin: number;
		daytimeCapMin: number | null;
		totalTargetMin: number | null;
		napsCompleted: number;
		/** Awake time elapsed since the anchor so far (= elapsed − daytime sleep). */
		wakeUsedMin: number;
		/** Planned total awake time for the day = sum of the template wake windows. */
		wakeBudgetMin: number;
	};
}
