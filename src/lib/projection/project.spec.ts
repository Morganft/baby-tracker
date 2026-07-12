import { describe, it, expect } from 'vitest';
import { project } from './project';
import type { LoggedSleep, ProjectionInput, TemplateConfig } from './types';

// All tests run in UTC so 'HH:MM' resolves to the same clock time in epoch math.
const TZ = 'UTC';

/** epoch-ms for a clock time on 2026-07-09 UTC. */
function at(hhmm: string): number {
	const [h, m] = hhmm.split(':').map(Number);
	return Date.UTC(2026, 6, 9, h, m);
}

const template: TemplateConfig = {
	referenceWakeTime: '07:00',
	napCount: 2,
	wakeWindows: [120, 150, 240], // WW1, WW2, pre-bed
	expectedNapDurations: [90, 60],
	daytimeCap: 240,
	dailyTotalSleepTarget: 840
};

const settings = { shortNapThresholdMin: 15, shortNapReductionPercent: 30 };

function build(overrides: Partial<ProjectionInput>): ProjectionInput {
	return {
		now: at('07:00'),
		timeZone: TZ,
		template,
		settings,
		sleeps: [],
		...overrides
	};
}

function nap(id: string, start: string, end: string | null): LoggedSleep {
	return { id, type: 'nap', start: at(start), end: end ? at(end) : null };
}

describe('project — pre-first-wake state', () => {
	it('anchors to reference_wake_time and projects the whole day', () => {
		const p = project(build({ now: at('06:30') }));

		expect(p.anchorIsActual).toBe(false);
		expect(p.anchor).toBe(at('07:00'));
		expect(p.sleeps).toHaveLength(3);

		const [n1, n2, bed] = p.sleeps;
		expect(n1.status).toBe('projected');
		expect(n1.start).toBe(at('09:00')); // 07:00 + 120m
		expect(n1.projectedEnd).toBe(at('10:30')); // + 90m
		expect(n2.start).toBe(at('13:00')); // 10:30 + 150m
		expect(n2.projectedEnd).toBe(at('14:00')); // + 60m
		expect(bed.type).toBe('night');
		expect(bed.start).toBe(at('18:00')); // 14:00 + 240m
		expect(bed.projectedEnd).toBeNull();

		expect(p.nextSleep).toBe(n1);
		expect(p.currentState.asleep).toBe(false);
		expect(p.budget.napsCompleted).toBe(0);
		expect(p.budget.daytimeUsedMin).toBe(0);
	});
});

describe('project — actual morning wake re-anchors the day', () => {
	it('uses a late wake instead of the reference time', () => {
		const p = project(build({ morningWake: at('08:00'), now: at('08:05') }));

		expect(p.anchorIsActual).toBe(true);
		expect(p.anchor).toBe(at('08:00'));
		expect(p.sleeps[0].start).toBe(at('10:00')); // 08:00 + 120m
		expect(p.sleeps[1].start).toBe(at('14:00')); // 11:30 + 150m
	});

	it('handles an early wake', () => {
		const p = project(build({ morningWake: at('06:00'), now: at('06:05') }));
		expect(p.sleeps[0].start).toBe(at('08:00')); // 06:00 + 120m
	});
});

describe('project — short-nap rule', () => {
	it('shrinks the next wake window after a too-short nap', () => {
		const sleeps = [nap('n1', '09:00', '09:10')]; // 10 min ≤ 15
		const p = project(build({ morningWake: at('07:00'), now: at('09:15'), sleeps }));

		const [n1, n2] = p.sleeps;
		expect(n1.status).toBe('completed');
		expect(n1.tooShort).toBe(true);
		expect(n1.durationMin).toBe(10);

		// WW2 = 150m reduced by 30% => 105m. 09:10 + 105m = 10:55.
		expect(n2.wakeWindowReduced).toBe(true);
		expect(n2.wakeWindowBeforeMin).toBe(105);
		expect(n2.start).toBe(at('10:55'));
	});

	it('does not reduce after a normal-length nap', () => {
		const sleeps = [nap('n1', '09:00', '10:30')]; // 90 min
		const p = project(build({ morningWake: at('07:00'), now: at('10:35'), sleeps }));
		const n2 = p.sleeps[1];
		expect(n2.wakeWindowReduced).toBe(false);
		expect(n2.wakeWindowBeforeMin).toBe(150);
		expect(n2.start).toBe(at('13:00')); // 10:30 + 150m
	});

	it('lets a manual window override win over the short-nap reduction', () => {
		const sleeps = [nap('n1', '09:00', '09:10')]; // too short
		const p = project(
			build({
				morningWake: at('07:00'),
				now: at('09:15'),
				sleeps,
				windowOverrides: [undefined, 60] // override WW2 to 60m
			})
		);
		const n2 = p.sleeps[1];
		expect(n2.wakeWindowReduced).toBe(false);
		expect(n2.wakeWindowBeforeMin).toBe(60);
		expect(n2.start).toBe(at('10:10')); // 09:10 + 60m
	});
});

describe('project — in-progress sleep', () => {
	it('reports asleep state and cascades from the estimated wake', () => {
		const sleeps = [nap('n1', '09:00', null)];
		const p = project(build({ morningWake: at('07:00'), now: at('09:30'), sleeps }));

		const [n1, n2] = p.sleeps;
		expect(n1.status).toBe('in-progress');
		expect(n1.end).toBeNull();
		expect(n1.projectedEnd).toBe(at('10:30')); // 09:00 + expected 90m

		expect(p.currentState.asleep).toBe(true);
		expect(p.currentState.since).toBe(at('09:00'));
		expect(p.currentState.elapsedMin).toBe(30);

		// Next nap cascades from the estimated end.
		expect(n2.start).toBe(at('13:00')); // 10:30 + 150m
		expect(p.nextSleep).toBe(n2); // in-progress is not the "next" suggestion

		// In-progress nap contributes elapsed to the daytime budget.
		expect(p.budget.daytimeUsedMin).toBe(30);
		expect(p.budget.napsCompleted).toBe(0);
	});
});

describe('project — normal day in progress', () => {
	it('mixes completed naps, budget, and remaining projection', () => {
		const sleeps = [nap('n1', '09:00', '10:30'), nap('n2', '13:00', '14:00')];
		const p = project(build({ morningWake: at('07:00'), now: at('15:00'), sleeps }));

		expect(p.budget.napsCompleted).toBe(2);
		expect(p.budget.daytimeUsedMin).toBe(150); // 90 + 60
		expect(p.budget.daytimeCapMin).toBe(240);
		expect(p.budget.totalTargetMin).toBe(840);

		const bed = p.sleeps[2];
		expect(bed.status).toBe('projected');
		expect(bed.start).toBe(at('18:00')); // 14:00 + 240m
		expect(p.nextSleep).toBe(bed);

		expect(p.currentState.asleep).toBe(false);
		expect(p.currentState.since).toBe(at('14:00')); // last wake
		expect(p.currentState.elapsedMin).toBe(60);
	});
});

describe('project — awake budget', () => {
	it('sums the template windows and counts awake time as elapsed − daytime sleep', () => {
		const sleeps = [nap('n1', '09:00', '10:30'), nap('n2', '13:00', '14:00')];
		const p = project(build({ morningWake: at('07:00'), now: at('15:00'), sleeps }));

		// Planned awake budget = 120 + 150 + 240.
		expect(p.budget.wakeBudgetMin).toBe(510);
		// Elapsed 07:00→15:00 = 480m, minus 150m of naps = 330m awake so far.
		expect(p.budget.wakeUsedMin).toBe(330);
	});

	it('never goes negative before the anchor', () => {
		const p = project(build({ now: at('06:30') })); // before the 07:00 anchor
		expect(p.budget.wakeUsedMin).toBe(0);
	});
});

describe('project — soft-target-bedtime redistribution', () => {
	// A template whose windows + expected naps sum to 660m (07:00 → 18:00), with
	// per-position bounds, so redistribution has room to flex before clamping.
	const bounded: TemplateConfig = {
		referenceWakeTime: '07:00',
		napCount: 2,
		wakeWindows: [120, 150, 240],
		expectedNapDurations: [90, 60],
		targetBedtime: '18:00',
		wakeWindowMin: [60, 60, 120],
		wakeWindowMax: [180, 210, 300],
		napDurationMin: [30, 30],
		napDurationMax: [120, 120],
		daytimeCap: 240,
		dailyTotalSleepTarget: 840
	};

	function buildB(overrides: Partial<ProjectionInput>): ProjectionInput {
		return {
			now: at('07:00'),
			timeZone: TZ,
			template: bounded,
			settings,
			sleeps: [],
			...overrides
		};
	}

	/** Minutes between a projected sleep's start and its projected end. */
	function durMin(s: { start: number; projectedEnd: number | null }) {
		return ((s.projectedEnd as number) - s.start) / 60000;
	}

	it('lands exactly on the target bedtime when the template is consistent', () => {
		const p = project(buildB({ morningWake: at('07:00'), now: at('07:05') }));
		const [n1, n2, bed] = p.sleeps;
		expect(bed.type).toBe('night');
		expect(bed.start).toBe(at('18:00'));
		// delta is zero, so naps keep their expected durations.
		expect(durMin(n1)).toBe(90);
		expect(durMin(n2)).toBe(60);
	});

	it('holds the target bedtime on a late nap instead of sliding it', () => {
		const sleeps = [nap('n1', '09:30', '11:00')]; // 30m late start, 90m nap
		const p = project(buildB({ morningWake: at('07:00'), now: at('11:05'), sleeps }));

		const bed = p.sleeps[2];
		expect(bed.type).toBe('night');
		expect(bed.start).toBe(at('18:00')); // still 18:00, not pushed later
		// The remaining nap absorbs the lateness (90 → 30), windows stay on target.
		expect(durMin(p.sleeps[1])).toBe(30);
		expect(p.sleeps[1].wakeWindowBeforeMin).toBe(150);

		// Contrast: the legacy cascade (no target bedtime) drifts to 18:30.
		const legacy = project(
			buildB({
				morningWake: at('07:00'),
				now: at('11:05'),
				sleeps,
				template: { ...bounded, targetBedtime: undefined }
			})
		);
		expect(legacy.sleeps[2].start).toBe(at('18:30'));
	});

	it('pins naps at their minimum before flexing the wake windows', () => {
		const sleeps = [nap('n1', '11:00', '12:30')]; // very late
		const p = project(buildB({ morningWake: at('07:00'), now: at('12:35'), sleeps }));

		const [, n2, bed] = p.sleeps;
		expect(durMin(n2)).toBe(30); // nap pinned at its minimum first
		// Only then do the windows shrink below their targets (150, 240).
		expect(n2.wakeWindowBeforeMin).toBe(111);
		expect(bed.wakeWindowBeforeMin).toBe(189);
		expect(bed.start).toBe(at('18:00'));
	});

	it('overruns the target bedtime rather than dropping a nap when the naps cannot fit', () => {
		const p = project(
			buildB({
				morningWake: at('07:00'),
				now: at('07:05'),
				template: { ...bounded, targetBedtime: '11:30' }
			})
		);
		// Two naps cannot fit before 11:30 even at their minima. Rather than dropping
		// a nap (which would merge two windows past their max), every window/nap pins
		// at its minimum and the projected bedtime floats past the target — and every
		// value stays within its bounds (no 4h merged window).
		expect(p.sleeps).toHaveLength(3);
		const [n1, n2, bed] = p.sleeps;
		expect(n1.type).toBe('nap');
		expect(n2.type).toBe('nap');
		expect(bed.type).toBe('night');
		// All pinned at their minima: windows 60/60/120, naps 30/30.
		expect(n1.start).toBe(at('08:00')); // 07:00 + 60m min window
		expect(durMin(n1)).toBe(30); // 08:00 → 08:30
		expect(n2.wakeWindowBeforeMin).toBe(60);
		expect(n2.start).toBe(at('09:30')); // 08:30 + 60m
		expect(durMin(n2)).toBe(30); // 09:30 → 10:00
		expect(bed.wakeWindowBeforeMin).toBe(120); // pre-bed window at its min, not merged
		expect(bed.start).toBe(at('12:00')); // 10:00 + 120m, past the 11:30 target
	});

	it('falls short of an unreachable late bedtime without dropping a nap', () => {
		const p = project(
			buildB({
				morningWake: at('07:00'),
				now: at('07:05'),
				template: { ...bounded, targetBedtime: '23:00' }
			})
		);
		const [n1, n2, bed] = p.sleeps;
		// Everything maxes out; the night lands earlier than the (unreachable) target.
		expect(durMin(n1)).toBe(120);
		expect(durMin(n2)).toBe(120);
		expect(bed.wakeWindowBeforeMin).toBe(300);
		expect(bed.start).toBe(at('22:30')); // 07:00 + 690 windows + 240 naps
		expect(p.sleeps).toHaveLength(3); // no nap dropped
	});

	it('lets a too-short nap reduce the next window, then flexes it in', () => {
		const sleeps = [nap('n1', '09:00', '09:10')]; // 10m ≤ 15 → short-nap rule
		const p = project(buildB({ morningWake: at('07:00'), now: at('09:15'), sleeps }));

		const n2 = p.sleeps[1];
		expect(n2.wakeWindowReduced).toBe(true); // reduction still recorded
		expect(durMin(n2)).toBe(120); // nap maxes out absorbing the surplus first
		expect(p.sleeps[2].start).toBe(at('18:00')); // bedtime still held
	});

	it('disables redistribution once bedtime is logged (legacy cascade)', () => {
		const sleeps = [
			nap('n1', '09:00', '10:30'),
			nap('n2', '13:00', '14:00'),
			{ id: 'night', type: 'night' as const, start: at('18:00'), end: null }
		];
		const p = project(buildB({ morningWake: at('07:00'), now: at('18:05'), sleeps }));
		expect(p.sleeps[2].status).toBe('in-progress');
		expect(p.nextSleep).toBeNull();
	});
});

describe('project — logged bedtime', () => {
	it('marks the night sleep completed and reports no next sleep', () => {
		const sleeps = [
			nap('n1', '09:00', '10:30'),
			nap('n2', '13:00', '14:00'),
			{ id: 'night', type: 'night' as const, start: at('18:00'), end: null }
		];
		const p = project(build({ morningWake: at('07:00'), now: at('18:05'), sleeps }));

		const bed = p.sleeps[2];
		expect(bed.status).toBe('in-progress');
		expect(bed.entryId).toBe('night');
		expect(p.nextSleep).toBeNull();
		expect(p.currentState.asleep).toBe(true);
	});
});
