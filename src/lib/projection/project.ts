/**
 * The projection engine (pure). Given the active template, today's logged
 * sleeps, and settings, it cascades relative wake windows forward from the most
 * recent wake to forecast every remaining sleep through bedtime.
 *
 * See REQUIREMENTS.md §5. This module has no DB/route imports and is fully
 * deterministic so it can be unit-tested in isolation.
 */

import { resolveClockTime, minutesToMs, msToMinutes } from './time';
import type { LoggedSleep, ProjectedSleep, Projection, ProjectionInput } from './types';

function reduceWindow(windowMin: number, reductionPercent: number): number {
	return Math.round(windowMin * (1 - reductionPercent / 100));
}

export function project(input: ProjectionInput): Projection {
	const { now, timeZone, template, settings, sleeps } = input;
	const { napCount, wakeWindows, expectedNapDurations } = template;
	const overrides = input.windowOverrides ?? [];

	// Anchor: actual morning wake if logged, else today's reference wake time.
	const anchorIsActual = input.morningWake != null;
	const anchor = anchorIsActual
		? (input.morningWake as number)
		: resolveClockTime(template.referenceWakeTime, now, timeZone);

	// Split logged sleeps into ordered naps and (at most) tonight's bedtime.
	const sorted = [...sleeps].sort((a, b) => a.start - b.start);
	const napEntries = sorted.filter((s) => s.type === 'nap');
	const nightEntry = sorted.find((s) => s.type === 'night') ?? null;

	const result: ProjectedSleep[] = [];
	let lastWake = anchor; // wake that the next window is measured from
	let lastCompletedWake = anchor; // for awake elapsed
	let daytimeUsedMin = 0;
	let napsCompleted = 0;
	let asleepEntry: LoggedSleep | null = null;

	for (let index = 0; index <= napCount; index++) {
		const isBed = index === napCount;
		const type = isBed ? 'night' : 'nap';
		const entry = isBed ? nightEntry : (napEntries[index] ?? null);

		// Template window into this sleep, with per-day override and short-nap rule.
		const override = overrides[index];
		let windowMin = override ?? wakeWindows[index];
		let reduced = false;
		if (override == null && index >= 1) {
			const prev = result[index - 1];
			if (prev && prev.type === 'nap' && prev.tooShort) {
				windowMin = reduceWindow(windowMin, settings.shortNapReductionPercent);
				reduced = true;
			}
		}

		if (entry) {
			const completed = entry.end != null;
			const durationMin = completed ? msToMinutes((entry.end as number) - entry.start) : null;
			const tooShort =
				type === 'nap' && durationMin != null && durationMin <= settings.shortNapThresholdMin;
			// Estimate an end for in-progress sleeps so the cascade can continue.
			const estimatedEnd = completed
				? (entry.end as number)
				: isBed
					? null
					: entry.start + minutesToMs(expectedNapDurations[index]);

			result.push({
				index,
				type,
				status: completed ? 'completed' : 'in-progress',
				start: entry.start,
				end: entry.end,
				projectedEnd: estimatedEnd,
				durationMin,
				wakeWindowBeforeMin: Math.round(msToMinutes(entry.start - lastWake)),
				wakeWindowReduced: false,
				tooShort,
				entryId: entry.id
			});

			if (type === 'nap') {
				if (completed) {
					daytimeUsedMin += durationMin as number;
					napsCompleted += 1;
				} else {
					// In-progress nap: count elapsed toward the daytime budget.
					daytimeUsedMin += Math.max(0, msToMinutes(now - entry.start));
				}
			}

			if (!completed) asleepEntry = entry;
			// Advance the cascade past this sleep (actual end, or estimate).
			if (estimatedEnd != null) lastWake = estimatedEnd;
			if (completed) lastCompletedWake = entry.end as number;
		} else {
			// Projected sleep.
			const start = lastWake + minutesToMs(windowMin);
			const end = isBed ? null : start + minutesToMs(expectedNapDurations[index]);
			result.push({
				index,
				type,
				status: 'projected',
				start,
				end: null,
				projectedEnd: end,
				durationMin: null,
				wakeWindowBeforeMin: windowMin,
				wakeWindowReduced: reduced,
				tooShort: false
			});
			lastWake = end ?? start;
		}
	}

	const nextSleep = result.find((s) => s.status === 'projected') ?? null;

	const asleep = asleepEntry != null;
	const since = asleep ? (asleepEntry as LoggedSleep).start : lastCompletedWake;
	const currentState = {
		asleep,
		since,
		elapsedMin: Math.max(0, msToMinutes(now - since))
	};

	return {
		anchor,
		anchorIsActual,
		sleeps: result,
		nextSleep,
		currentState,
		budget: {
			daytimeUsedMin: Math.round(daytimeUsedMin),
			daytimeCapMin: template.daytimeCap ?? null,
			totalTargetMin: template.dailyTotalSleepTarget ?? null,
			napsCompleted
		}
	};
}
