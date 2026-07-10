/**
 * The projection engine (pure). Given the active template, today's logged
 * sleeps, and settings, it cascades relative wake windows forward from the most
 * recent wake to forecast every remaining sleep through bedtime.
 *
 * Two modes (REQUIREMENTS §5):
 *  - **Legacy cascade** (no `targetBedtime`): each projected sleep is
 *    `lastWake + templateWindow`, so the tail of the day slides with a late log.
 *  - **Redistribution** (`targetBedtime` set, bedtime not yet logged): the
 *    remaining projected windows + naps are recomputed to land on a *fixed*
 *    target bedtime, holding total awake time steady — steering each value back
 *    toward its template target, clamped to per-position bounds, flexing naps
 *    before windows, and dropping a nap (merging it into the night) when the
 *    remaining naps can't fit.
 *
 * This module has no DB/route imports and is fully deterministic so it can be
 * unit-tested in isolation.
 */

import { resolveClockTime, minutesToMs, msToMinutes } from './time';
import type { LoggedSleep, ProjectedSleep, Projection, ProjectionInput } from './types';

const DAY_MS = 86_400_000;

function reduceWindow(windowMin: number, reductionPercent: number): number {
	return Math.round(windowMin * (1 - reductionPercent / 100));
}

function clamp(v: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, v));
}

/** A wake window or nap slot in the redistributed tail. */
interface Slot {
	target: number;
	min: number;
	max: number;
	/** Windows only: true when the short-nap rule shortened the target. */
	reduced: boolean;
}

/**
 * Add `amount` (signed minutes) across `values` toward their bounds, returning
 * the adjusted values and any `leftover` that didn't fit. Fills proportionally
 * to each item's remaining capacity in the needed direction; an unbounded
 * (`+∞`) item absorbs everything.
 */
function distribute(
	values: number[],
	mins: number[],
	maxs: number[],
	amount: number
): { values: number[]; leftover: number } {
	const out = [...values];
	if (Math.abs(amount) < 1e-9 || out.length === 0) return { values: out, leftover: amount };

	const caps = out.map((v, i) => (amount > 0 ? maxs[i] - v : mins[i] - v));
	const infinite = caps.map((c, i) => [c, i] as const).filter(([c]) => !Number.isFinite(c));
	if (infinite.length > 0) {
		// Unbounded capacity in the needed direction: spread evenly across those items.
		const share = amount / infinite.length;
		for (const [, i] of infinite) out[i] += share;
		return { values: out, leftover: 0 };
	}

	const totalCap = caps.reduce((a, b) => a + b, 0);
	if (Math.abs(totalCap) < 1e-9) return { values: out, leftover: amount };
	const frac = Math.min(1, Math.max(0, amount / totalCap));
	for (let i = 0; i < out.length; i++) out[i] += caps[i] * frac;
	return { values: out, leftover: amount - totalCap * frac };
}

/**
 * Fit `windows` + `naps` into `available` minutes, holding each toward its
 * target. Naps flex first (wake-window priority), then windows. `dropNeeded` is
 * true when even at every minimum the sleeps overrun `available`.
 */
function solveFit(
	windows: Slot[],
	naps: Slot[],
	available: number
): { windowValues: number[]; napValues: number[]; dropNeeded: boolean } {
	const wStart = windows.map((w) => clamp(w.target, w.min, w.max));
	const nStart = naps.map((n) => clamp(n.target, n.min, n.max));
	const delta = available - (wStart.reduce((a, b) => a + b, 0) + nStart.reduce((a, b) => a + b, 0));

	const napRes = distribute(
		nStart,
		naps.map((n) => n.min),
		naps.map((n) => n.max),
		delta
	);
	const winRes = distribute(
		wStart,
		windows.map((w) => w.min),
		windows.map((w) => w.max),
		napRes.leftover
	);
	return {
		windowValues: winRes.values,
		napValues: napRes.values,
		dropNeeded: winRes.leftover < -1e-6
	};
}

/**
 * Redistribute the projected tail (windows m..napCount + naps m..napCount-1)
 * across the interval from `lastWake` to `targetBedtime`, dropping (merging into
 * the night) the last nap whenever the remaining naps can't fit at their minima.
 */
function redistributeTail(
	windows: Slot[],
	naps: Slot[],
	available: number
): { windowValues: number[]; napValues: number[]; windows: Slot[] } {
	let W = windows;
	let N = naps;
	// Each drop removes the last nap and merges its two flanking windows (the
	// baby stays awake across the gap), so the loop strictly shrinks and ends.
	for (;;) {
		const solved = solveFit(W, N, available);
		if (!solved.dropNeeded || N.length === 0) {
			return { windowValues: solved.windowValues, napValues: solved.napValues, windows: W };
		}
		const a = W[W.length - 2];
		const b = W[W.length - 1];
		W = [
			...W.slice(0, W.length - 2),
			{ target: a.target + b.target, min: a.min + b.min, max: a.max + b.max, reduced: a.reduced }
		];
		N = N.slice(0, N.length - 1);
	}
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

	// Redistribute only when a target bedtime is configured and bedtime isn't
	// logged yet; otherwise fall back to the legacy per-index cascade.
	const redistribute = nightEntry == null && !!template.targetBedtime;

	if (!redistribute) {
		// ---- Legacy cascade: unchanged behaviour, index 0..napCount ----
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
	} else {
		// ---- Redistribution: logged naps (prefix) + fixed-bedtime tail ----
		const loggedNaps = Math.min(napEntries.length, napCount);
		for (let index = 0; index < loggedNaps; index++) {
			const entry = napEntries[index];
			const completed = entry.end != null;
			const durationMin = completed ? msToMinutes((entry.end as number) - entry.start) : null;
			const tooShort = durationMin != null && durationMin <= settings.shortNapThresholdMin;
			const estimatedEnd = completed
				? (entry.end as number)
				: entry.start + minutesToMs(expectedNapDurations[index]);

			result.push({
				index,
				type: 'nap',
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

			if (completed) {
				daytimeUsedMin += durationMin as number;
				napsCompleted += 1;
				lastCompletedWake = entry.end as number;
			} else {
				daytimeUsedMin += Math.max(0, msToMinutes(now - entry.start));
				asleepEntry = entry;
			}
			lastWake = estimatedEnd;
		}

		// Build the projected tail's slots: windows m..napCount, naps m..napCount-1.
		const windowSlots: Slot[] = [];
		for (let i = loggedNaps; i <= napCount; i++) {
			const override = overrides[i];
			let target = override ?? wakeWindows[i];
			let reduced = false;
			if (override == null && i >= 1) {
				const prev = result[i - 1];
				if (prev && prev.type === 'nap' && prev.tooShort) {
					target = reduceWindow(target, settings.shortNapReductionPercent);
					reduced = true;
				}
			}
			windowSlots.push({
				target,
				min: template.wakeWindowMin?.[i] ?? 0,
				max: template.wakeWindowMax?.[i] ?? Infinity,
				reduced
			});
		}
		const napSlots: Slot[] = [];
		for (let i = loggedNaps; i < napCount; i++) {
			napSlots.push({
				target: expectedNapDurations[i],
				min: template.napDurationMin?.[i] ?? 0,
				max: template.napDurationMax?.[i] ?? Infinity,
				reduced: false
			});
		}

		// Resolve the fixed target bedtime on the anchor's day (roll forward if the
		// day has already run past it), then solve the tail against that interval.
		let bedtime = resolveClockTime(template.targetBedtime as string, anchor, timeZone);
		while (bedtime <= lastWake) bedtime += DAY_MS;
		const available = msToMinutes(bedtime - lastWake);

		const solved = redistributeTail(windowSlots, napSlots, available);

		let index = loggedNaps;
		let cursor = lastWake;
		for (let j = 0; j < solved.napValues.length; j++) {
			const windowMin = Math.round(solved.windowValues[j]);
			const napMin = Math.round(solved.napValues[j]);
			const start = cursor + minutesToMs(windowMin);
			const end = start + minutesToMs(napMin);
			result.push({
				index: index++,
				type: 'nap',
				status: 'projected',
				start,
				end: null,
				projectedEnd: end,
				durationMin: null,
				wakeWindowBeforeMin: windowMin,
				wakeWindowReduced: solved.windows[j].reduced,
				tooShort: false
			});
			cursor = end;
		}
		// Final (pre-bed) window leads into the projected night.
		const lastIdx = solved.windowValues.length - 1;
		const bedWindow = Math.round(solved.windowValues[lastIdx]);
		result.push({
			index,
			type: 'night',
			status: 'projected',
			start: cursor + minutesToMs(bedWindow),
			end: null,
			projectedEnd: null,
			durationMin: null,
			wakeWindowBeforeMin: bedWindow,
			wakeWindowReduced: solved.windows[lastIdx].reduced,
			tooShort: false
		});
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
