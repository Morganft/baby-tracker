/**
 * In-day advice (pure, framework-free). Given the projection engine's own output
 * and the input that produced it, `adviseDay` derives a handful of behavioural
 * nudges for the rest of *today* — anti-overtiredness, bedtime recovery, low
 * daytime sleep, and a shifted first nap after an off-schedule morning.
 *
 * These are read-only ("put down soon", "bring bedtime earlier"), never plan
 * edits — the planning engine (System B) owns template changes. The module reads
 * only already-computed projection fields (`budget`, `nextSleep`, `currentState`,
 * the projected night start) plus the age reference table, so it has no DB/route
 * imports and is fully deterministic. `project()` appends the result as
 * `Projection.advice`.
 */

import { referenceForAge } from '../advice/reference';
import { planBedtime } from './planBedtime';
import { resolveClockTime } from './time';
import type { DayAdvice, Projection, ProjectionInput } from './types';

/** How far past a wake-window target counts as "overtired" (minutes). */
const OVERTIRED_TOLERANCE_MIN = 30;
/** How far the projected night may drift past the plan before we flag it. */
const BEDTIME_DRIFT_TOLERANCE_MIN = 30;
/** A morning wake this far off the reference time shifts the first nap. */
const MORNING_SHIFT_TOLERANCE_MIN = 30;
/** Below this fraction of the age daytime target, with few naps left, warn. */
const LOW_DAYTIME_FRACTION = 0.6;

/** Format an epoch-ms instant as 'HH:MM' wall clock in `timeZone`. */
function fmtClock(epoch: number, timeZone: string): string {
	return new Intl.DateTimeFormat('en-GB', {
		timeZone,
		hour: '2-digit',
		minute: '2-digit',
		hour12: false
	}).format(epoch);
}

/**
 * Derive in-day nudges from a completed projection. Ordered warnings first, then
 * informational cards, each in rule priority. Returns an empty array when the day
 * is on track.
 */
export function adviseDay(input: ProjectionInput, projection: Projection): DayAdvice[] {
	const { template, timeZone } = input;
	const { budget, currentState, nextSleep, anchor, anchorIsActual } = projection;
	const ref = referenceForAge(input.ageMonths ?? null);

	const warn: DayAdvice[] = [];
	const info: DayAdvice[] = [];

	const completed = projection.sleeps.filter((s) => s.status === 'completed');
	const lastCompleted = completed[completed.length - 1] ?? null;

	// Rule 2 — Overtired now: awake well past the current wake-window target. When
	// awake past its window the engine grows that window to now, so we compare
	// elapsed-since-wake against the *template* target (or the age max), not the
	// grown projected window. Fires only while awake with a nap/bedtime still ahead.
	if (!currentState.asleep && nextSleep) {
		const k = Math.min(budget.napsCompleted, template.wakeWindows.length - 1);
		const windowTarget = template.wakeWindows[k] ?? 0;
		const threshold = ref != null ? Math.min(windowTarget, ref.wakeWindowMax) : windowTarget;
		if (threshold > 0 && currentState.elapsedMin > threshold + OVERTIRED_TOLERANCE_MIN) {
			const overBy = Math.round(currentState.elapsedMin - threshold);
			warn.push({
				id: 'overtired',
				severity: 'warn',
				title: 'Overtired — put down soon',
				detail:
					`Awake ${Math.round(currentState.elapsedMin)} min — about ${overBy} min past the ` +
					`~${threshold} min window. Settle for ${nextSleep.type === 'night' ? 'bed' : 'the next nap'} ` +
					`now and consider an earlier bedtime.`,
				suggestedTime: nextSleep.start
			});
		}
	}

	// Rule 3 — Bedtime floating late: the projected night start runs well past the
	// plan's own cascaded bedtime (naps ran short), so suggest the earlier target.
	const projectedNight = [...projection.sleeps]
		.reverse()
		.find((s) => s.type === 'night' && s.status === 'projected');
	const planBed = planBedtime(
		template.referenceWakeTime,
		template.wakeWindows,
		template.expectedNapDurations
	);
	if (projectedNight && planBed) {
		let target = resolveClockTime(planBed, anchor, timeZone);
		// The cascaded bedtime can land past midnight relative to the anchor day.
		while (target < anchor) target += 86_400_000;
		const driftMin = Math.round((projectedNight.start - target) / 60_000);
		if (driftMin > BEDTIME_DRIFT_TOLERANCE_MIN) {
			warn.push({
				id: 'bedtime-late',
				severity: 'warn',
				title: 'Bedtime drifting late',
				detail:
					`Tonight is projecting ${fmtClock(projectedNight.start, timeZone)}, about ${driftMin} min ` +
					`past the ${fmtClock(target, timeZone)} plan. Aim for the earlier bedtime to avoid overtiredness.`,
				suggestedTime: target
			});
		}
	}

	// Rule 1 — Short nap just ended: the most recent completed sleep was a too-short
	// nap and the baby is now awake, so the next window was auto-shortened.
	if (
		!currentState.asleep &&
		lastCompleted &&
		lastCompleted.type === 'nap' &&
		lastCompleted.tooShort &&
		nextSleep
	) {
		info.push({
			id: 'short-nap',
			severity: 'info',
			title: 'Short nap — shorten the next window',
			detail:
				`That nap was only ${Math.round(lastCompleted.durationMin ?? 0)} min. The next wake window is ` +
				`trimmed to head off overtiredness — aim for ${fmtClock(nextSleep.start, timeZone)}.`,
			suggestedTime: nextSleep.start
		});
	}

	// Rule 4 — Low daytime sleep: tracking well under the age daytime target with
	// few naps left. Age-gated (needs the reference daytime range).
	if (ref) {
		const napsLeft = projection.sleeps.filter(
			(s) => s.type === 'nap' && s.status !== 'completed'
		).length;
		const daytimeTargetLo = ref.daytimeMin[0];
		if (napsLeft <= 1 && budget.daytimeUsedMin < daytimeTargetLo * LOW_DAYTIME_FRACTION) {
			// With a nap still ahead, lengthening it is an option; once every nap is
			// done only bedtime is left to recover on.
			const action =
				napsLeft >= 1
					? 'Lengthen the remaining nap or bring bedtime earlier'
					: 'Bring bedtime earlier';
			info.push({
				id: 'low-daytime',
				severity: 'info',
				title: 'Low daytime sleep so far',
				detail:
					`Only ${budget.daytimeUsedMin} min of day sleep vs a ~${daytimeTargetLo} min guide. ` +
					`${action} to protect night sleep.`
			});
		}
	}

	// Rule 5 — Off-schedule morning shifts the first nap: an actual wake well away
	// from the reference time moves nap 1; surface the shifted first-nap time while
	// it is still projected (not yet taken).
	if (anchorIsActual) {
		const firstNap = projection.sleeps.find((s) => s.type === 'nap');
		if (firstNap && firstNap.status === 'projected') {
			const referenceWake = resolveClockTime(template.referenceWakeTime, anchor, timeZone);
			const shiftMin = Math.round((anchor - referenceWake) / 60_000);
			if (Math.abs(shiftMin) >= MORNING_SHIFT_TOLERANCE_MIN) {
				const dir = shiftMin > 0 ? 'later' : 'earlier';
				info.push({
					id: 'morning-shift',
					severity: 'info',
					title: `Morning wake ran ${dir}`,
					detail:
						`Wake was ${Math.abs(shiftMin)} min ${dir} than plan, so the first nap shifts to ` +
						`about ${fmtClock(firstNap.start, timeZone)}.`,
					suggestedTime: firstNap.start
				});
			}
		}
	}

	return [...warn, ...info];
}
