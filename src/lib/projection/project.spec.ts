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
