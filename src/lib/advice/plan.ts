/**
 * `advisePlan` — turn aggregate `PlanStats` into concrete, rankable planning
 * advice against the active template, each optionally carrying a one-tap
 * `patch` (a `Partial<TemplateInput>` the server merges + re-validates).
 *
 * Pure: no DB, no clock. Every rule that touches a per-position statistic only
 * fires when that position has enough samples (`MIN_SAMPLE`), so a thin week
 * can't drive a structural change. Advice is returned ranked by
 * severity × confidence (most actionable first).
 */
import type { TemplateInput } from '$lib/server/api/validate';
import type { AgeReference } from './reference';
import type { PlanStats, PlanAdvice } from './types';

const MIN_SAMPLE = 4; // days of signal a position needs before we advise on it
const WW_TOL = 20; // wake-window drift (min) we ignore as noise
const NAP_TOL = 15; // nap-duration drift (min) we ignore as noise
const BEDTIME_TOL = 20; // bedtime drift (min) we ignore as noise
// The last nap taken on this fraction of tracked days (or fewer) reads as an
// approaching nap transition (repeated refusal of the final nap).
const TRANSITION_SKIP_FRACTION = 0.6;

const clamp = (v: number, lo: number | undefined, hi: number | undefined): number => {
	let out = v;
	if (lo != null) out = Math.max(lo, out);
	if (hi != null) out = Math.min(hi, out);
	return out;
};

type Confidence = PlanAdvice['confidence'];

const confidenceFor = (samples: number): Confidence =>
	samples >= 8 ? 'high' : samples >= MIN_SAMPLE ? 'medium' : 'low';

const SEV_RANK = { warn: 2, info: 1 } as const;
const CONF_RANK = { high: 3, medium: 2, low: 1 } as const;

const hhmmToMin = (s: string): number => {
	const [h, m] = s.split(':').map(Number);
	return h * 60 + m;
};

const asClock = (min: number): string => {
	const h = Math.floor(min / 60) % 24;
	const m = min % 60;
	return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

/** Resize a windows array (length napCount+1) to a new nap count, keeping the
 * trailing bedtime window and padding/truncating the nap windows. */
function resizeWindows(arr: number[] | null, oldNap: number, newNap: number): number[] | null {
	if (arr == null) return null;
	const napPart = arr.slice(0, oldNap);
	const bed = arr[arr.length - 1];
	const out: number[] = [];
	for (let i = 0; i < newNap; i++) out.push(napPart[i] ?? napPart[napPart.length - 1] ?? bed);
	out.push(bed);
	return out;
}

/** Resize a per-nap array (length napCount) to a new nap count. */
function resizeNapArray(arr: number[] | null, newNap: number): number[] | null {
	if (arr == null) return null;
	const out: number[] = [];
	for (let i = 0; i < newNap; i++) out.push(arr[i] ?? arr[arr.length - 1] ?? 0);
	return out;
}

/** Build a structural patch that resizes the whole template to `newNap` naps. */
function resizePatch(template: TemplateInput, newNap: number): Partial<TemplateInput> {
	const oldNap = template.napCount;
	return {
		napCount: newNap,
		wakeWindows: resizeWindows(template.wakeWindows, oldNap, newNap) ?? undefined,
		expectedNapDurations: resizeNapArray(template.expectedNapDurations, newNap) ?? undefined,
		wakeWindowMin: resizeWindows(template.wakeWindowMin, oldNap, newNap),
		wakeWindowMax: resizeWindows(template.wakeWindowMax, oldNap, newNap),
		napDurationMin: resizeNapArray(template.napDurationMin, newNap),
		napDurationMax: resizeNapArray(template.napDurationMax, newNap)
	};
}

export function advisePlan(
	stats: PlanStats,
	template: TemplateInput,
	ref?: AgeReference | null
): PlanAdvice[] {
	const out: PlanAdvice[] = [];
	const enoughDays = stats.dayCount >= MIN_SAMPLE;

	// Rule 1 — per-position wake-window drift.
	for (let i = 0; i < template.napCount; i++) {
		const median = stats.napWindowMedian[i];
		const samples = stats.napWindowSamples[i] ?? 0;
		if (median == null || samples < MIN_SAMPLE) continue;
		const target = template.wakeWindows[i];
		const diff = median - target;
		if (Math.abs(diff) <= WW_TOL) continue;
		const value = clamp(median, template.wakeWindowMin?.[i], template.wakeWindowMax?.[i]);
		if (value === target) continue;
		const next = [...template.wakeWindows];
		next[i] = value;
		out.push({
			id: `ww-${i}`,
			severity: Math.abs(diff) >= 45 ? 'warn' : 'info',
			confidence: confidenceFor(samples),
			title: `Adjust the wake window before nap ${i + 1}`,
			detail: `It has actually run ~${median} min vs the planned ${target} min. Set it to ${value} min.`,
			patch: { wakeWindows: next }
		});
	}

	// Rule 2 — per-position nap-duration reality.
	for (let i = 0; i < template.napCount; i++) {
		const median = stats.napDurationMedian[i];
		const samples = stats.napDurationSamples[i] ?? 0;
		if (median == null || samples < MIN_SAMPLE) continue;
		const target = template.expectedNapDurations[i];
		const diff = median - target;
		if (Math.abs(diff) <= NAP_TOL) continue;
		const value = clamp(median, template.napDurationMin?.[i], template.napDurationMax?.[i]);
		if (value === target) continue;
		const next = [...template.expectedNapDurations];
		next[i] = value;
		out.push({
			id: `nap-${i}`,
			severity: 'info',
			confidence: confidenceFor(samples),
			title: `Update the expected length of nap ${i + 1}`,
			detail: `It has actually run ~${median} min vs the planned ${target} min. Set it to ${value} min.`,
			patch: { expectedNapDurations: next }
		});
	}

	// Rule 3 — nap-count mismatch (structural).
	if (enoughDays && stats.modalNapCount != null && stats.modalNapCount >= 1) {
		const modal = stats.modalNapCount;
		if (modal !== template.napCount) {
			out.push({
				id: 'nap-count',
				severity: 'warn',
				confidence: 'medium',
				title: `Switch the plan to ${modal} nap${modal === 1 ? '' : 's'}`,
				detail: `You've been doing ${modal} nap${modal === 1 ? '' : 's'} a day, but the plan is built for ${template.napCount}.`,
				patch: resizePatch(template, modal)
			});
		}
	}

	// Rule 4 — bedtime floating late (informational).
	const planBed = template.targetBedtime ?? template.bedtimeStart;
	if (enoughDays && stats.bedtimeMedian != null && planBed) {
		const drift = stats.bedtimeMedian - hhmmToMin(planBed);
		if (drift > BEDTIME_TOL) {
			out.push({
				id: 'bedtime-late',
				severity: 'info',
				confidence: 'medium',
				title: 'Bedtime has been running late',
				detail: `Actual bedtime has averaged ${asClock(stats.bedtimeMedian)} vs the planned ${planBed}. Consider trimming the day's wake windows.`
			});
		}
	}

	// Rule 5 — age-band guidance (informational, only with a birth date).
	if (ref) {
		const [napLo, napHi] = ref.napCount;
		const count = stats.modalNapCount ?? template.napCount;
		if (count < napLo || count > napHi) {
			out.push({
				id: 'age-nap-count',
				severity: 'info',
				confidence: 'low',
				title: 'Nap count differs from the age guidance',
				detail: `At this age ${napLo}–${napHi} naps is typical; you're around ${count}. Ranges are guidance, not rules.`
			});
		}
		const napWindows = template.wakeWindows.slice(0, template.napCount);
		const outOfBand = napWindows.some((w) => w < ref.wakeWindowMin || w > ref.wakeWindowMax);
		if (outOfBand) {
			out.push({
				id: 'age-wake-window',
				severity: 'info',
				confidence: 'low',
				title: 'Some wake windows sit outside the age guidance',
				detail: `Typical wake windows at this age are ${ref.wakeWindowMin}–${ref.wakeWindowMax} min.`
			});
		}
	}

	// Rule 6 — nap-transition readiness (structural, low confidence). Age known, the
	// plan still runs more naps than the age floor, and the *last* nap is being taken
	// on only a fraction of days (repeated refusal) — a gentle nudge to drop a nap.
	// Held back when Rule 3 already proposes that exact drop (modal count moved).
	if (
		ref &&
		enoughDays &&
		template.napCount > 1 &&
		template.napCount > ref.napCount[0] &&
		stats.modalNapCount !== template.napCount - 1
	) {
		const target = template.napCount - 1;
		const finalSamples = stats.napDurationSamples[template.napCount - 1] ?? 0;
		// Inconsistent — still taken sometimes, but skipped often enough to signal
		// the transition (a nap never taken is Rule 3's territory once the modal moves).
		if (finalSamples >= 1 && finalSamples <= stats.dayCount * TRANSITION_SKIP_FRACTION) {
			out.push({
				id: 'nap-transition',
				severity: 'info',
				confidence: 'low',
				title: `Might be ready to drop to ${target} nap${target === 1 ? '' : 's'}`,
				detail:
					`The last nap has been taken on only ${finalSamples} of ${stats.dayCount} tracked days — ` +
					`a common sign of an approaching nap transition. Dropping a nap is a big change; try it on an easy day.`,
				patch: resizePatch(template, target)
			});
		}
	}

	// Rule 7 — total daytime sleep vs age range (informational).
	if (ref && stats.daytimeTotalMedian != null) {
		const [lo, hi] = ref.daytimeMin;
		if (stats.daytimeTotalMedian < lo || stats.daytimeTotalMedian > hi) {
			out.push({
				id: 'age-daytime-total',
				severity: 'info',
				confidence: 'low',
				title: 'Daytime sleep differs from the age guidance',
				detail: `Total daytime sleep has averaged ~${stats.daytimeTotalMedian} min; ${lo}–${hi} min is typical at this age.`
			});
		}
	}

	return out.sort(
		(a, b) =>
			SEV_RANK[b.severity] * 10 +
			CONF_RANK[b.confidence] -
			(SEV_RANK[a.severity] * 10 + CONF_RANK[a.confidence])
	);
}
