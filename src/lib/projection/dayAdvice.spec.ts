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
	expectedNapDurations: [90, 60] // plan bedtime cascades to 18:00
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

function advise(overrides: Partial<ProjectionInput>) {
	return project(build(overrides)).advice;
}

describe('adviseDay — on-track day', () => {
	it('returns no advice when the day matches the plan', () => {
		expect(advise({ now: at('07:00') })).toEqual([]);
	});
});

describe('adviseDay — overtired now (rule 2)', () => {
	it('warns when awake well past the current wake window', () => {
		// Woke 07:00; the WW1 target is 120 min, so 160 min awake is 40 past.
		const advice = advise({ morningWake: at('07:00'), now: at('09:40') });
		const overtired = advice.find((a) => a.id === 'overtired');
		expect(overtired?.severity).toBe('warn');
		// Suggested time is the next (projected) sleep, grown to now.
		expect(overtired?.suggestedTime).toBe(at('09:40'));
	});

	it('stays quiet while still inside the window tolerance', () => {
		const advice = advise({ morningWake: at('07:00'), now: at('09:00') });
		expect(advice.some((a) => a.id === 'overtired')).toBe(false);
	});
});

describe('adviseDay — bedtime drifting late (rule 3)', () => {
	it('warns and suggests the plan bedtime when the night projects late', () => {
		// A late 08:00 wake slides the whole cascade, projecting bed at 19:00 vs 18:00.
		const advice = advise({ morningWake: at('08:00'), now: at('08:05') });
		const late = advice.find((a) => a.id === 'bedtime-late');
		expect(late?.severity).toBe('warn');
		expect(late?.suggestedTime).toBe(at('18:00'));
		expect(late?.detail).toContain('19:00');
	});
});

describe('adviseDay — short nap just ended (rule 1)', () => {
	it('explains the shortened next window after a too-short nap', () => {
		const sleeps = [nap('n1', '09:00', '09:10')]; // 10 min ≤ 15 threshold
		const advice = advise({ morningWake: at('07:00'), now: at('09:15'), sleeps });
		const short = advice.find((a) => a.id === 'short-nap');
		expect(short?.severity).toBe('info');
		expect(short?.suggestedTime).toBe(
			project(build({ morningWake: at('07:00'), now: at('09:15'), sleeps })).nextSleep?.start
		);
	});
});

describe('adviseDay — low daytime sleep (rule 4, age-gated)', () => {
	it('flags low day sleep with few naps left when age is known', () => {
		// One 30-min nap done (well under the ~120 min guide), one nap left.
		const sleeps = [nap('n1', '09:00', '09:30')];
		const advice = advise({
			morningWake: at('07:00'),
			now: at('09:35'),
			sleeps,
			ageMonths: 9
		});
		const low = advice.find((a) => a.id === 'low-daytime');
		expect(low?.severity).toBe('info');
	});

	it('stays quiet without an age', () => {
		const sleeps = [nap('n1', '09:00', '09:30')];
		const advice = advise({ morningWake: at('07:00'), now: at('09:35'), sleeps });
		expect(advice.some((a) => a.id === 'low-daytime')).toBe(false);
	});

	it('omits the "remaining nap" wording when every nap is already done', () => {
		// Both of the 2 planned naps taken (short), so only bedtime is left.
		const sleeps = [nap('n1', '09:00', '09:20'), nap('n2', '12:00', '12:20')];
		const advice = advise({
			morningWake: at('07:00'),
			now: at('12:30'),
			sleeps,
			ageMonths: 9
		});
		const low = advice.find((a) => a.id === 'low-daytime');
		expect(low).toBeDefined();
		expect(low?.detail).not.toContain('remaining nap');
		expect(low?.detail).toContain('Bring bedtime earlier');
	});
});

describe('adviseDay — off-schedule morning shifts nap 1 (rule 5)', () => {
	it('surfaces the shifted first-nap time after an early wake', () => {
		// Woke 06:00 — 60 min earlier than the 07:00 reference.
		const advice = advise({ morningWake: at('06:00'), now: at('06:05') });
		const shift = advice.find((a) => a.id === 'morning-shift');
		expect(shift?.severity).toBe('info');
		expect(shift?.detail).toContain('earlier');
		expect(shift?.suggestedTime).toBe(at('08:00')); // 06:00 + 120m WW1
	});
});
