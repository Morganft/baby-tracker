import { describe, it, expect } from 'vitest';
import { returnPath } from './returnPath';

// The Add-sleep screen is opened *from* a day-scoped view (Home / Timeline) that may
// be showing a past day. `returnPath` composes where the form goes back to, carrying
// that viewed day so switching to Add and back never silently jumps you to today.
describe('returnPath', () => {
	it('carries the viewed day back to the Timeline', () => {
		expect(returnPath('/timeline', '2026-07-09')).toBe('/timeline?date=2026-07-09');
	});

	it('carries the viewed day back to Home', () => {
		expect(returnPath('/', '2026-07-09')).toBe('/?date=2026-07-09');
	});

	it('drops the day for a non day-scoped view (History has no day nav)', () => {
		expect(returnPath('/history', '2026-07-09')).toBe('/history');
	});

	it('returns the bare view when no day is being carried (today)', () => {
		expect(returnPath('/timeline', null)).toBe('/timeline');
		expect(returnPath('/', null)).toBe('/');
	});
});
