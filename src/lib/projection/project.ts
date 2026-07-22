/**
 * The projection engine (pure). Given the active template, today's logged
 * sleeps, and settings, it cascades relative wake windows forward from the most
 * recent wake to forecast every remaining sleep through bedtime.
 *
 * Two modes (REQUIREMENTS §5):
 *  - **Legacy cascade** (no `targetBedtime`): each projected sleep is
 *    `lastWake + templateWindow`, so the tail of the day slides with a late log.
 *  - **Redistribution** (`targetBedtime` set, bedtime not yet logged): the
 *    remaining projected windows + naps are recomputed toward a *soft* target
 *    bedtime, holding total awake time steady — steering each value back toward
 *    its template target, clamped to per-position bounds, flexing naps before
 *    windows. The bedtime is a target, not a wall: no nap is ever dropped and no
 *    value leaves its bounds, so when the sleeps can't compress to reach the
 *    target they pin at their minima and the projected bedtime floats later.
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
 * target. Naps flex first (wake-window priority), then windows. Every returned
 * value stays within its `[min, max]` bound; when the sleeps can't compress to
 * fit `available` even at their minima, they pin at those minima and the cascade
 * lands the projected bedtime later than the (soft) target — see
 * `redistributeTail`.
 */
function solveFit(
	windows: Slot[],
	naps: Slot[],
	available: number
): { windowValues: number[]; napValues: number[] } {
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
	return { windowValues: winRes.values, napValues: napRes.values };
}

/**
 * Redistribute the projected tail (windows m..napCount + naps m..napCount-1)
 * across the interval from `lastWake` to the **soft** `targetBedtime`. The
 * bedtime is a target, not a hard wall: every window and nap is held within its
 * `[min, max]` bound, so when the remaining sleeps can't compress to reach the
 * target they pin at their minima and the projected bedtime simply floats later.
 * No nap is dropped — keeping the day's nap count intact and every value in
 * bounds (no over-long merged pre-bed window).
 */
function redistributeTail(
	windows: Slot[],
	naps: Slot[],
	available: number
): { windowValues: number[]; napValues: number[]; windows: Slot[] } {
	const solved = solveFit(windows, naps, available);
	return { windowValues: solved.windowValues, napValues: solved.napValues, windows };
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

	// Whether the baby is asleep right now (any logged sleep still open). Only then
	// do we suppress growing a projected wake window to `now`: the current period is
	// that sleep, and any still-projected naps are either future (after it) or stale
	// (e.g. an in-progress bedtime logged before morning naps were ever recorded).
	const asleepNow = sleeps.some((s) => s.end == null);
	// Grow the *current* awake window's projected start to now when awake past it.
	const floorAwake = (rawStart: number) => (asleepNow ? rawStart : Math.max(rawStart, now));

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
		// ---- Legacy cascade: naps 0..napSlots-1, then bedtime ----
		// Surface every logged nap even when it exceeds the plan's napCount, so a nap
		// logged past the planned count still appears (bedtime then follows it). Only
		// the first `napCount` slots can ever be *projected*; the extras are all logged.
		const napSlots = Math.max(napCount, napEntries.length);
		const projectNap = (index: number, entry: LoggedSleep | null): void => {
			// Template window into this nap, with per-day override and short-nap rule.
			// (Only consulted for a projected nap, which never happens past napCount.)
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
				const tooShort = durationMin != null && durationMin <= settings.shortNapThresholdMin;
				// Estimate an end for an in-progress nap so the cascade can continue;
				// naps past the plan have no template duration, so fall back to the last.
				const expected =
					expectedNapDurations[index] ??
					expectedNapDurations[expectedNapDurations.length - 1] ??
					60;
				// An in-progress nap ends no earlier than now: once it runs past its
				// expected duration, grow its block to the current moment (as if it were
				// logged with end = now) so the cascade continues from a real wake, not
				// a past estimate.
				const estimatedEnd = completed
					? (entry.end as number)
					: Math.max(entry.start + minutesToMs(expected), now);

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
				} else {
					// In-progress nap: count elapsed toward the daytime budget.
					daytimeUsedMin += Math.max(0, msToMinutes(now - entry.start));
				}

				if (!completed) asleepEntry = entry;
				lastWake = estimatedEnd;
				if (completed) lastCompletedWake = entry.end as number;
			} else {
				// Projected nap. If the baby is awake past this (the current) wake window,
				// grow it to now so the nap projects from the present, not a lapsed
				// estimate — the awake mirror of an over-running in-progress nap. Only the
				// first projected sleep can floor; the rest cascade from it into the future.
				const rawStart = lastWake + minutesToMs(windowMin);
				const start = floorAwake(rawStart);
				const flexed = start > rawStart;
				const end = start + minutesToMs(expectedNapDurations[index]);
				result.push({
					index,
					type: 'nap',
					status: 'projected',
					start,
					end: null,
					projectedEnd: end,
					durationMin: null,
					wakeWindowBeforeMin: flexed ? Math.round(msToMinutes(start - lastWake)) : windowMin,
					wakeWindowReduced: flexed ? false : reduced,
					tooShort: false
				});
				lastWake = end;
			}
		};

		for (let index = 0; index < napSlots; index++) {
			projectNap(index, napEntries[index] ?? null);
		}

		// Bedtime after the last nap. Its window is always the plan's final (pre-bed)
		// window; its index sits after every nap so timeline keys stay unique.
		const bedIndex = napSlots;
		const override = overrides[napCount];
		let bedWindow = override ?? wakeWindows[napCount];
		let bedReduced = false;
		if (override == null) {
			const prev = result[bedIndex - 1];
			if (prev && prev.type === 'nap' && prev.tooShort) {
				bedWindow = reduceWindow(bedWindow, settings.shortNapReductionPercent);
				bedReduced = true;
			}
		}
		if (nightEntry) {
			const completed = nightEntry.end != null;
			const durationMin = completed
				? msToMinutes((nightEntry.end as number) - nightEntry.start)
				: null;
			result.push({
				index: bedIndex,
				type: 'night',
				status: completed ? 'completed' : 'in-progress',
				start: nightEntry.start,
				end: nightEntry.end,
				projectedEnd: nightEntry.end,
				durationMin,
				wakeWindowBeforeMin: Math.round(msToMinutes(nightEntry.start - lastWake)),
				wakeWindowReduced: false,
				tooShort: false,
				entryId: nightEntry.id
			});
			if (!completed) asleepEntry = nightEntry;
			if (completed) lastCompletedWake = nightEntry.end as number;
		} else {
			// Awake past bedtime's window (no naps left): grow the final window to now.
			const rawStart = lastWake + minutesToMs(bedWindow);
			const start = floorAwake(rawStart);
			const flexed = start > rawStart;
			result.push({
				index: bedIndex,
				type: 'night',
				status: 'projected',
				start,
				end: null,
				projectedEnd: null,
				durationMin: null,
				wakeWindowBeforeMin: flexed ? Math.round(msToMinutes(start - lastWake)) : bedWindow,
				wakeWindowReduced: flexed ? false : bedReduced,
				tooShort: false
			});
		}
	} else {
		// ---- Redistribution: logged naps (prefix) + fixed-bedtime tail ----
		// Every logged nap is rendered, even ones past the plan's napCount; the
		// redistributed tail then covers only the planned naps still to come
		// (none, once the logged naps already meet or exceed napCount).
		const renderedNaps = napEntries.length;
		const tailStart = Math.min(renderedNaps, napCount);
		for (let index = 0; index < renderedNaps; index++) {
			const entry = napEntries[index];
			const completed = entry.end != null;
			const durationMin = completed ? msToMinutes((entry.end as number) - entry.start) : null;
			const tooShort = durationMin != null && durationMin <= settings.shortNapThresholdMin;
			// Naps past the plan have no template duration; fall back to the last.
			const expected =
				expectedNapDurations[index] ?? expectedNapDurations[expectedNapDurations.length - 1] ?? 60;
			// An in-progress nap ends no earlier than now: once it runs past its
			// expected duration, grow its block to the current moment (as if logged
			// with end = now) so the cascade continues from a real wake.
			const estimatedEnd = completed
				? (entry.end as number)
				: Math.max(entry.start + minutesToMs(expected), now);

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

		// Build the projected tail's slots: windows tailStart..napCount, naps
		// tailStart..napCount-1 (empty once every planned nap is already logged).
		const windowSlots: Slot[] = [];
		for (let i = tailStart; i <= napCount; i++) {
			const override = overrides[i];
			let target = override ?? wakeWindows[i];
			let reduced = false;
			// The first tail window follows the last *logged* nap (which may sit past
			// napCount); later tail windows follow a not-yet-pushed projected nap.
			const prev = i === tailStart ? result[renderedNaps - 1] : result[i - 1];
			if (override == null && i >= 1) {
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
		for (let i = tailStart; i < napCount; i++) {
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

		// Projected sleeps get indices after every rendered nap so timeline keys stay unique.
		let index = renderedNaps;
		let cursor = lastWake;
		for (let j = 0; j < solved.napValues.length; j++) {
			const windowMin = Math.round(solved.windowValues[j]);
			const napMin = Math.round(solved.napValues[j]);
			// Grow the active (current) awake window to now when the baby is awake past
			// it; later windows sit in the future, so their floor is a no-op.
			const rawStart = cursor + minutesToMs(windowMin);
			const start = floorAwake(rawStart);
			const flexed = start > rawStart;
			const end = start + minutesToMs(napMin);
			result.push({
				index: index++,
				type: 'nap',
				status: 'projected',
				start,
				end: null,
				projectedEnd: end,
				durationMin: null,
				wakeWindowBeforeMin: flexed ? Math.round(msToMinutes(start - cursor)) : windowMin,
				wakeWindowReduced: flexed ? false : solved.windows[j].reduced,
				tooShort: false
			});
			cursor = end;
		}
		// Final (pre-bed) window leads into the projected night.
		const lastIdx = solved.windowValues.length - 1;
		const bedWindow = Math.round(solved.windowValues[lastIdx]);
		const rawBedStart = cursor + minutesToMs(bedWindow);
		const bedStart = floorAwake(rawBedStart);
		const bedFlexed = bedStart > rawBedStart;
		result.push({
			index,
			type: 'night',
			status: 'projected',
			start: bedStart,
			end: null,
			projectedEnd: null,
			durationMin: null,
			wakeWindowBeforeMin: bedFlexed ? Math.round(msToMinutes(bedStart - cursor)) : bedWindow,
			wakeWindowReduced: bedFlexed ? false : solved.windows[lastIdx].reduced,
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

	// Awake budget: planned total awake time is the sum of the template's wake
	// windows; used so far is the day's elapsed time minus daytime sleep.
	const wakeBudgetMin = wakeWindows.reduce((a, b) => a + b, 0);
	const wakeUsedMin = Math.max(0, Math.round(msToMinutes(now - anchor) - daytimeUsedMin));

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
			napsCompleted,
			wakeUsedMin,
			wakeBudgetMin
		}
	};
}
