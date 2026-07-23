/**
 * `computePlanStats` — aggregate a window of recent completed days into robust
 * (median/modal) statistics the planning-advice rules compare against the active
 * template. Pure: it takes ready-made completed-day `Projection`s (built upstream
 * via `groupDayForKey` + `completedProjection`) plus the analysed zone.
 *
 * Outliers are filtered *before* aggregation so a corrupt overlapping night or a
 * mis-logged marathon nap can't skew the medians:
 *   - naps: keep durations in (0, MAX_NAP_MIN]; windows must be > 0
 *   - nights: keep lengths in (0, MAX_NIGHT_MIN]; a day whose night is out of
 *     range contributes no bedtime / night-length / bedtime-window signal
 */
import type { Projection } from '$lib/projection/types';
import type { PlanStats } from './types';

const MAX_NAP_MIN = 4 * 60; // naps longer than 4h are treated as bad data
const MAX_NIGHT_MIN = 16 * 60; // nights longer than 16h are treated as bad data

/** Median of a numeric list, or null when empty. Does not mutate the input. */
function median(values: number[]): number | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];
}

/** The most frequent value (lowest wins ties), or null when empty. */
function mode(values: number[]): number | null {
	if (values.length === 0) return null;
	const counts = new Map<number, number>();
	for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
	let best: number | null = null;
	let bestCount = -1;
	for (const [v, c] of counts) {
		if (c > bestCount || (c === bestCount && best != null && v < best)) {
			best = v;
			bestCount = c;
		}
	}
	return best;
}

/** Minutes since local midnight for an epoch in the given zone (0..1439). */
function minutesOfDay(epoch: number, timeZone: string): number {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone,
		hour12: false,
		hour: '2-digit',
		minute: '2-digit'
	}).formatToParts(new Date(epoch));
	const h = Number(parts.find((p) => p.type === 'hour')?.value ?? '0') % 24;
	const m = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
	return h * 60 + m;
}

export function computePlanStats(days: Projection[], timeZone: string): PlanStats {
	const napWindows: number[][] = []; // [position] -> windows across days
	const napDurations: number[][] = []; // [position] -> durations across days
	const napCounts: number[] = [];
	const bedtimeWindows: number[] = [];
	const nightLengths: number[] = [];
	const bedtimes: number[] = [];
	const morningWakes: number[] = [];
	const daytimeTotals: number[] = [];
	let totalNaps = 0;
	let shortNaps = 0;
	let contributing = 0;

	for (const day of days) {
		const naps = day.sleeps.filter(
			(s) => s.type === 'nap' && s.status === 'completed' && s.durationMin != null
		);
		let dayHasSignal = false;

		let daytimeTotal = 0;
		let validNapCount = 0;
		naps.forEach((nap, i) => {
			const dur = nap.durationMin as number;
			if (dur > 0 && dur <= MAX_NAP_MIN) {
				(napDurations[i] ??= []).push(dur);
				daytimeTotal += dur;
				validNapCount += 1;
				totalNaps += 1;
				if (nap.tooShort) shortNaps += 1;
				dayHasSignal = true;
			}
			if (nap.wakeWindowBeforeMin > 0) {
				(napWindows[i] ??= []).push(nap.wakeWindowBeforeMin);
				dayHasSignal = true;
			}
		});
		// Only trust a day's *total* nap count when its morning wake is logged, so a
		// partially-logged day can't understate the modal count.
		if (day.anchorIsActual) napCounts.push(validNapCount);

		const night = day.sleeps.find((s) => s.type === 'night');
		if (night) {
			const len = night.durationMin;
			const inRange = len != null && len > 0 && len <= MAX_NIGHT_MIN;
			if (inRange) {
				nightLengths.push(len);
				bedtimes.push(minutesOfDay(night.start, timeZone));
				if (night.wakeWindowBeforeMin > 0) bedtimeWindows.push(night.wakeWindowBeforeMin);
				dayHasSignal = true;
			}
		}

		if (day.anchorIsActual) {
			morningWakes.push(minutesOfDay(day.anchor, timeZone));
			dayHasSignal = true;
		}

		// Only count the daytime total for a day that was actually tracked. A fully
		// unlogged window day would otherwise contribute a spurious 0 and drag the
		// median down; a genuinely napless-but-tracked day still legitimately pushes 0.
		if (dayHasSignal) {
			daytimeTotals.push(daytimeTotal);
			contributing += 1;
		}
	}

	const positions = Math.max(napWindows.length, napDurations.length);
	const napWindowMedian: (number | null)[] = [];
	const napWindowSamples: number[] = [];
	const napDurationMedian: (number | null)[] = [];
	const napDurationSamples: number[] = [];
	for (let i = 0; i < positions; i++) {
		const w = napWindows[i] ?? [];
		const d = napDurations[i] ?? [];
		napWindowMedian.push(median(w));
		napWindowSamples.push(w.length);
		napDurationMedian.push(median(d));
		napDurationSamples.push(d.length);
	}

	return {
		dayCount: contributing,
		napWindowMedian,
		napWindowSamples,
		napDurationMedian,
		napDurationSamples,
		bedtimeWindowMedian: median(bedtimeWindows),
		bedtimeWindowSamples: bedtimeWindows.length,
		modalNapCount: mode(napCounts),
		nightLengthMedian: median(nightLengths),
		bedtimeMedian: median(bedtimes),
		morningWakeMedian: median(morningWakes),
		shortNapRate: totalNaps > 0 ? shortNaps / totalNaps : null,
		daytimeTotalMedian: median(daytimeTotals)
	};
}
