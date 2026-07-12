import { describe, it, expect } from 'vitest';
import { editInit, createInit, createFrom } from './sleepForm';
import type { SleepDTO } from '$lib/server/queries/sleeps';
import type { ProjectedSleep } from '$lib/projection/types';

/** A completed logged nap fixture (epoch-ms + zone), overridable per test. */
function entry(overrides: Partial<SleepDTO> = {}): SleepDTO {
	return {
		id: 'nap-1',
		startTime: Date.UTC(2026, 6, 12, 8, 30),
		endTime: Date.UTC(2026, 6, 12, 9, 15),
		startTimezone: 'UTC',
		endTimezone: 'UTC',
		type: 'nap',
		location: 'crib',
		putDown: null,
		notes: 'slept well',
		nightWakings: [],
		createdAt: 0,
		updatedAt: 0,
		...overrides
	};
}

/** A projected sleep fixture, overridable per test. */
function projected(overrides: Partial<ProjectedSleep> = {}): ProjectedSleep {
	const start = Date.UTC(2026, 6, 12, 10, 0);
	return {
		index: 1,
		type: 'nap',
		status: 'projected',
		start,
		end: null,
		projectedEnd: Date.UTC(2026, 6, 12, 11, 0),
		durationMin: null,
		wakeWindowBeforeMin: 120,
		wakeWindowReduced: false,
		tooShort: false,
		...overrides
	};
}

describe('editInit', () => {
	it('prefills every field from a completed logged nap in its own zone', () => {
		const init = editInit(entry());
		expect(init).toMatchObject({
			mode: 'edit',
			id: 'nap-1',
			startLocal: '2026-07-12T08:30',
			endLocal: '2026-07-12T09:15',
			startTimezone: 'UTC',
			endTimezone: 'UTC',
			type: 'nap',
			location: 'crib',
			putDown: '',
			notes: 'slept well'
		});
	});

	it('carries the entry type so a logged night edits as a night', () => {
		const init = editInit(entry({ type: 'night' }));
		expect(init.type).toBe('night');
	});

	it('leaves the end blank for an in-progress nap and falls back to the start zone', () => {
		const init = editInit(entry({ endTime: null, endTimezone: null }));
		expect(init.endLocal).toBe('');
		expect(init.endTimezone).toBe('UTC');
	});
});

describe('createInit', () => {
	it('opens in create mode prefilled with the projected start and end in the display zone', () => {
		const init = createInit(projected(), 'UTC');
		expect(init).toMatchObject({
			mode: 'create',
			id: null,
			type: 'nap',
			startLocal: '2026-07-12T10:00',
			endLocal: '2026-07-12T11:00',
			startTimezone: 'UTC',
			endTimezone: 'UTC',
			location: '',
			putDown: '',
			notes: ''
		});
	});

	it('carries the projected type so a projected bedtime creates a night', () => {
		const init = createInit(projected({ type: 'night', projectedEnd: null }), 'UTC');
		expect(init.type).toBe('night');
		expect(init.endLocal).toBe('');
	});

	it('leaves the end blank when the projected sleep has no projected end', () => {
		const init = createInit(projected({ projectedEnd: null }), 'UTC');
		expect(init.endLocal).toBe('');
	});
});

describe('createFrom', () => {
	it('builds a create model from explicit epochs (e.g. a planned overnight)', () => {
		const init = createFrom(
			{
				start: Date.UTC(2026, 6, 11, 19, 0),
				end: Date.UTC(2026, 6, 12, 7, 0),
				type: 'night'
			},
			'UTC'
		);
		expect(init).toMatchObject({
			mode: 'create',
			id: null,
			type: 'night',
			startLocal: '2026-07-11T19:00',
			endLocal: '2026-07-12T07:00',
			startTimezone: 'UTC',
			endTimezone: 'UTC'
		});
	});

	it('leaves the end blank when no end epoch is given', () => {
		const init = createFrom(
			{ start: Date.UTC(2026, 6, 12, 19, 0), end: null, type: 'night' },
			'UTC'
		);
		expect(init.endLocal).toBe('');
	});
});
